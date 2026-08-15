// The one shared "which installation is this request scoped to" resolver.
// Generalizes monitor.routes.ts's previous local resolveInstallationId
// helper (client-supplied installationId, falling back to
// getActiveInstallationId) into a tenant-aware version every converted
// route calls the same way, so ownership enforcement lives in exactly one
// place rather than being re-derived per router.

import type { Request } from "express";
import { getActiveInstallationId } from "../scanner/scanRecord.service";
import { AppError } from "./errorHandler";

/**
 * - A tenant session present (req.tenantContext set by injectTenantContext):
 *   always resolves to that tenant's own installationId. A client-supplied
 *   installationId that doesn't match is a 403, not silently ignored —
 *   this is the ownership check that closes the gap connector.routes.ts /
 *   permission.routes.ts / training.routes.ts previously had (any
 *   authenticated caller could pass any installationId with zero check).
 * - No tenant session, client-supplied installationId present: the
 *   existing super-admin / raw x-api-key caller behavior — unchanged.
 * - No tenant session, no client-supplied id: falls back to
 *   getActiveInstallationId (the platform owner's own, accountId:null
 *   installation) — also unchanged from today.
 */
export async function resolveInstallationId(req: Request, databaseUrl: string, clientSupplied: string | undefined): Promise<string> {
  if (req.tenantContext) {
    if (clientSupplied && clientSupplied !== req.tenantContext.installationId) {
      throw new AppError(403, "Not authorized for this installation", "This session is not permitted to access that installation.", false);
    }
    return req.tenantContext.installationId;
  }
  if (clientSupplied) return clientSupplied;
  const legacy = await getActiveInstallationId(databaseUrl);
  if (!legacy) throw new AppError(400, "No completed installation found", "Complete the installer (Phase 1) first.", true);
  return legacy;
}
