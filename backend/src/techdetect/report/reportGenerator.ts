import type { ScoredCandidate } from "../types";
import type { SecurityAnalysisResult } from "../security/securityAnalyzer";
import type { PerformanceAnalysisResult } from "../performance/performanceAnalyzer";

export interface TechnologyReportInput {
  websiteUrl: string;
  cms: ScoredCandidate[];
  frontendFrameworks: ScoredCandidate[];
  backendFrameworks: ScoredCandidate[];
  programmingLanguages: ScoredCandidate[];
  hosting: ScoredCandidate[];
  server: ScoredCandidate[];
  cdn: ScoredCandidate[];
  database: ScoredCandidate[];
  jsLibraries: ScoredCandidate[];
  cssFrameworks: ScoredCandidate[];
  seoTools: ScoredCandidate[];
  analytics: ScoredCandidate[];
  paymentGateways: ScoredCandidate[];
  authentication: ScoredCandidate[];
  liveChat: ScoredCandidate[];
  forms: ScoredCandidate[];
  security: SecurityAnalysisResult;
  performance: PerformanceAnalysisResult;
}

export interface SmartConnectorCompatibility {
  /** the KVL widget embeds via a plain <script> tag, so it's compatible with virtually every site regardless of stack — false is reserved for a site whose detection failed so completely there's nothing to base an integration recommendation on */
  compatible: boolean;
  recommendedConnectors: string[];
  notes: string[];
}

export interface TechnologyReport extends TechnologyReportInput {
  overallConfidence: number;
  recommendations: string[];
  smartConnectorCompatibility: SmartConnectorCompatibility;
}

const HIGH_CONFIDENCE = 0.7;
const LOW_CONFIDENCE = 0.4;

function topCandidate(candidates: ScoredCandidate[]): ScoredCandidate | null {
  return candidates[0] ?? null;
}

function hasConfidently(candidates: ScoredCandidate[], name: string, minConfidence = LOW_CONFIDENCE): boolean {
  return candidates.some((c) => c.name === name && c.confidence >= minConfidence);
}

function buildRecommendations(input: TechnologyReportInput): string[] {
  const recommendations: string[] = [];

  if (input.security.score < 50) {
    recommendations.push("Security posture is weak (score below 50/100) — enable HTTPS/HSTS and address the failed checks in securityFindings before connecting any sensitive integration.");
  } else if (input.security.score < 80) {
    recommendations.push("Some security headers are missing — review securityFindings and close the gaps to reduce integration risk.");
  }

  if (input.performance.score < 50) {
    recommendations.push("Page performance is poor (score below 50/100) — enabling compression, caching, and lazy-loaded/optimized images is recommended before adding further embeds such as a chat widget.");
  }

  const topCms = topCandidate(input.cms);
  const topFrontend = topCandidate(input.frontendFrameworks);
  const topBackend = topCandidate(input.backendFrameworks);
  const nothingConfidentlyDetected = !topCms?.confidence && !topFrontend?.confidence && !topBackend?.confidence;
  if (nothingConfidentlyDetected || (topCms && topCms.confidence < LOW_CONFIDENCE && topFrontend && topFrontend.confidence < LOW_CONFIDENCE)) {
    recommendations.push("No CMS or frontend framework could be confidently identified — this looks like a custom-built site. Manual review before automated integration is recommended.");
  }

  if (hasConfidently(input.cms, "WordPress", HIGH_CONFIDENCE)) {
    recommendations.push("WordPress detected with high confidence — integration via the WordPress REST API or a dedicated plugin is the most natural path.");
  }
  if (hasConfidently(input.cms, "Shopify", HIGH_CONFIDENCE)) {
    recommendations.push("Shopify detected with high confidence — integration via the Shopify Admin/Storefront API is the most natural path.");
  }

  if (input.paymentGateways.length > 0) {
    recommendations.push(`Existing payment gateway detected (${input.paymentGateways.map((p) => p.name).join(", ")}) — any checkout-related automation should account for it rather than assuming none is present.`);
  }

  if (input.liveChat.length > 0 && input.liveChat[0].name !== "Custom Chat") {
    recommendations.push(`An existing live chat widget (${input.liveChat[0].name}) was detected — decide whether the KVL chatbot should replace it or run alongside it, rather than deploying both without a plan.`);
  } else {
    recommendations.push("No existing live chat/chatbot widget was detected — deploying the KVL chatbot widget is unlikely to conflict with anything already on the page.");
  }

  const insecureCookieFinding = input.security.findings.find((f) => f.check === "Cookie Policy" && !f.passed);
  if (insecureCookieFinding) {
    recommendations.push("Existing cookies are missing Secure/HttpOnly flags — apply the same standard to any new session cookie the chatbot integration introduces.");
  }

  return recommendations;
}

