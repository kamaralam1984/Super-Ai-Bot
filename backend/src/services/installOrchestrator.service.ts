import type { Server as SocketIOServer } from "socket.io";
import type { GeneratedConfig, InstallErrorDetail, InstallProgressEvent, InstallStepId, DataScope } from "@kvl/shared";
import { runSystemCheck } from "./systemCheck.service";
import { runEnvironmentValidation } from "./environment.service";
import { validateWebsite } from "./websiteValidation.service";
import { generateInstallationConfigBundle } from "./config.service";
import { initializeDatabase, rollbackDatabase } from "./database.service";
import { createDirectoryStructure } from "./directory.service";
import { recordInstallationStart, recordSecretFingerprints, recordProgressEvents, finalizeInstallationRecord } from "./installationRecord.service";
import { PermissionOrchestratorService } from "../permission/permissionOrchestrator.service";
import { ALL_DATA_SCOPES } from "../permission/types";
import { runWebsiteScan, type ScanPhase } from "../scanner/scanOrchestrator.service";
import { runAiTraining } from "../training/trainingOrchestrator.service";
import { logEvent } from "../utils/logger";
import { formatError } from "../utils/formatError";

export interface InstallInput {
  websiteName: string;
  websiteUrl: string;
  /** Data categories the visitor consented to on the pre-install permission screen (frontend/src/pages/steps/PermissionConsentStep.tsx). Defaults to every scope — an install that skips this screen (e.g. a script-driven test) still ends up with a working, fully-permissioned AI rather than a silently permission-less one. */
  grantedScopes?: DataScope[];
}

const STEP_LABELS: Record<InstallStepId, string> = {
  system_check: "Checking Server",
  environment_validation: "Checking Environment",
  website_validation: "Verifying Website",
  configuration: "Creating Configuration",
  security: "Generating Security Keys",
  database: "Creating Database",
  directories: "Creating Directory Structure",
  permissions: "Applying AI Data Permissions",
  scanning: "Scanning Your Website",
  training: "Training the AI",
  finalizing: "Finalizing Installation",
};

// Rough phase → overall-percent mapping for the scan step, which (unlike
// install/training) reports no percent of its own — only a phase name.
const SCAN_PHASE_PERCENT: Record<ScanPhase, number> = {
  discovering: 90,
  crawling: 92,
  processing_documents: 94,
  generating_report: 95,
  completed: 96,
  failed: 96,
};

class InstallStepError extends Error {
  constructor(public readonly stepId: InstallStepId, message: string, public readonly suggestedFix: string) {
    super(message);
  }
}

/**
 * Step 8+9 backend half — the Progress Engine. Runs the full install
 * pipeline and pushes real-time InstallProgressEvent frames over the
 * caller's own WebSocket room (their socket.id) so the wizard UI can render
 * a live "Checking Server... Creating Database... Installation Complete."
 * stream instead of a single blocking request.
 *
 * Also owns Step 10's rollback policy: if the *database* step itself fails,
 * the role/database may be partially created, so it's dropped automatically
 * for a clean retry. If a *later* step fails after the database was fully
 * migrated, the database is left intact (it's not the cause of the failure)
 * and the installation record inside it is simply marked FAILED for audit.
 */
