import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { motion } from "framer-motion";
import { GraduationCap, Radar, Loader2, CheckCircle2, XCircle, History } from "lucide-react";
import { StepHeader } from "../../components/StepHeader";
import { ProgressBar } from "../../components/ProgressBar";
import { PrimaryButton } from "../../components/PrimaryButton";
import { getSocket, subscribeProgressRoom } from "../../lib/socket";
import { api, ApiError, type AdminInstallation } from "../../lib/api";
import type { CrawlReportOutput, ProgressEvent, TrainingResult, TrainingReportData } from "../../lib/dashboardTypes";

type Phase = "idle" | "scanning" | "scanned" | "training" | "trained" | "error";

export function TrainingPage() {
  const { installation } = useOutletContext<{ installation: AdminInstallation | null }>();
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [crawlJobId, setCrawlJobId] = useState<string | null>(null);
  const [scanReport, setScanReport] = useState<CrawlReportOutput | null>(null);
  const [trainingResult, setTrainingResult] = useState<TrainingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<TrainingReportData[] | null>(null);

  useEffect(() => {
    if (!installation) return;
    api.training
      .listReports(installation.id)
      .then(setReports)
      .catch(() => setReports([]));
  }, [installation]);

  function startScan() {
    if (!installation) return;
    setPhase("scanning");
    setError(null);
    setProgress(null);
    const socket = getSocket();
    // Stable room, re-subscribed on every (re)connect — not socket.id,
    // which changes across reconnects and would silently strand this page
    // on stale progress mid-scan. See lib/socket.ts's
    // subscribeProgressRoom and InstallingStep.tsx's identical fix.
    const room = crypto.randomUUID();
    const unsubscribeRoom = subscribeProgressRoom(room);

    const onProgress = (e: ProgressEvent) => setProgress(e);
    const onComplete = (data: { crawlJobId: string; report: CrawlReportOutput }) => {
      setCrawlJobId(data.crawlJobId);
      setScanReport(data.report);
      setPhase("scanned");
      cleanup();
    };
    const onError = (data: { message: string }) => {
      setError(data.message);
      setPhase("error");
      cleanup();
    };
    function cleanup() {
      unsubscribeRoom();
      socket.off("scan:progress", onProgress);
      socket.off("scan:complete", onComplete);
      socket.off("scan:error", onError);
    }

    socket.on("scan:progress", onProgress);
    socket.on("scan:complete", onComplete);
    socket.on("scan:error", onError);

    // socket.id is undefined until the connection handshake finishes —
    // calling the API immediately after getSocket() (e.g. on this page's
    // very first render, when the socket is still connecting) sent an
    // empty socketId and the backend correctly rejected it. Same fix
    // InstallingStep.tsx already established for the exact same race.
    const begin = () => {
      api.scan.start({ websiteUrl: installation.websiteUrl, socketId: room }).catch((err) => {
        setError(err instanceof ApiError ? err.message : "Could not start scan.");
        setPhase("error");
        cleanup();
      });
    };
    if (socket.connected) begin();
    else socket.once("connect", begin);
  }

  function startTraining() {
    if (!crawlJobId) return;
    setPhase("training");
    setError(null);
    setProgress(null);
    const socket = getSocket();
    const room = crypto.randomUUID();
    const unsubscribeRoom = subscribeProgressRoom(room);

    const onProgress = (e: ProgressEvent) => setProgress(e);
    const onComplete = (result: TrainingResult) => {
      setTrainingResult(result);
      setPhase(result.success ? "trained" : "error");
      if (!result.success) setError(result.errorMessage ?? "Training failed.");
      cleanup();
      if (installation) api.training.listReports(installation.id).then(setReports).catch(() => undefined);
    };
    const onError = (data: { message: string }) => {
      setError(data.message);
      setPhase("error");
      cleanup();
    };
    function cleanup() {
      unsubscribeRoom();
      socket.off("training:progress", onProgress);
      socket.off("training:complete", onComplete);
      socket.off("training:error", onError);
    }

    socket.on("training:progress", onProgress);
    socket.on("training:complete", onComplete);
    socket.on("training:error", onError);

    const begin = () => {
      api.training.start({ crawlJobId, socketId: room }).catch((err) => {
        setError(err instanceof ApiError ? err.message : "Could not start training.");
        setPhase("error");
        cleanup();
      });
    };
    if (socket.connected) begin();
    else socket.once("connect", begin);
  }

  const busy = phase === "scanning" || phase === "training";

  return (
    <div className="max-w-3xl">
      <StepHeader icon={GraduationCap} title="Website & Training" subtitle="Scan the connected website and (re)build the AI's knowledge base." />

      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton onClick={startScan} loading={phase === "scanning"} disabled={busy}>
          <Radar size={15} aria-hidden="true" /> Scan Website
        </PrimaryButton>
        <PrimaryButton variant="ghost" onClick={startTraining} loading={phase === "training"} disabled={busy || !crawlJobId}>
          <GraduationCap size={15} aria-hidden="true" /> Train AI
        </PrimaryButton>
      </div>

      {busy && progress && (
        <div className="mt-5">
          <ProgressBar percent={progress.percent} label={progress.message} />
        </div>
      )}

      {error && (
        <p className="mt-4 flex items-start gap-1.5 text-sm text-critical">
          <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}
        </p>
      )}

      {phase === "scanned" && scanReport && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            ["Pages scanned", scanReport.scannedPages],
            ["Products found", scanReport.productsFound],
            ["Services found", scanReport.servicesFound],
            ["FAQs found", scanReport.faqsFound],
            ["Documents", scanReport.documentsFound],
            ["Failed pages", scanReport.failedPages],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-lg border border-border bg-surface/60 px-3 py-2.5">
              <p className="data-value text-lg font-semibold text-ink">{value}</p>
              <p className="text-xs text-ink-muted">{label}</p>
            </div>
          ))}
        </motion.div>
      )}

      {phase === "trained" && trainingResult?.report && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-5 flex items-center gap-2 rounded-lg border border-success/25 bg-success/10 px-3 py-2.5 text-sm text-ink">
          <CheckCircle2 size={16} className="text-success" aria-hidden="true" />
          Training complete — {trainingResult.report.embeddingsGenerated} embeddings generated, confidence {(trainingResult.report.overallConfidence * 100).toFixed(0)}%.
        </motion.div>
      )}

      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
          <History size={15} aria-hidden="true" /> Training history
        </div>
        {!reports && (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…
          </div>
        )}
        {reports && reports.length === 0 && <p className="text-sm text-ink-muted">No training runs yet.</p>}
        {reports && reports.length > 0 && (
          <ul className="space-y-2">
            {reports.map((r) => (
              <li key={r.crawlJobId} className="rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-sm text-ink">
                <span className="data-value">{r.crawlJobId.slice(0, 12)}…</span> — {r.embeddingsGenerated} embeddings, {(r.overallConfidence * 100).toFixed(0)}% confidence
                {r.incremental && <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent">incremental</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