const CMS_CONNECTOR_MAP: Record<string, string> = {
  WordPress: "WordPress REST API Connector",
  WooCommerce: "WooCommerce Order/Product Connector",
  Shopify: "Shopify Admin API Connector",
  Magento: "Magento REST API Connector",
  OpenCart: "OpenCart REST API Connector",
  PrestaShop: "PrestaShop Webservice API Connector",
  Drupal: "Generic CMS Webhook Connector",
  Joomla: "Generic CMS Webhook Connector",
  Ghost: "Ghost Content/Admin API Connector",
};

function buildSmartConnectorCompatibility(input: TechnologyReportInput): SmartConnectorCompatibility {
  const notes: string[] = [];
  const recommendedConnectors = new Set<string>();

  for (const candidate of input.cms) {
    if (candidate.confidence < LOW_CONFIDENCE) continue;
    const connector = CMS_CONNECTOR_MAP[candidate.name];
    if (connector) {
      recommendedConnectors.add(connector);
      notes.push(`${candidate.name} (confidence ${candidate.confidence}) → ${connector}`);
    }
  }

  const topBackend = topCandidate(input.backendFrameworks);
  if (topBackend && topBackend.confidence >= LOW_CONFIDENCE && topBackend.name !== "Custom Backend") {
    recommendedConnectors.add(`Custom API Connector (backend: ${topBackend.name})`);
    notes.push(`Backend framework "${topBackend.name}" detected (confidence ${topBackend.confidence}) — a custom API connector targeting it is the most direct integration path.`);
  }

  // The widget itself is a plain <script> embed — always available
  // regardless of what else was or wasn't detected.
  recommendedConnectors.add("Generic JavaScript Embed Connector");
  if (recommendedConnectors.size === 1) {
    notes.push("No CMS/backend-specific connector applies — the generic JavaScript embed is the fallback for any site.");
  }

  return { compatible: true, recommendedConnectors: [...recommendedConnectors], notes };
}

/**
 * Assembles every category's already-scored candidates plus the security
 * and performance results into the final report — the one thing every
 * other module in `techdetect/` was building toward. Computes an overall
 * confidence (mean of each populated category's top candidate) and
 * generates recommendations/Smart Connector Engine compatibility notes
 * from what was actually found, not from a template.
 */
export function generateTechnologyReport(input: TechnologyReportInput): TechnologyReport {
  const categories: ScoredCandidate[][] = [
    input.cms,
    input.frontendFrameworks,
    input.backendFrameworks,
    input.programmingLanguages,
    input.hosting,
    input.server,
    input.cdn,
    input.database,
    input.jsLibraries,
    input.cssFrameworks,
    input.seoTools,
    input.analytics,
    input.paymentGateways,
    input.authentication,
    input.liveChat,
    input.forms,
  ];
  const topConfidences = categories.map(topCandidate).filter((c): c is ScoredCandidate => c !== null).map((c) => c.confidence);
  const overallConfidence = topConfidences.length > 0 ? Math.round((topConfidences.reduce((sum, c) => sum + c, 0) / topConfidences.length) * 10000) / 10000 : 0;

  return {
    ...input,
    overallConfidence,
    recommendations: buildRecommendations(input),
    smartConnectorCompatibility: buildSmartConnectorCompatibility(input),
  };
}
