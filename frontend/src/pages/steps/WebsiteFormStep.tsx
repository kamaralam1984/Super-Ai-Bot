import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Link2 } from "lucide-react";
import { api } from "../../lib/api";
import { CheckList, type CheckListItem } from "../../components/CheckList";
import { PrimaryButton } from "../../components/PrimaryButton";
import { StepHeader } from "../../components/StepHeader";
import type { WebsiteValidationResult } from "@kvl/shared";

interface WebsiteFormStepProps {
  websiteName: string;
  websiteUrl: string;
  onChange: (values: { websiteName: string; websiteUrl: string }) => void;
  onNext: () => void;
}

function toChecklist(result: WebsiteValidationResult): CheckListItem[] {
  return [
    { id: "dns", label: "DNS Resolution", status: result.dns.resolved ? "pass" : "fail", detail: result.dns.resolved ? result.dns.addresses.join(", ") : "Domain does not resolve" },
    { id: "https", label: "HTTPS", status: result.https.supported ? "pass" : "fail", detail: result.https.supported ? "TLS endpoint responding" : "No TLS endpoint on port 443" },
    { id: "ssl", label: "SSL Certificate", status: result.ssl.valid ? "pass" : "fail", detail: result.ssl.valid ? `Issued by ${result.ssl.issuer}, expires ${result.ssl.expiresAt?.slice(0, 10)}` : "Certificate missing, expired, or untrusted" },
    { id: "redirect", label: "HTTP → HTTPS Redirect", status: result.httpRedirectsToHttps ? "pass" : "warn", detail: result.httpRedirectsToHttps ? "Redirects correctly" : "No automatic redirect detected", required: false },
    { id: "reachable", label: "Website Reachability", status: result.reachable.ok ? "pass" : "fail", detail: result.reachable.ok ? `Responded in ${result.reachable.latencyMs}ms (HTTP ${result.reachable.statusCode})` : "URL is not reachable" },
    { id: "homepage", label: "Homepage Availability", status: result.homepageAvailable ? "pass" : "fail", detail: result.homepageAvailable ? "Homepage responded successfully" : "Homepage did not load" },
    { id: "robots", label: "robots.txt", status: result.robotsTxt.found ? "pass" : "warn", detail: result.robotsTxt.found ? "Found" : "Not found (optional)", required: false },
    { id: "sitemap", label: "sitemap.xml", status: result.sitemapXml.found ? "pass" : "warn", detail: result.sitemapXml.found ? "Found" : "Not found (optional)", required: false },
  ];
}

export function WebsiteFormStep({ websiteName, websiteUrl, onChange, onNext }: WebsiteFormStepProps) {
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState<WebsiteValidationResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (websiteName.trim().length < 2) {
      setFormError("Website Name must be at least 2 characters.");
      return;
    }
    try {
      const parsed = new URL(websiteUrl.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    } catch {
      setFormError("Enter a valid URL including https://");
      return;
    }

    setValidating(true);
    setResult(null);
    api
      .validateWebsite({ websiteName: websiteName.trim(), websiteUrl: websiteUrl.trim() })
      .then(setResult)
      .catch((err) => setFormError(err instanceof Error ? err.message : "Validation failed"))
      .finally(() => setValidating(false));
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}>
      <StepHeader icon={Link2} title="Your Website" subtitle="That's all we need — everything else is automatic." />

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="websiteName" className="block text-sm font-medium text-ink mb-1.5">
            Website Name
          </label>
          <input
            id="websiteName"
            name="websiteName"
            type="text"
            required
            autoFocus
            value={websiteName}
            onChange={(e) => onChange({ websiteName: e.target.value, websiteUrl })}
            placeholder="Acme Corporation"
            className="w-full rounded-lg border border-border bg-surface-raised/60 px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint transition-colors focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label htmlFor="websiteUrl" className="block text-sm font-medium text-ink mb-1.5">
            Website URL
          </label>
          <input
            id="websiteUrl"
            name="websiteUrl"
            type="url"
            required
            value={websiteUrl}
            onChange={(e) => onChange({ websiteName, websiteUrl: e.target.value })}
            placeholder="https://example.com"
            className="data-value w-full rounded-lg border border-border bg-surface-raised/60 px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint placeholder:font-sans transition-colors focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>

        {formError && (
          <div role="alert" className="rounded-lg border border-critical/30 bg-critical/10 p-3 text-sm text-critical">
            {formError}
          </div>
        )}

        <PrimaryButton type="submit" loading={validating} className="w-full">
          Validate Website
        </PrimaryButton>
      </form>

      {result && (
        <div className="mt-5" aria-live="polite">
          <CheckList items={toChecklist(result)} />
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <PrimaryButton onClick={onNext} disabled={!result?.overallValid}>
          Continue
        </PrimaryButton>
      </div>
    </motion.div>
  );
}
