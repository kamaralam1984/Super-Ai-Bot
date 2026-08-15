import type { Server as SocketIOServer } from "socket.io";
import type { DataScope, OnboardingErrorDetail, OnboardingProgressEvent, OnboardingStepId } from "@kvl/shared";
import { PrismaClient } from "@prisma/client";
import { recordProgressEvents, finalizeInstallationRecord } from "./installationRecord.service";
import { PermissionOrchestratorService } from "../permission/permissionOrchestrator.service";
import { ALL_DATA_SCOPES } from "../permission/types";
import { runWebsiteScan, type ScanPhase } from "../scanner/scanOrchestrator.service";
import { runAiTraining } from "../training/trainingOrchestrator.service";
import { logEvent } from "../utils/logger";
import { formatError } from "../utils/formatError";

export interface TenantOnboardingInput {
  accountId: string;
  installationRowId: string;
  websiteUrl: string;
  grantedScopes?: DataScope[];
}

const STEP_LABELS: Record<OnboardingStepId, string> = {
  permissions: "Applying AI Data Permissions",
  scanning: "Scanning Your Website",
  training: "Training the AI",
  finalizing: "Finalizing Setup",
};

const SCAN_PHASE_PERCENT: Record<ScanPhase, number> = {
  discovering: 30,
  crawling: 45,
  processing_documents: 60,
  generating_report: 68,
  completed: 70,
  failed: 70,
};

/**
 * A deliberately shorter sibling of installOrchestrator.service.ts's
 * runInstallation — reuses the exact same scan/training/permissions
 * building blocks, but skips every platform-installer-only step (system
 * check, environment validation, configuration/secret generation, database
 * provisioning, directories): a tenant signup never touches .env, never
 * provisions a new database, and never re-runs the security/system checks
 * that only make sense once per deployment. The Account + Installation
 * rows already exist (created by tenantAuth.routes.ts's /signup, in the
 * one shared database) before this ever runs — this function only ever
 * scans, trains, applies permissions, and marks both rows complete.
 *
 * Emits over "onboarding:progress"/"onboarding:error" — distinct event
 * names from the platform installer's "install:progress"/"install:error",
 * so both pipelines can run concurrently in the same process (a tenant
 * signing up while KVL's own admin happens to be mid-reinstall in another
 * tab, however unlikely) without either's listeners ever seeing the
 * other's events.
 */
export async function runTenantOnboarding(io: SocketIOServer, socketRoom: string, input: TenantOnboardingInput): Promise<{ success: boolean }> {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const events: OnboardingProgressEvent[] = [];

  const emit = (stepId: OnboardingStepId, status: OnboardingProgressEvent["status"], message: string, progressPercent: number, durationMs?: number) => {
    const payload: OnboardingProgressEvent = {
      stepId,
      label: STEP_LABELS[stepId],
      status,
      message,
      progressPercent,
      timestamp: new Date().toISOString(),
      durationMs,
    };
    events.push(payload);
    io.to(socketRoom).emit("onboarding:progress", payload);
  };

  try {
    emit("permissions", "running", "Applying default AI data permissions...", 5);
    try {
      const permissionService = new PermissionOrchestratorService(databaseUrl);
      try {
        await permissionService.submitWizard({
          installationId: input.installationRowId,
          connectorId: null,
          grantedScopes: (input.grantedScopes && input.grantedScopes.length > 0 ? input.grantedScopes : ALL_DATA_SCOPES) as never,
          actor: "system:tenant-signup",
        });
      } finally {
        await permissionService.close();
      }
      emit("permissions", "success", "Permissions granted", 15);
    } catch (err) {
      emit("permissions", "error", `Could not apply permissions: ${formatError(err)}`, 15);
    }

    let crawlJobId: string | undefined;
    emit("scanning", "running", `Scanning ${input.websiteUrl}...`, 20);
    try {
      const scanResult = await runWebsiteScan(databaseUrl, input.installationRowId, input.websiteUrl, {}, (event) => {
        emit("scanning", "running", event.message, SCAN_PHASE_PERCENT[event.phase]);
      });
      if (scanResult.success) {
        crawlJobId = scanResult.crawlJobId;
        emit("scanning", "success", `Scan complete — ${scanResult.report?.scannedPages ?? 0} page(s) found`, 70);
      } else {
        emit("scanning", "error", scanResult.errorMessage ?? "Scan failed", 70);
      }
    } catch (err) {
      emit("scanning", "error", `Scan failed: ${formatError(err)}`, 70);
    }

    if (crawlJobId) {
      emit("training", "running", "Training the AI on your website...", 75);
      try {
        const trainingResult = await runAiTraining(databaseUrl, crawlJobId, (event) => {
          emit("training", "running", event.message, 75 + Math.round((event.percent ?? 0) * 0.2));
        });
        if (trainingResult.success) {
          emit("training", "success", `Training complete — ${trainingResult.report?.embeddingsGenerated ?? 0} embeddings generated`, 95);
        } else {
          emit("training", "error", trainingResult.errorMessage ?? "Training failed", 95);
        }
      } catch (err) {
        emit("training", "error", `Training failed: ${formatError(err)}`, 95);
      }
    } else {
      emit("training", "error", "Skipped — no successful scan to train on", 95);
    }

    emit("finalizing", "running", "Finalizing your account...", 97);
    await recordProgressEvents(databaseUrl, input.installationRowId, events);
    await finalizeInstallationRecord(databaseUrl, input.installationRowId, "COMPLETED");

    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      await prisma.account.update({ where: { id: input.accountId }, data: { status: "ACTIVE" } });
    } finally {
      await prisma.$disconnect();
    }

    emit("finalizing", "success", "Setup complete.", 100);
    logEvent({ component: "tenant-onboarding", message: `Onboarding completed for account ${input.accountId} (${input.websiteUrl})`, status: "success" });
    return { success: true };
  } catch (err) {
    const message = formatError(err);
    emit("finalizing", "error", message, 0);

    await recordProgressEvents(databaseUrl, input.installationRowId, events).catch(() => undefined);
    await finalizeInstallationRecord(databaseUrl, input.installationRowId, "FAILED").catch(() => undefined);

    const errorDetail: OnboardingErrorDetail = {
      stepId: "finalizing",
      title: "Onboarding failed",
      message,
      suggestedFix: "Retry from your dashboard's Training page, or contact support if this keeps happening.",
      retryable: true,
    };
    io.to(socketRoom).emit("onboarding:error", errorDetail);

    logEvent({ component: "tenant-onboarding", message: `Onboarding failed for account ${input.accountId}: ${message}`, status: "error", error: message });
    return { success: false };
  }
}
