import { useEffect, useState } from "react";
import { BadgeCheck, Loader2, RefreshCw } from "lucide-react";
import { StepHeader } from "../../components/StepHeader";
import { StatusIcon } from "../../components/StatusIcon";
import { PrimaryButton } from "../../components/PrimaryButton";
import { api, ApiError } from "../../lib/api";
import type { LicenseRow } from "../../lib/dashboardTypes";

const STATUS_TO_CHECK: Record<LicenseRow["status"], "pass" | "warn" | "fail"> = {
  ACTIVE: "pass",
  EXPIRED: "fail",
  INVALID: "fail",
  REVOKED: "fail",
};

export function LicensePage() {
  const [license, setLicense] = useState<LicenseRow | null | undefined>(undefined);
  const [fileContent, setFileContent] = useState("");
  const [activating, setActivating] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.deployment.getLicense().then(setLicense).catch(() => setLicense(null));
  }
  useEffect(load, []);

  async function activate() {
    setActivating(true);
    setError(null);
    try {
      const row = await api.deployment.activateLicense(fileContent);
      setLicense(row);
      setFileContent("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Activation failed.");
    } finally {
      setActivating(false);
    }
  }

  async function validate() {
    setValidating(true);
    try {
      const result = await api.deployment.validateLicense();
      setLicense(result.license);
    } finally {
      setValidating(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <StepHeader icon={BadgeCheck} title="License" subtitle="Local, offline signature validation — no SaaS license server involved." />

      {license === undefined && (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…
        </div>
      )}

      {license === null && <p className="mb-5 text-sm text-ink-muted">No license activated yet.</p>}

      {license && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-sm">
          <StatusIcon status={STATUS_TO_CHECK[license.status]} />
          <div className="min-w-0 flex-1">
            <p className="text-ink">{license.tier} — {license.status}</p>
            <p className="text-xs text-ink-muted">
              Activated {new Date(license.activatedAt).toLocaleDateString()}
              {license.expiresAt ? ` · expires ${new Date(license.expiresAt).toLocaleDateString()}` : " · perpetual"}
            </p>
          </div>
          <PrimaryButton variant="ghost" onClick={validate} loading={validating}>
            <RefreshCw size={13} aria-hidden="true" /> Re-validate
          </PrimaryButton>
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface/60 p-4">
        <p className="mb-2 text-sm font-medium text-ink">Activate a license</p>
        <textarea
          value={fileContent}
          onChange={(e) => setFileContent(e.target.value)}
          rows={6}
          placeholder="Paste the signed license file's JSON content here"
          className="w-full rounded-lg border border-border bg-surface-raised/60 px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        />
        {error && <p className="mt-2 text-xs text-critical">{error}</p>}
        <PrimaryButton className="mt-3" onClick={activate} loading={activating} disabled={!fileContent.trim()}>
          Activate
        </PrimaryButton>
      </div>
    </div>
  );
}
