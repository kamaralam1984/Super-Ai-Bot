import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Sparkles, Radar, GraduationCap, ShieldCheck, MessageSquare, ArrowRight } from "lucide-react";
import { AmbientCanvas } from "../components/AmbientCanvas";
import { ThemeToggle } from "../components/ThemeToggle";
import { PrimaryButton } from "../components/PrimaryButton";

const FEATURES = [
  { icon: Radar, title: "Scans your website", desc: "Pages, products, services, FAQs — automatically discovered, no manual setup." },
  { icon: GraduationCap, title: "Trains itself", desc: "Turns what it scans into a real knowledge base your AI can actually answer from." },
  { icon: ShieldCheck, title: "Read-only, always", desc: "The AI never modifies your data — you choose exactly what it's allowed to see." },
  { icon: MessageSquare, title: "One line to embed", desc: "Drop a script tag on your site and the chat widget goes live instantly." },
];

/**
 * The platform's public landing page — the one page an anonymous visitor
 * hitting "/" on an installed instance sees (see App.tsx's RootRoute).
 * Purely a marketing/entry surface: the two things it can do are sign up
 * (/signup) or sign in (/tenant/login) — every dashboard/admin route
 * behind either is gated by its own session, unaffected by this page.
 */
export function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-ground">
      <AmbientCanvas />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgb(var(--accent)/0.08),transparent)]" />

      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-6 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          <span className="font-display text-[15px] font-semibold tracking-tight text-ink">KVL Super AI Chatbot</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/tenant/login" className="text-sm font-medium text-ink-muted transition-colors hover:text-ink">
            Sign in
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-5xl px-4 pb-20 pt-10 sm:px-6 sm:pt-16">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="mx-auto max-w-2xl text-center">
          <div className="mx-auto mb-5 inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
            <Sparkles size={13} aria-hidden="true" />
            AI Workforce for your website
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            A chatbot that learns your website by itself
          </h1>
          <p className="mt-4 text-base text-ink-muted">
            Sign up, give us your website URL, and we'll scan it, train an AI on it, and hand you a one-line embed script — usually in a few minutes.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link to="/signup">
              <PrimaryButton>
                Get Started <ArrowRight size={15} aria-hidden="true" />
              </PrimaryButton>
            </Link>
            <Link to="/tenant/login">
              <PrimaryButton variant="ghost">Sign in</PrimaryButton>
            </Link>
          </div>
        </motion.div>

        <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, desc }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.07, duration: 0.35 }}
              className="rounded-2xl border border-border bg-surface/70 p-5 backdrop-blur-sm"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
                <Icon size={17} aria-hidden="true" />
              </div>
              <h3 className="text-sm font-semibold text-ink">{title}</h3>
              <p className="mt-1 text-sm text-ink-muted">{desc}</p>
            </motion.div>
          ))}
        </div>

        <p className="data-label mt-16 text-center text-ink-faint">Self-hosted · your server · your data</p>
      </main>
    </div>
  );
}
