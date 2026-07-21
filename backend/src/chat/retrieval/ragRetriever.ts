// RAG Retriever — the impure edge that turns a chat turn's intent into an
// actual retrieval call, then normalizes the result into one shape
// (`RetrievalResult`) regardless of *where* the evidence came from: Phase
// 3's crawled knowledge base (`performKnowledgeSearch`, for Products/
// Services/FAQs/Policies/Blogs/Contact/company info first-party content)
// or a live Phase 5 connector via Phase 7's permission-checked tool layer
// (`authorizedAiToolLayer`, for Orders/Inventory/Appointments — real-time
// data a website crawl could never have captured). Every other chat/
// module (promptBuilder, groundingGuard, citation formatter) consumes
// this one normalized shape and never calls either retrieval path itself.

import { performKnowledgeSearch } from "../../knowledge/knowledgeSearch.service";
import * as authorizedTools from "../../permission/integration/authorizedAiToolLayer";
import { formatSourceReferences, type SourceReference } from "../citation/sourceReferenceFormatter";
import { scopeForChunkCategory } from "../../permission/catalog/dataScopeCatalog";
import type { PermissionOrchestratorService } from "../../permission/permissionOrchestrator.service";
import type { ConnectorRecordService, ConnectorRecord } from "../../connector/connectorRecord.service";
import type { ChatIntent } from "../nlu/intentDetector";
import type { CitationResult } from "../../knowledge/citation/citationFormatter";

export interface RetrievalResult {
  answered: boolean;
  /** Plain-text excerpts handed to promptBuilder.ts as grounding context — the only thing the LLM is allowed to treat as fact. */
  evidenceTexts: string[];
  sources: SourceReference[];
  overallConfidence: number;
  refusalReason: string | null;
  raw: CitationResult;
}

/** Maps a detected chat intent to the Phase 3 knowledge-chunk category worth filtering retrieval to — `undefined` means "search the whole knowledge base," appropriate for intents with no single obvious category (faq, small_talk-adjacent, unknown). */
const INTENT_TO_KNOWLEDGE_CATEGORY: Partial<Record<ChatIntent, string>> = {
  product_inquiry: "Products",
  service_inquiry: "Services",
  pricing_inquiry: "Products",
  policy_inquiry: "Policies",
  contact_inquiry: "Contact",
};

export interface RetrieveKnowledgeParams {
  installationId: string;
  query: string;
  intent: ChatIntent;
  language?: string;
  k?: number;
}

/** Retrieves grounding evidence from this installation's own crawled knowledge base — the primary, always-available retrieval path (every installation has one; a Phase 5 connector is optional). */
export async function retrieveKnowledge(databaseUrl: string, params: RetrieveKnowledgeParams): Promise<RetrievalResult> {
  const result = await performKnowledgeSearch(databaseUrl, {
    installationId: params.installationId,
    query: params.query,
    category: INTENT_TO_KNOWLEDGE_CATEGORY[params.intent],
    language: params.language,
    k: params.k ?? 5,
  });

  if (!result.answered) {
    return { answered: false, evidenceTexts: [], sources: [], overallConfidence: 0, refusalReason: result.reason, raw: result };
  }

  return {
    answered: true,
    evidenceTexts: result.sources.map((s) => s.excerpt),
    sources: formatSourceReferences(result.sources),
    overallConfidence: result.overallConfidence,
    refusalReason: null,
    raw: result,
  };
}

type ConnectorToolName = "getOrderStatus" | "getAppointments" | "getInventory" | "getProducts" | "getServices";

const INTENT_TO_TOOL: Partial<Record<ChatIntent, ConnectorToolName>> = {
  order_status: "getOrderStatus",
  appointment_inquiry: "getAppointments",
  inventory_inquiry: "getInventory",
  product_inquiry: "getProducts",
  service_inquiry: "getServices",
};

export interface RetrieveFromConnectorParams {
  intent: ChatIntent;
  orderId?: string;
}

function callTool(toolName: ConnectorToolName, permissions: PermissionOrchestratorService, records: ConnectorRecordService, connector: ConnectorRecord, orderId?: string) {
  switch (toolName) {
    case "getOrderStatus":
      return authorizedTools.getOrderStatus(permissions, records, connector, orderId);
    case "getAppointments":
      return authorizedTools.getAppointments(permissions, records, connector);
    case "getInventory":
      return authorizedTools.getInventory(permissions, records, connector);
    case "getProducts":
      return authorizedTools.getProducts(permissions, records, connector);
    case "getServices":
      return authorizedTools.getServices(permissions, records, connector);
  }
}

/** Retrieves live data from one already-configured, already-authorized Phase 5 connector via Phase 7's authorized tool layer — used when the intent maps to a category better answered by a live system call (order status, current inventory, appointment slots) than by crawled content, and a connector is actually configured for this installation (the caller decides that; this function doesn't look connectors up itself). Returns `answered: false` for an intent with no corresponding tool rather than throwing — not every intent needs a connector call. */
export async function retrieveFromConnector(
  permissions: PermissionOrchestratorService,
  records: ConnectorRecordService,
  connector: ConnectorRecord,
  params: RetrieveFromConnectorParams
): Promise<RetrievalResult> {
  const toolName = INTENT_TO_TOOL[params.intent];
  if (!toolName) {
    return { answered: false, evidenceTexts: [], sources: [], overallConfidence: 0, refusalReason: `No connector tool is mapped to intent "${params.intent}".`, raw: { answered: false, reason: "no_tool_for_intent" } };
  }

  const result = await callTool(toolName, permissions, records, connector, params.orderId);

  if (!result.ok) {
    return { answered: false, evidenceTexts: [], sources: [], overallConfidence: 0, refusalReason: result.error ?? "The connector call did not succeed.", raw: { answered: false, reason: result.error ?? "connector_call_failed" } };
  }

  const evidenceText = JSON.stringify(result.data);
  const source: SourceReference | null = result.source
    ? { chunkId: result.source.endpoint, documentName: `${connector.name} — ${toolName}`, pageUrl: `${connector.baseUrl}${result.source.endpoint}`, sectionName: scopeForChunkCategoryFallback(toolName), retrievedAt: new Date().toISOString(), confidenceScore: 1, relevanceScore: 1 }
    : null;

  return {
    answered: true,
    evidenceTexts: [evidenceText],
    sources: source ? [source] : [],
    overallConfidence: 1, // a successful, permission-checked live API call is treated as fully authoritative — there's no "relevance ranking" against a live system-of-record the way there is for retrieved text chunks
    refusalReason: null,
    raw: { answered: true, sources: [], overallConfidence: 1 },
  };
}

function scopeForChunkCategoryFallback(toolName: string): string | null {
  const category = toolName.replace(/^get/, "").toLowerCase();
  return scopeForChunkCategory(category) ?? category;
}
