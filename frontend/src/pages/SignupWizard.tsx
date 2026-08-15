import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Building2, ShieldCheck, Loader2, PartyPopper } from "lucide-react";
import type { DataScope, OnboardingErrorDetail } from "@kvl/shared";
import { AmbientCanvas } from "../components/AmbientCanvas";
import { ConsolePanel } from "../components/ConsolePanel";
import { ThemeToggle } from "../components/ThemeToggle";
import { StepNav, type WizardStepDef } from "../components/StepNav";
import { SignupFormStep } from "./steps/SignupFormStep";
import { PermissionConsentStep } from "./steps/PermissionConsentStep";
import { OnboardingStep } from "./steps/OnboardingStep";
import { OnboardingCompleteStep } from "./steps/OnboardingCompleteStep";
import { OnboardingErrorStep } from "./steps/OnboardingErrorStep";

type WizardStage = "signup" | "permission" | "onboarding" | "complete" | "error";

const NAV_STEPS: WizardStepDef[] = [
  { id: "signup", label: "Account", icon: Building2 },
  { id: "permission", label: "Permissions", icon: ShieldCheck },
  { id: "onboarding", label: "Setting Up", icon: Loader2 },
  { id: "complete", label: "Done", icon: PartyPopper },
];

const STAGE_INDEX: Record<WizardStage, number> = {
  signup: 0,
  permission: 1,
  onboarding: 2,
  complete: 3,
  error: 2,
};

/**
 * The public self-serve signup flow — structurally InstallWizard.tsx's
 * shell (same WizardStage/useState/StepNav/AnimatePresence/ConsolePanel
 * pattern) with a shorter step list, since none of the platform
 * installer's own system-check/environment/database steps apply to a
 * tenant signing into an already-provisioned shared deployment.
 */
export function SignupWizard() {
  const [stage, setStage] = useState<WizardStage>("signup");
  const [businessName, setBusinessName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [installationId, setInstallationId] = useState("");
  const [grantedScopes, setGrantedScopes] = useState<DataScope[]>([]);
  const [errorDetail, setErrorDetail] = useState<OnboardingErrorDetail | null>(null);

  return (
    <div className="relative min-h-screen overflow-hidden bg-ground px-4 py-8 sm:py-12">
      <AmbientCanvas />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgb(var(--accent)/0.08),transparent)]" />

      <div className="relative mx-auto w-full max-w-xl">
        <div className="flex items-center justify-between mb-7">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            <span className="font-display text-[15px] font-semibold tracking-tight text-ink">KVL Super AI Chatbot</span>
            <span className="data-label hidden sm:inline text-ink-faint">/ sign up</span>
          </div>
          <ThemeToggle />
        </div>

        <div className="mb-6">
          <StepNav steps={NAV_STEPS} currentIndex={STAGE_INDEX[stage]} />
        </div>

        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}>
          <ConsolePanel className="p-6 sm:p-8 animate-flicker-in">
            <AnimatePresence mode="wait">
              {stage === "signup" && (
                <SignupFormStep
                  key="signup"
                  businessName={businessName}
                  websiteUrl={websiteUrl}
                  email={email}
                  password={password}
                  onChange={(v) => {
                    setBusinessName(v.businessName);
                    setWebsiteUrl(v.websiteUrl);
                    setEmail(v.email);
                    setPassword(v.password);
                  }}
                  onNext={(result) => {
                    setInstallationId(result.installationId);
                    setStage("permission");
                  }}
                />
              )}
              {stage === "permission" && (
                <PermissionConsentStep key="permission" grantedScopes={grantedScopes} onChange={setGrantedScopes} onNext={() => setStage("onboarding")} />
              )}
              {stage === "onboarding" && (
                <OnboardingStep
                  key="onboarding"
                  grantedScopes={grantedScopes}
                  onComplete={() => setStage("complete")}
                  onError={(detail) => {
                    setErrorDetail(detail);
                    setStage("error");
                  }}
                />
              )}
              {stage === "complete" && <OnboardingCompleteStep key="complete" businessName={businessName} websiteUrl={websiteUrl} installationId={installationId} />}
              {stage === "error" && errorDetail && <OnboardingErrorStep key="error" detail={errorDetail} onRetry={() => setStage("onboarding")} />}
            </AnimatePresence>
          </ConsolePanel>
        </motion.div>

        <p className="data-label mt-6 text-center text-ink-faint">Self-hosted · your server · your data</p>
      </div>
    </div>
  );
}
