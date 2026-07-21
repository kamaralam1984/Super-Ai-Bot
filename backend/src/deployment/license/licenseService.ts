// License Management — the impure orchestration edge: file reads, the
// machine fingerprint, and persistence, composed with licenseValidator.ts's
// pure signature/expiry/binding logic.

import { parseLicenseFile, evaluateLicense, type SignedLicenseFile } from "./licenseValidator";
import { computeMachineFingerprint } from "./machineFingerprint";
import { LicenseRecordService, type LicenseRow } from "./licenseRecord.service";
import { logEvent } from "../../utils/logger";
import { recordAuditEvent } from "../../knowledge/security/auditLog";

export interface ActivationResult {
  ok: boolean;
  detail: string;
  license: LicenseRow | null;
}

/**
 * Activates a license file against this machine — the vendor is expected
 * to have already issued the file bound to this machine's own
 * fingerprint (an out-of-band request/issue step; see
 * deployment/cli/printMachineFingerprint.js and signLicense.js), so this
 * step is "verify, then record" rather than "bind for the first time":
 * activation succeeds only when the file's own declared fingerprint (if
 * any) matches this machine, or the file declares none at all (an
 * unrestricted/trial license).
 */
export async function activateLicense(databaseUrl: string, installationId: string, licenseFileContent: string): Promise<ActivationResult> {
  let file: SignedLicenseFile;
  try {
    file = parseLicenseFile(licenseFileContent);
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err), license: null };
  }

  const currentFingerprint = computeMachineFingerprint();
  const verdict = evaluateLicense(file, { currentMachineFingerprint: currentFingerprint, boundFingerprint: file.payload.machineFingerprint });

  const records = new LicenseRecordService(databaseUrl);
  try {
    if (!verdict.ok) {
      logEvent({ component: "deployment-license", message: `License activation rejected: ${verdict.reason}`, status: "warn", error: verdict.detail });
      recordAuditEvent({ type: "deployment_license_activation_rejected", detail: `${verdict.reason}: ${verdict.detail}`, component: "deployment-license" });
      return { ok: false, detail: verdict.detail, license: null };
    }
    const row = await records.upsert(installationId, file, currentFingerprint, "ACTIVE");
    logEvent({ component: "deployment-license", message: `License activated: ${row.tier} tier for installation ${installationId}`, status: "success" });
    recordAuditEvent({ type: "deployment_license_activated", detail: `${row.tier} tier, customer=${file.payload.customerName}`, component: "deployment-license" });
    return { ok: true, detail: verdict.detail, license: row };
  } finally {
    await records.close();
  }
}

/**
 * Re-checks an already-activated license — re-verifies the signature of
 * the stored payload (so tampering with the database row directly can
 * never produce a falsely-valid result: the signature was computed over
 * the original payload, and any edit invalidates it), checks expiry
 * against *now*, and confirms this machine's current fingerprint still
 * matches what was recorded at activation time. Updates the stored
 * status accordingly and returns the current verdict.
 */
export async function validateLicense(databaseUrl: string, installationId: string): Promise<{ verdict: ReturnType<typeof evaluateLicense>; license: LicenseRow | null }> {
  const records = new LicenseRecordService(databaseUrl);
  try {
    const row = await records.get(installationId);
    if (!row) {
      return { verdict: { ok: false, reason: "malformed", detail: "No license activated for this installation." }, license: null };
    }
    const currentFingerprint = computeMachineFingerprint();
    const verdict = evaluateLicense(row.payload, { currentMachineFingerprint: currentFingerprint, boundFingerprint: row.machineFingerprint });

    const newStatus = verdict.ok ? "ACTIVE" : verdict.reason === "expired" ? "EXPIRED" : "INVALID";
    if (newStatus !== row.status) {
      await records.updateStatus(installationId, newStatus);
      if (!verdict.ok) {
        recordAuditEvent({ type: "deployment_license_validation_failed", detail: `${verdict.reason}: ${verdict.detail}`, component: "deployment-license" });
      }
    }
    return { verdict, license: { ...row, status: newStatus } };
  } finally {
    await records.close();
  }
}

export async function getLicenseStatus(databaseUrl: string, installationId: string): Promise<LicenseRow | null> {
  const records = new LicenseRecordService(databaseUrl);
  try {
    return await records.get(installationId);
  } finally {
    await records.close();
  }
}
