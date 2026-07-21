import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { PrimaryButton } from "../../components/PrimaryButton";

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}>
      <div className="flex flex-col items-center text-center gap-6 py-4">
        <motion.div
          initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 180, damping: 14, delay: 0.1 }}
          className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-[0_12px_30px_-8px_rgb(var(--accent)/0.6)] animate-float-slow"
        >
          <Sparkles size={28} aria-hidden="true" />
        </motion.div>
        <div>
          <h1 className="font-display text-[28px] leading-tight font-semibold text-ink text-balance">KVL Super AI Chatbot</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted max-w-sm mx-auto">
            A self-hosted installer for your server. We'll check your machine, verify your website, and provision
            everything automatically — you only provide a name and a URL.
          </p>
        </div>
        <PrimaryButton onClick={onNext} autoFocus>
          Begin Installation
        </PrimaryButton>
        <div className="data-label flex items-center gap-3 text-ink-faint">
          <span>Ubuntu</span>
          <span aria-hidden="true">·</span>
          <span>Debian</span>
          <span aria-hidden="true">·</span>
          <span>Docker</span>
        </div>
      </div>
    </motion.div>
  );
}
