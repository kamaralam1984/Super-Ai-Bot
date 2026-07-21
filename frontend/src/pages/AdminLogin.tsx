import { useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { ShieldCheck, KeyRound, AlertTriangle } from "lucide-react";
import { AmbientCanvas } from "../components/AmbientCanvas";
import { ThemeToggle } from "../components/ThemeToggle";
import { PrimaryButton } from "../components/PrimaryButton";
import { api, ApiError } from "../lib/api";

/**
 * The admin dashboard's front door — exchanges the installation's own
 * API_SECRET (the same master credential every backend admin route has
 * required since Phase 2) for a session cookie, once. Nothing here ever
 * stores that secret in the browser afterward (see lib/api.ts's `admin`
 * namespace and backend/src/middleware/adminSession.ts) — this form's
 * only job is that one exchange.
 */
export function AdminLogin() {
  const [apiSecret, setApiSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.admin.login(apiSecret);
      const redirectTo = (location.state as { from?: string } | null)?.from ?? "/dashboard";
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed — check the server is reachable.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-ground px-4 py-8 sm:py-12">
      <AmbientCanvas />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgb(var(--accent)/0.08),transparent)]" />

      <div className="relative mx-auto flex min-h-[80vh] w-full max-w-md flex-col justify-center">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            <span className="font-display text-[15px] font-semibold tracking-tight text-ink">KVL Super AI Chatbot</span>
            <span className="data-label hidden sm:inline text-ink-faint">/ admin</span>
          </div>
          <ThemeToggle />
        </div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="rounded-2xl border border-border bg-surface/80 p-6 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
              <ShieldCheck size={19} aria-hidden="true" />
            </div>
            <div>
              <h1 className="font-display text-[17px] font-semibold text-ink">Admin sign in</h1>
              <p className="text-xs text-ink-muted">Enter this installation's API secret to open the dashboard.</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative">
              <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
              <input
                type="password"
                autoFocus
                required
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="API_SECRET"
                autoComplete="current-password"
                className="w-full rounded-lg border border-border bg-surface-raised/60 py-2.5 pl-9 pr-4 text-sm text-ink placeholder:text-ink-faint transition-colors focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            {error && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="alert" className="flex items-start gap-1.5 text-xs text-critical">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                {error}
              </motion.p>
            )}

            <PrimaryButton type="submit" loading={submitting} className="w-full justify-center">
              Sign in
            </PrimaryButton>
          </form>

          <p className="mt-4 text-xs text-ink-faint">
            Found in this installation's <code className="data-value">.env</code> file as <code className="data-value">API_SECRET</code>.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
