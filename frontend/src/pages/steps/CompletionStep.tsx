import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, ExternalLink, Globe, ShieldCheck, Server, Copy, Check } from "lucide-react";
import { PrimaryButton } from "../../components/PrimaryButton";

export function CompletionStep({ websiteName, websiteUrl }: { websiteName: string; websiteUrl: string }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  // Correct in the deployment this screen is actually meant for — a
  // production install sitting behind one public domain (nginx routes both
  // /widget.js and the SPA from that same origin, see deploy/nginx/conf.d/
  // kvl-locations.conf). In local dev the frontend (:3041) and backend
  // (:4500) are two different origins, so this snippet only becomes
  // copy-paste-correct once actually deployed — which matches every other
  // "your production URL" assumption already baked into this installer.
  const embedSnippet = `<script src="${window.location.origin}/widget.js"></script>`;

  function copySnippet() {
    navigator.clipboard.writeText(embedSnippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, type: "spring", stiffness: 120 }}
      className="text-center py-2"
    >
      <div className="relative mx-auto flex h-16 w-16 items-center justify-center">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            initial={{ scale: 0.6, opacity: 0.5 }}
            animate={{ scale: 2.1, opacity: 0 }}
            transition={{ delay: 0.15 + i * 0.25, duration: 1.6, ease: "easeOut" }}
            className="absolute inset-0 rounded-full border border-success/50"
            aria-hidden="true"
          />
        ))}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 200, damping: 12 }}
          className="relative flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-success"
        >
          <CheckCircle2 size={34} aria-hidden="true" />
        </motion.div>
      </div>

      <h2 className="mt-5 font-display text-xl font-semibold text-ink">Installation Successful</h2>
      <p className="mt-1 text-sm text-ink-muted">{websiteName} is now connected and ready.</p>

      <div className="mt-6 grid grid-cols-1 gap-2 text-left">
        {[
          { icon: Globe, text: `Website Connected — ${websiteUrl}` },
          { icon: Server, text: "System Ready" },
          { icon: ShieldCheck, text: "Security keys generated and stored securely" },
        ].map(({ icon: Icon, text }, i) => (
          <motion.div
            key={text}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 + i * 0.09 }}
            className="flex items-center gap-2.5 rounded-lg bg-surface/60 border border-border px-3 py-2.5 text-sm text-ink"
          >
            <Icon size={16} className="text-accent shrink-0" aria-hidden="true" />
            <span className="data-value truncate">{text}</span>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.85 }}
        className="mt-7 rounded-xl border border-accent/25 bg-accent/5 p-4 text-left"
      >
        <h3 className="text-sm font-semibold text-ink">Your chat widget is ready</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Your website was scanned and the AI has already been trained on it. Paste this one line anywhere in your site's HTML (before <code className="data-value">&lt;/body&gt;</code>) and the chat bubble goes live — nothing else to configure.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="data-value flex-1 truncate rounded-lg border border-border bg-surface-raised/80 px-3 py-2 text-xs text-ink">{embedSnippet}</code>
          <button
            type="button"
            onClick={copySnippet}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-ink transition-colors hover:border-accent/50"
          >
            {copied ? <Check size={13} className="text-success" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </motion.div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <PrimaryButton onClick={() => navigate("/dashboard")}>
          Open Admin Dashboard <ExternalLink size={15} aria-hidden="true" />
        </PrimaryButton>
      </div>
    </motion.div>
  );
}
