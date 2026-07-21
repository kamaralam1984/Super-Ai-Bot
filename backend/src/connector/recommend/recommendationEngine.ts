// Connector Recommendation Engine — turns Phase 4's TechnologyReport into a
// concrete, pre-configured connector recommendation. Treats
// `smartConnectorCompatibility.recommendedConnectors` (already computed by
// Phase 4) as a corroborating signal, not something to recompute from
// scratch — the actual connector *type* selection here is the registry
// lookup, since Phase 4's strings are human-readable connector names, not
// the `ConnectorType` enum this engine needs to configure.

import { CONNECTOR_DEFINITIONS, findDefinitionForPlatform, getConnectorDefinition } from "../registry/connectorRegistry";
import type { ConnectorAuthMethod, ConnectorRecommendation, TechnologyReportSignal } from "../types";

const LOW_CONFIDENCE = 0.4;

function topCandidate(candidates: Array<{ name: string; confidence: number; evidence: string[] }>) {
  return [...candidates].sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

/** Refines the registry's default auth method using Phase 4's `authentication` signal when it points at something more specific (e.g. a detected OAuth/JWT integration). */
function refineAuthMethod(defaultAuth: ConnectorAuthMethod, authSignals: TechnologyReportSignal["authentication"]): { authMethod: ConnectorAuthMethod; reason: string | null } {
  const top = topCandidate(authSignals);
  if (!top || top.confidence < LOW_CONFIDENCE) return { authMethod: defaultAuth, reason: null };

  const name = top.name.toLowerCase();
  if (name.includes("oauth")) return { authMethod: "OAUTH2", reason: `Detected OAuth-based authentication (confidence ${top.confidence}) — recommending OAUTH2.` };
  if (name.includes("jwt")) return { authMethod: "JWT", reason: `Detected JWT-based authentication (confidence ${top.confidence}) — recommending JWT.` };
  return { authMethod: defaultAuth, reason: null };
}

export function recommendConnector(report: TechnologyReportSignal): ConnectorRecommendation {
  const topCms = topCandidate(report.cms);
  const topBackend = topCandidate(report.backendFrameworks);

  let definition = topCms && topCms.confidence >= LOW_CONFIDENCE ? findDefinitionForPlatform(topCms.name) : null;
  const reasons: string[] = [];
  let confidence: number;
  let matchedOn: string;

  if (definition && topCms) {
    reasons.push(`CMS detected as "${topCms.name}" (confidence ${topCms.confidence}) → ${definition.displayName}.`, ...topCms.evidence);
    confidence = topCms.confidence;
    matchedOn = topCms.name;
  } else {
    definition = topBackend && topBackend.confidence >= LOW_CONFIDENCE ? findDefinitionForPlatform(topBackend.name) : null;
    if (definition && topBackend) {
      reasons.push(`Backend framework detected as "${topBackend.name}" (confidence ${topBackend.confidence}) → ${definition.displayName}.`, ...topBackend.evidence);
      confidence = topBackend.confidence;
      matchedOn = topBackend.name;
    } else {
      definition = getConnectorDefinition("UNIVERSAL_REST");
      reasons.push("No CMS or backend framework matched a specific connector at sufficient confidence — falling back to the Universal REST Connector.");
      confidence = 0.3;
      matchedOn = "Custom Website";
    }
  }

  if (report.smartConnectorCompatibility.recommendedConnectors.length > 0) {
    reasons.push(`Phase 4 technology detection independently suggested: ${report.smartConnectorCompatibility.recommendedConnectors.join(", ")}.`);
  }

  const { authMethod, reason: authReason } = refineAuthMethod(definition.defaultAuthMethod, report.authentication);
  if (authReason) reasons.push(authReason);

  return {
    connectorType: definition.connectorType,
    suggestedName: `${matchedOn} Connector`,
    baseUrl: report.websiteUrl,
    authMethod,
    confidence,
    reasons,
  };
}

/** All connector types the registry supports, for admin-facing manual override UI. */
export function listSupportedConnectorTypes() {
  return CONNECTOR_DEFINITIONS.map((d) => ({ connectorType: d.connectorType, displayName: d.displayName, supportedAuthMethods: d.supportedAuthMethods }));
}
