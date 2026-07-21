import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Globe2, Loader2 } from "lucide-react";
import { api } from "../../lib/api";
import { PrimaryButton } from "../../components/PrimaryButton";
import { StepHeader } from "../../components/StepHeader";
import type { EnvironmentInfo } from "@kvl/shared";

function InfoRow({ label, value, index }: { label: string; value: string; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.04 }}
      className="flex items-center justify-between py-2.5 px-4 text-sm"
    >
      <span className="text-ink-muted">{label}</span>
      <span className="data-value text-right truncate max-w-[60%] text-ink">{value}</span>
    </motion.div>
  );
}

export function EnvironmentStep({ onNext }: { onNext: () => void }) {
  const [env, setEnv] = useState<EnvironmentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .environment()
      .then(setEnv)
      .catch((err) => setError(err instanceof Error ? err.message : "Environment detection failed"));
  }, []);

  const rows = env
    ? [
        { label: "Operating System", value: `${env.os} ${env.osVersion}` },
        { label: "Hostname", value: env.hostname },
        { label: "Timezone", value: env.timezone },
        { label: "Public IP", value: env.publicIp ?? "Not detected" },
        { label: "HTTPS (port 443)", value: env.https.port443Listening ? "Listening" : "Not listening" },
        { label: "SSL Certificate", value: env.sslCertificate.found ? `Found (${env.sslCertificate.source})` : "Not found" },
        {
          label: "Firewall",
          value: env.firewall.tool ? `${env.firewall.tool} — ${env.firewall.active === null ? "unknown" : env.firewall.active ? "active" : "inactive"}` : "Not detected",
        },
        { label: "Web Server", value: [env.webServer.nginx && "nginx", env.webServer.apache && "Apache"].filter(Boolean).join(", ") || "None detected" },
        { label: "Docker", value: env.docker.installed ? (env.docker.running ? "Installed, running" : "Installed, not running") : "Not installed" },
      ]
    : [];

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}>
      <StepHeader icon={Globe2} title="Environment" subtitle="Detected automatically from your server." />

      <div aria-live="polite">
        {error && <div className="rounded-xl border border-critical/30 bg-critical/10 p-4 text-sm text-critical">{error}</div>}
        {!env && !error && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-muted">
            <Loader2 size={15} className="animate-spin text-accent" aria-hidden="true" />
            Detecting environment...
          </div>
        )}
        {env && (
          <div className="rounded-xl border border-border divide-y divide-border bg-surface/50">
            {rows.map((row, i) => (
              <InfoRow key={row.label} index={i} {...row} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-end">
        <PrimaryButton onClick={onNext} disabled={!env}>
          Continue
        </PrimaryButton>
      </div>
    </motion.div>
  );
}
