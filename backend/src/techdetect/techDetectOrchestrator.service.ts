import { collectSignals } from "./signals/signalCollector";
import { detectCms } from "./detect/cmsDetector";
import { detectFrontend } from "./detect/frontendDetector";
import { detectBackendFramework, detectProgrammingLanguages } from "./detect/backendDetector";
import { detectHosting, detectServer, detectCdn } from "./detect/hostingDetector";
import { detectDatabase } from "./detect/databaseInference";
import { detectJsLibraries, detectCssFrameworks } from "./detect/libraryDetector";
import { detectSeoTools } from "./detect/seoDetector";
import { detectAnalytics } from "./detect/analyticsDetector";
import { detectPaymentGateways } from "./detect/paymentDetector";
import { detectAuthentication, detectLiveChat, detectForms } from "./detect/interactionDetector";
import { analyzeSecurity } from "./security/securityAnalyzer";
import { analyzePerformance } from "./performance/performanceAnalyzer";
import { scoreConfidence } from "./confidence/confidenceEngine";
import { generateTechnologyReport, type TechnologyReport } from "./report/reportGenerator";
import { TechDetectRecordService } from "./techDetectRecord.service";
import { formatError } from "../utils/formatError";

export interface TechDetectProgressEvent {
  step: string;
  message: string;
  percent: number;
}

export interface TechDetectResult {
  success: boolean;
  crawlJobId: string;
  report?: TechnologyReport;
  errorMessage?: string;
}

/**
 * Top-level Phase 4 pipeline: loads the target URL from an existing Phase
 * 2 crawl job, gathers every raw signal once (signals/signalCollector.ts),
 * runs all 16 detection categories plus security/performance analysis
 * against that one signal bundle, scores every category's raw evidence
 * through the shared confidence engine, assembles the final report, and
 * persists it. Deliberately a separate, re-runnable stage from the crawl
 * itself — see docs/TECH_DETECTION.md.
 */
export async function runTechDetection(databaseUrl: string, crawlJobId: string, onProgress: (event: TechDetectProgressEvent) => void): Promise<TechDetectResult> {
  const records = new TechDetectRecordService(databaseUrl);
  try {
    onProgress({ step: "load", message: "Loading crawl job", percent: 5 });
    const websiteUrl = await records.getCrawlJobWebsiteUrl(crawlJobId);

    onProgress({ step: "collect", message: "Collecting technology signals", percent: 15 });
    const signals = await collectSignals(websiteUrl);

    onProgress({ step: "detect", message: "Running detectors", percent: 40 });
    const cmsRaw = detectCms(signals);
    const frontendRaw = detectFrontend(signals);
    const backendRaw = detectBackendFramework(signals);
    const languagesRaw = detectProgrammingLanguages(signals, backendRaw);
    const hostingRaw = detectHosting(signals);
    const serverRaw = detectServer(signals);
    const cdnRaw = detectCdn(signals);
    const jsLibrariesRaw = detectJsLibraries(signals);
    const cssFrameworksRaw = detectCssFrameworks(signals);
    const seoRaw = detectSeoTools(signals);
    const analyticsRaw = detectAnalytics(signals);
    const paymentRaw = detectPaymentGateways(signals);
    const authRaw = detectAuthentication(signals);
    const chatRaw = detectLiveChat(signals);
    const formsRaw = detectForms(signals);

    onProgress({ step: "score", message: "Scoring confidence", percent: 65 });
    const cms = scoreConfidence(cmsRaw);
    const frontendFrameworks = scoreConfidence(frontendRaw);
    const backendFrameworks = scoreConfidence(backendRaw);
    const programmingLanguages = scoreConfidence(languagesRaw);
    const hosting = scoreConfidence(hostingRaw);
    const server = scoreConfidence(serverRaw);
    const cdn = scoreConfidence(cdnRaw);
    // Database inference only fires from *confident* CMS/backend matches
    // (see databaseInference.ts) — it needs the already-scored candidates,
    // not the raw pre-confidence signal list, so it runs here rather than
    // alongside the other detectors above.
    const database = scoreConfidence(detectDatabase(signals, cms, backendFrameworks));
    const jsLibraries = scoreConfidence(jsLibrariesRaw);
    const cssFrameworks = scoreConfidence(cssFrameworksRaw);
    const seoTools = scoreConfidence(seoRaw);
    const analytics = scoreConfidence(analyticsRaw);
    const paymentGateways = scoreConfidence(paymentRaw);
    const authentication = scoreConfidence(authRaw);
    const liveChat = scoreConfidence(chatRaw);
    const forms = scoreConfidence(formsRaw);

    onProgress({ step: "security", message: "Analyzing security posture", percent: 75 });
    const security = analyzeSecurity(signals);

    onProgress({ step: "performance", message: "Analyzing performance posture", percent: 85 });
    const performance = analyzePerformance(signals);

    onProgress({ step: "report", message: "Generating technology report", percent: 92 });
    const report = generateTechnologyReport({
      websiteUrl,
      cms,
      frontendFrameworks,
      backendFrameworks,
      programmingLanguages,
      hosting,
      server,
      cdn,
      database,
      jsLibraries,
      cssFrameworks,
      seoTools,
      analytics,
      paymentGateways,
      authentication,
      liveChat,
      forms,
      security,
      performance,
    });

    onProgress({ step: "persist", message: "Persisting technology report", percent: 97 });
    await records.saveReport(crawlJobId, report);

    onProgress({ step: "done", message: "Technology detection complete", percent: 100 });
    return { success: true, crawlJobId, report };
  } catch (err) {
    const message = formatError(err);
    onProgress({ step: "error", message, percent: 100 });
    return { success: false, crawlJobId, errorMessage: message };
  } finally {
    await records.close();
  }
}
