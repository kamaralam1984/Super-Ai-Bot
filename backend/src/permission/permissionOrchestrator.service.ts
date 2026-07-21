// KVL Enterprise Permission & Connector Access Engine (Phase 7) — top-level
// orchestrator. Composes the pure wizard/policy/authorize engines with the
// record service and audit logging into the operations every caller
// actually needs: read wizard state, apply a wizard submission, check one
// access request, list grants/events. permission.routes.ts and the
// integration wrappers consumed by Phase 5/6 (authorizedTrainingRecord
// Service, authorizedAiToolLayer) are the only callers.

import { buildWizardState, diffWizardSubmission } from "./wizard/permissionWizardEngine";
import { evaluateAccess } from "./authorize/accessControlEngine";
import { logPermissionEvent } from "./audit/permissionEvents";
import { PermissionRecordService } from "./permissionRecord.service";
import type { AccessDecision, AccessRequest, DataScope, PermissionGrantRecord, WizardState, WizardSubmission } from "./types";
import type { PermissionEventRecord } from "./permissionRecord.service";

export interface WizardSubmissionResult {
  granted: DataScope[];
  revoked: DataScope[];
  unchanged: DataScope[];
  state: WizardState;
}

/**
 * Accepts either a database URL (constructs and owns its own
 * PermissionRecordService, closed by this.close()) or an already-open
 * PermissionRecordService (shared with a caller that manages its own
 * lifecycle, e.g. an integration wrapper that already holds one connection
 * per request) — the same "own vs. borrowed" flexibility Phase 5's
 * orchestrator gets for free by always owning its own, made explicit here
 * because integration wrappers specifically want to share a connection
 * rather than open a second one per data read.
 */
export class PermissionOrchestratorService {
  private records: PermissionRecordService;
  private ownsRecords: boolean;

  constructor(databaseUrlOrRecords: string | PermissionRecordService) {
    if (typeof databaseUrlOrRecords === "string") {
      this.records = new PermissionRecordService(databaseUrlOrRecords);
      this.ownsRecords = true;
    } else {
      this.records = databaseUrlOrRecords;
      this.ownsRecords = false;
    }
  }

  async close(): Promise<void> {
    if (this.ownsRecords) await this.records.close();
  }

  async getWizardState(installationId: string, connectorId: string | null = null): Promise<WizardState> {
    const activeGrants = await this.records.getActiveGrants(installationId);
    return buildWizardState(installationId, connectorId, activeGrants);
  }

  /** Applies a full wizard submission: diffs against current active grants for the target (site, or one connector), then grants/revokes exactly what changed. Every grant/revoke is individually audit-logged (file + DB); one WIZARD_COMPLETED summary event closes it out. */
  async submitWizard(submission: WizardSubmission): Promise<WizardSubmissionResult> {
    const connectorId = submission.connectorId ?? null;
    const activeGrants = await this.records.getActiveGrants(submission.installationId);
    const currentScoped = activeGrants.filter((g) => g.connectorId === connectorId).map((g) => g.dataScope);
    const diff = diffWizardSubmission(currentScoped, submission.grantedScopes);

    for (const scope of diff.toGrant) {
      await this.records.grantScope({ installationId: submission.installationId, connectorId, dataScope: scope, grantedBy: submission.actor, notes: submission.notes });
      await this.records.recordEvent(submission.installationId, "GRANTED", `Scope ${scope} granted by ${submission.actor}${connectorId ? ` for connector ${connectorId}` : ""}.`, { connectorId, dataScope: scope });
      logPermissionEvent(submission.installationId, "GRANTED", `${scope} granted by ${submission.actor}${connectorId ? ` (connector ${connectorId})` : ""}`);
    }

    for (const scope of diff.toRevoke) {
      await this.records.revokeScope({ installationId: submission.installationId, connectorId, dataScope: scope, revokedBy: submission.actor });
      await this.records.recordEvent(submission.installationId, "REVOKED", `Scope ${scope} revoked by ${submission.actor}${connectorId ? ` for connector ${connectorId}` : ""}.`, { connectorId, dataScope: scope });
      logPermissionEvent(submission.installationId, "REVOKED", `${scope} revoked by ${submission.actor}${connectorId ? ` (connector ${connectorId})` : ""}`);
    }

    await this.records.recordEvent(submission.installationId, "WIZARD_COMPLETED", `Permission wizard completed by ${submission.actor}: ${diff.toGrant.length} granted, ${diff.toRevoke.length} revoked, ${diff.unchanged.length} unchanged.`, { connectorId });
    logPermissionEvent(submission.installationId, "WIZARD_COMPLETED", `${submission.actor} completed the wizard${connectorId ? ` for connector ${connectorId}` : ""} — ${diff.toGrant.length} granted / ${diff.toRevoke.length} revoked`);

    const state = await this.getWizardState(submission.installationId, connectorId);
    return { granted: diff.toGrant, revoked: diff.toRevoke, unchanged: diff.unchanged, state };
  }

  /**
   * The authorization choke point every internal data consumer (the
   * Training Engine, the AI tool layer) calls before reading a row of
   * business data. Every check — allowed or denied — is audit-logged,
   * matching the spec's "audit logged" requirement for authorization
   * events, not just denials. Never throws on its own; callers that want a
   * hard failure (e.g. the integration wrappers) raise an AppError
   * themselves after inspecting `.allowed`, keeping this engine free of any
   * HTTP-layer concern.
   */
  async checkAccess(request: AccessRequest): Promise<AccessDecision> {
    const activeGrants = await this.records.getActiveGrants(request.installationId);
    const decision = evaluateAccess(activeGrants, request);

    const eventType = decision.allowed ? "ACCESS_CHECKED" : "ACCESS_DENIED";
    await this.records.recordEvent(request.installationId, eventType, `${request.purpose}: ${decision.dataScope}${decision.connectorId ? ` (connector ${decision.connectorId})` : ""} → ${decision.allowed ? "allowed" : "denied"}.`, {
      connectorId: decision.connectorId,
      dataScope: decision.dataScope,
      metadata: { purpose: request.purpose },
    });
    if (!decision.allowed) {
      logPermissionEvent(request.installationId, "ACCESS_DENIED", `${request.purpose} denied for ${decision.dataScope}${decision.connectorId ? ` (connector ${decision.connectorId})` : ""}: ${decision.reason}`);
    }
    return decision;
  }

  async listGrants(installationId: string, connectorId?: string | null): Promise<PermissionGrantRecord[]> {
    return this.records.getAllGrants(installationId, connectorId);
  }

  async listEvents(installationId: string, limit?: number): Promise<PermissionEventRecord[]> {
    return this.records.getEvents(installationId, limit);
  }
}