export async function runInstallation(io: SocketIOServer, socketRoom: string, input: InstallInput): Promise<{ success: boolean }> {
  const events: InstallProgressEvent[] = [];

  const emit = (stepId: InstallStepId, status: InstallProgressEvent["status"], message: string, progressPercent: number, durationMs?: number) => {
    const payload: InstallProgressEvent = {
      stepId,
      label: STEP_LABELS[stepId],
      status,
      message,
      progressPercent,
      timestamp: new Date().toISOString(),
      durationMs,
    };
    events.push(payload);
    io.to(socketRoom).emit("install:progress", payload);
  };

  const timed = async <T>(stepId: InstallStepId, runningMessage: string, startPercent: number, fn: () => Promise<T>): Promise<T> => {
    emit(stepId, "running", runningMessage, startPercent);
    return fn();
  };

  let config: GeneratedConfig | undefined;
  let installationRowId: string | undefined;
  let databaseReady = false;

  try {
    const systemResult = await timed("system_check", "Checking server requirements...", 5, () => runSystemCheck());
    if (!systemResult.allRequiredPassed) {
      throw new InstallStepError(
        "system_check",
        "One or more required system checks failed",
        "Review the System Requirements screen and resolve any red items before retrying."
      );
    }
    emit("system_check", "success", "Server requirements satisfied", 15);

    await timed("environment_validation", "Detecting environment...", 20, () => runEnvironmentValidation());
    emit("environment_validation", "success", "Environment detected", 28);

    const websiteResult = await timed("website_validation", `Verifying ${input.websiteUrl}...`, 32, () => validateWebsite(input));
    if (!websiteResult.overallValid) {
      throw new InstallStepError(
        "website_validation",
        "Website validation failed",
        websiteResult.errors[0] ?? "Ensure the website is publicly reachable over a valid HTTPS certificate."
      );
    }
    emit("website_validation", "success", "Website verified", 42);

    const bundle = await timed("configuration", "Generating configuration...", 46, () =>
      generateInstallationConfigBundle(input.websiteName, input.websiteUrl)
    );
    config = bundle.config;
    emit("configuration", "success", "Configuration created", 55);

    emit("security", "running", "Generating security keys...", 58);
    // Secrets are generated as part of generateInstallationConfigBundle (Step 4/5 are
    // one atomic write to .env) — emitted as its own phase to match the spec's UX flow.
    emit("security", "success", "Security keys generated", 63);

    try {
      await timed("database", "Creating database...", 67, () =>
        initializeDatabase({
          databaseName: config!.database.name,
          databaseUser: config!.database.user,
          databasePassword: process.env.DB_PASSWORD ?? "",
        })
      );
    } catch (err) {
      throw new InstallStepError("database", "Database initialization failed", err instanceof Error ? err.message : String(err));
    }
    databaseReady = true;
    emit("database", "success", "Database ready", 80);

    // Persist the installation + secret audit trail now that its own database exists.
    const databaseUrl = process.env.DATABASE_URL ?? "";
    installationRowId = await recordInstallationStart(databaseUrl, {
      applicationId: config.applicationId,
      installationId: config.installationId,
      websiteName: input.websiteName,
      websiteUrl: input.websiteUrl,
    });
    await recordSecretFingerprints(databaseUrl, installationRowId, bundle.secretFingerprints);
    emit("database", "success", "Installation record created", 85);

    await timed("directories", "Creating directory structure...", 88, () => createDirectoryStructure());
    emit("directories", "success", "Directories ready", 89);

    // From here on, nothing is allowed to fail the *installation* — the
    // server/app itself is already fully set up and usable. A flaky scan
    // (site briefly down, etc.) or a training hiccup is recoverable later
    // from the admin dashboard's Training page, so each of these three
    // steps is independently try/caught and only ever reported via
    // `install:progress`'s "error" status, never thrown as an
    // InstallStepError (which would trigger this function's rollback path).
    emit("permissions", "running", "Applying default AI data permissions...", 90);
    try {
      const permissionService = new PermissionOrchestratorService(databaseUrl);
      try {
        await permissionService.submitWizard({
          installationId: installationRowId,
          connectorId: null,
          grantedScopes: (input.grantedScopes && input.grantedScopes.length > 0 ? input.grantedScopes : ALL_DATA_SCOPES) as never,
          actor: "system:auto-install",
        });
      } finally {
        await permissionService.close();
      }
      emit("permissions", "success", "Permissions granted", 91);
    } catch (err) {
      emit("permissions", "error", `Could not apply permissions: ${formatError(err)}`, 91);
    }

    let crawlJobId: string | undefined;
    emit("scanning", "running", `Scanning ${input.websiteUrl}...`, 92);
    try {
      const scanResult = await runWebsiteScan(databaseUrl, installationRowId, input.websiteUrl, {}, (event) => {
        emit("scanning", "running", event.message, SCAN_PHASE_PERCENT[event.phase]);
      });
      if (scanResult.success) {
        crawlJobId = scanResult.crawlJobId;
        emit("scanning", "success", `Scan complete — ${scanResult.report?.scannedPages ?? 0} page(s) found`, 96);
      } else {
        emit("scanning", "error", scanResult.errorMessage ?? "Scan failed", 96);
      }
    } catch (err) {
      emit("scanning", "error", `Scan failed: ${formatError(err)}`, 96);
    }

    if (crawlJobId) {
      emit("training", "running", "Training the AI on your website...", 97);
      try {
        const trainingResult = await runAiTraining(databaseUrl, crawlJobId, (event) => {
          emit("training", "running", event.message, 97 + Math.round((event.percent ?? 0) * 0.02));
        });
        if (trainingResult.success) {
          emit("training", "success", `Training complete — ${trainingResult.report?.embeddingsGenerated ?? 0} embeddings generated`, 99);
        } else {
          emit("training", "error", trainingResult.errorMessage ?? "Training failed", 99);
        }
      } catch (err) {
        emit("training", "error", `Training failed: ${formatError(err)}`, 99);
      }
    } else {
      emit("training", "error", "Skipped — no successful scan to train on", 99);
    }

    emit("finalizing", "running", "Finalizing installation...", 99);
    await recordProgressEvents(databaseUrl, installationRowId, events);
    await finalizeInstallationRecord(databaseUrl, installationRowId, "COMPLETED");
    emit("finalizing", "success", "Installation Complete.", 100);

    logEvent({ component: "install-orchestrator", message: `Installation completed for ${input.websiteUrl}`, status: "success" });
    return { success: true };
  } catch (err) {
    const stepError =
      err instanceof InstallStepError ? err : new InstallStepError("finalizing", "Installation failed", err instanceof Error ? err.message : String(err));

    emit(stepError.stepId, "error", stepError.message, 0);

    // Rollback policy: only the database step itself leaves a *partial*
    // database behind, so only that case gets an automatic drop. Failures
    // after the database was fully migrated leave it intact.
    if (config) {
      if (stepError.stepId === "database" || !databaseReady) {
        await rollbackDatabase({
          databaseName: config.database.name,
          databaseUser: config.database.user,
          databasePassword: process.env.DB_PASSWORD ?? "",
        }).catch((rollbackErr) => {
          logEvent({ component: "install-orchestrator", message: "Rollback attempt failed", status: "error", error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr) });
        });
      } else if (installationRowId) {
        const databaseUrl = process.env.DATABASE_URL ?? "";
        await recordProgressEvents(databaseUrl, installationRowId, events).catch(() => undefined);
        await finalizeInstallationRecord(databaseUrl, installationRowId, "FAILED").catch(() => undefined);
      }
    }

    const errorDetail: InstallErrorDetail = {
      stepId: stepError.stepId,
      title: "Installation failed",
      message: stepError.message,
      suggestedFix: stepError.suggestedFix,
      retryable: true,
    };
    io.to(socketRoom).emit("install:error", errorDetail);

    logEvent({
      component: "install-orchestrator",
      message: `Installation failed at step "${stepError.stepId}": ${stepError.message}`,
      status: "error",
      error: stepError.message,
    });
    return { success: false };
  }
}
