import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, ServerCog, Globe2, Link2, ShieldCheck, Loader2, PartyPopper } from "lucide-react";
import type { DataScope, InstallErrorDetail } from "@kvl/shared";
import { AmbientCanvas } from "../components/AmbientCanvas";
import { ConsolePanel } from "../components/ConsolePanel";
import { ThemeToggle } from "../components/ThemeToggle";
import { StepNav, type WizardStepDef } from "../components/StepNav";
import { WelcomeStep } from "./steps/WelcomeStep";
import { SystemCheckStep } from "./steps/SystemCheckStep";
import { EnvironmentStep } from "./steps/EnvironmentStep";
import { WebsiteFormStep } from "./steps/WebsiteFormStep";
import { PermissionConsentStep } from "./steps/PermissionConsentStep";
import { InstallingStep } from "./steps/InstallingStep";
import { CompletionStep } from "./steps/CompletionStep";
import { ErrorStep } from "./steps/ErrorStep";

type WizardStage = "welcome" | "system_check" | "environment" | "website" | "permission" | "installing" | "complete" | "error";

const NAV_STEPS: WizardStepDef[] = [
  { id: "welcome", label: "Welcome", icon: Sparkles },
  { id: "system_check", label: "System", icon: ServerCog },
  { id: "environment", label: "Environment", icon: Globe2 },
  { id: "website", label: "Website", icon: Link2 },
  { id: "permission", label: "Permissions", icon: ShieldCheck },
  { id: "installing", label: "Installing", icon: Loader2 },
  { id: "complete", label: "Done", icon: PartyPopper },
];

const STAGE_INDEX: Record<WizardStage, number> = {
  welcome: 0,
  system_check: 1,
  environment: 2,
  website: 3,
  permission: 4,
  installing: 5,
  complete: 6,
  error: 5,
};

export function InstallWizard() {
  const [stage, setStage] = useState<WizardStage>("welcome");
  const [websiteName, setWebsiteName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [grantedScopes, setGrantedScopes] = useState<DataScope[]>([]);
  const [errorDetail, setErrorDetail] = useState<InstallErrorDetail | null>(null);

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
            <span className="data-label hidden sm:inline text-ink-faint">/ installer</span>
          </div>
          <ThemeToggle />
        </div>

        {stage !== "welcome" && (
          <div className="mb-6">
            <StepNav steps={NAV_STEPS.slice(1)} currentIndex={Math.max(STAGE_INDEX[stage] - 1, 0)} />
          </div>
        )}

        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}>
          <ConsolePanel className="p-6 sm:p-8 animate-flicker-in">
            <AnimatePresence mode="wait">
              {stage === "welcome" && <WelcomeStep key="welcome" onNext={() => setStage("system_check")} />}
              {stage === "system_check" && <SystemCheckStep key="system_check" onNext={() => setStage("environment")} />}
              {stage === "environment" && <EnvironmentStep key="environment" onNext={() => setStage("website")} />}
              {stage === "website" && (
                <WebsiteFormStep
                  key="website"
                  websiteName={websiteName}
                  websiteUrl={websiteUrl}
                  onChange={(v) => {
                    setWebsiteName(v.websiteName);
                    setWebsiteUrl(v.websiteUrl);
                  }}
                  onNext={() => setStage("permission")}
                />
              )}
              {stage === "permission" && (
                <PermissionConsentStep
                  key="permission"
                  grantedScopes={grantedScopes}
                  onChange={setGrantedScopes}
                  onNext={() => setStage("installing")}
                />
              )}
              {stage === "installing" && (
                <InstallingStep
                  key="installing"
                  websiteName={websiteName}
                  websiteUrl={websiteUrl}
                  grantedScopes={grantedScopes}
                  onComplete={() => setStage("complete")}
                  onError={(detail) => {
                    setErrorDetail(detail);
                    setStage("error");
                  }}
                />
              )}
              {stage === "complete" && <CompletionStep key="complete" websiteName={websiteName} websiteUrl={websiteUrl} />}
              {stage === "error" && errorDetail && <ErrorStep key="error" detail={errorDetail} onRetry={() => setStage("installing")} />}
            </AnimatePresence>
          </ConsolePanel>
        </motion.div>

        <p className="data-label mt-6 text-center text-ink-faint">Self-hosted · your server · your data</p>
      </div>
    </div>
  );
}
