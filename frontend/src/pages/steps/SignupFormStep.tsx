import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Building2 } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { PrimaryButton } from "../../components/PrimaryButton";
import { StepHeader } from "../../components/StepHeader";

interface SignupFormStepProps {
  businessName: string;
  websiteUrl: string;
  email: string;
  password: string;
  onChange: (values: { businessName: string; websiteUrl: string; email: string; password: string }) => void;
  onNext: (result: { accountId: string; installationId: string }) => void;
}

/**
 * Modeled on WebsiteFormStep.tsx's validate-then-submit pattern, extended
 * with the account fields a tenant needs (email/password) that the
 * platform installer's own WebsiteFormStep never had to collect (there is
 * only ever one admin there, authenticated via a shared API_SECRET, not a
 * per-tenant account). Client-side checks are a first pass only — the
 * real validation (email uniqueness, password strength) happens server-side
 * in POST /api/tenant/signup and surfaces here as formError.
 */
export function SignupFormStep({ businessName, websiteUrl, email, password, onChange, onNext }: SignupFormStepProps) {
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function set(partial: Partial<{ businessName: string; websiteUrl: string; email: string; password: string }>) {
    onChange({ businessName, websiteUrl, email, password, ...partial });
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (businessName.trim().length < 2) {
      setFormError("Business name must be at least 2 characters.");
      return;
    }
    try {
      const parsed = new URL(websiteUrl.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    } catch {
      setFormError("Enter a valid URL including https://");
      return;
    }
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    api.tenant
      .signup({ businessName: businessName.trim(), websiteUrl: websiteUrl.trim(), email: email.trim(), password })
      .then(onNext)
      .catch((err) => setFormError(err instanceof ApiError ? err.message : "Signup failed — check the server is reachable."))
      .finally(() => setSubmitting(false));
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}>
      <StepHeader icon={Building2} title="Create your account" subtitle="Tell us about your business and website — we'll take it from here." />

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="businessName" className="block text-sm font-medium text-ink mb-1.5">
            Business Name
          </label>
          <input
            id="businessName"
            type="text"
            required
            autoFocus
            value={businessName}
            onChange={(e) => set({ businessName: e.target.value })}
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
            type="url"
            required
            value={websiteUrl}
            onChange={(e) => set({ websiteUrl: e.target.value })}
            placeholder="https://example.com"
            className="data-value w-full rounded-lg border border-border bg-surface-raised/60 px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint placeholder:font-sans transition-colors focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-ink mb-1.5">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => set({ email: e.target.value })}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-border bg-surface-raised/60 px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint transition-colors focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-ink mb-1.5">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => set({ password: e.target.value })}
            placeholder="At least 8 characters"
            className="w-full rounded-lg border border-border bg-surface-raised/60 px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint transition-colors focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>

        {formError && (
          <div role="alert" className="rounded-lg border border-critical/30 bg-critical/10 p-3 text-sm text-critical">
            {formError}
          </div>
        )}

        <PrimaryButton type="submit" loading={submitting} className="w-full justify-center">
          Create Account
        </PrimaryButton>
      </form>
    </motion.div>
  );
}
