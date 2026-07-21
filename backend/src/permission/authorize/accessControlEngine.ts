// Access Control Engine — pure authorization decision logic. Given the set
// of an installation's currently loaded grants and a request for one data
// scope, decides allow/deny. No Prisma, no I/O — the only place that
// touches the database is permissionRecord.service.ts, which loads the
// grants this module evaluates and is the sole caller of it.

import type { AccessDecision, AccessRequest, PermissionGrantRecord } from "../types";

/**
 * Evaluates one access request against a caller-supplied grant list.
 * Deliberately re-checks `status === "ACTIVE"` even though callers are
 * expected to pass only active grants — a defense-in-depth check against a
 * future caller accidentally passing the full (including revoked) history.
 * Connector-scoped requests never fall back to a site-level grant, and
 * vice versa: they are different data sources, and silently widening one
 * into the other would defeat the point of letting an administrator
 * authorize them independently.
 */
export function evaluateAccess(grants: PermissionGrantRecord[], request: AccessRequest): AccessDecision {
  const connectorId = request.connectorId ?? null;
  const match = grants.find((g) => g.status === "ACTIVE" && g.dataScope === request.dataScope && g.connectorId === connectorId);

  if (!match) {
    return {
      allowed: false,
      dataScope: request.dataScope,
      connectorId,
      reason: connectorId
        ? `No active permission grant for scope "${request.dataScope}" on connector "${connectorId}". An administrator must authorize this category in the Permission Wizard before the AI can use it.`
        : `No active permission grant for scope "${request.dataScope}" on this installation's knowledge base. An administrator must authorize this category in the Permission Wizard before the AI can use it.`,
    };
  }

  return {
    allowed: true,
    dataScope: request.dataScope,
    connectorId,
    reason: `Authorized by grant ${match.id}, granted by ${match.grantedBy}.`,
    matchedGrantId: match.id,
  };
}

export interface BatchAccessQuery {
  dataScope: AccessRequest["dataScope"];
  connectorId?: string | null;
}

/** Batch form — used where a caller needs to know which of several scopes are open before deciding whether to run a whole pipeline stage (e.g. skip enrichment entirely rather than fetch data it can't use). */
export function evaluateAccessBatch(grants: PermissionGrantRecord[], installationId: string, queries: BatchAccessQuery[], purpose: string): AccessDecision[] {
  return queries.map((q) => evaluateAccess(grants, { installationId, dataScope: q.dataScope, connectorId: q.connectorId, purpose }));
}
