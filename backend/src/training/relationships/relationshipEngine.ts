// Knowledge Relationship Engine — the semantic knowledge graph. Nothing
// like this exists anywhere else in the codebase (confirmed by research
// before writing this module): builds edges between structurally
// different entity kinds using two combinable signals — an explicit name
// mention (strong evidence) and embedding similarity (corroborating or
// standalone evidence) — plus fully deterministic edges for facts that
// don't need inference at all (a product's own category, a same-page
// contact).
//
// Pure function: takes already-enriched entities (with precomputed
// embeddings — this module never calls the embedding model itself) and
// returns the full edge set for the training orchestrator to persist.

import { cosineSimilarity } from "../../knowledge/embed/embeddings";
import type { KnowledgeRelationshipDraft, RelatedEntityRef } from "../types";

interface NamedEntity {
  id: string;
  name: string;
  embedding: number[];
}

const MIN_NAME_LENGTH_FOR_MENTION_MATCH = 3; // shorter names ("Go", "It") false-positive too easily as a substring match

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionsName(text: string, name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < MIN_NAME_LENGTH_FOR_MENTION_MATCH) return false;
  return new RegExp(`\\b${escapeRegex(trimmed)}\\b`, "i").test(text);
}

export interface EntityLinkOptions {
  minEmbeddingScore?: number;
  k?: number;
}

/** Shared "does this text reference / relate to one of these named entities" linker, used by every inferred (non-deterministic) relationship type below. */
export function linkToEntities(sourceText: string, sourceEmbedding: number[], candidates: NamedEntity[], options: EntityLinkOptions = {}): RelatedEntityRef[] {
  const minEmbeddingScore = options.minEmbeddingScore ?? 0.6;
  const k = options.k ?? 3;

  return candidates
    .map((c) => {
      const mentioned = mentionsName(sourceText, c.name);
      const similarity = cosineSimilarity(sourceEmbedding, c.embedding);
      if (!mentioned && similarity < minEmbeddingScore) return null;

      const score = Math.min(1, mentioned ? Math.max(0.85, similarity) : similarity);
      const reason = mentioned
        ? `"${c.name}" is explicitly mentioned` + (similarity >= minEmbeddingScore ? ` and semantically similar (${similarity.toFixed(2)})` : "")
        : `Semantically similar (${similarity.toFixed(2)})`;
      return { id: c.id, name: c.name, score, reason };
    })
    .filter((r): r is RelatedEntityRef => r !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export interface ProductInput {
  id: string;
  name: string;
  category: string | null;
  embedding: number[];
  relatedProducts: RelatedEntityRef[];
}

export interface ServiceInput {
  id: string;
  name: string;
  industries: string[];
  embedding: number[];
  relatedServices: RelatedEntityRef[];
}

export interface FaqInput {
  id: string;
  question: string;
  answer: string;
  embedding: number[];
}

export interface PolicyInput {
  id: string;
  title: string | null;
  content: string;
  embedding: number[];
}

export interface BlogInput {
  id: string;
  title: string | null;
  content: string;
  embedding: number[];
}

export interface ContactInput {
  id: string;
  pageId: string;
}

export interface CompanyChunkInput {
  id: string;
  pageId: string | null;
}

export interface RelationshipEngineInput {
  products: ProductInput[];
  services: ServiceInput[];
  faqs: FaqInput[];
  policies: PolicyInput[];
  blogs: BlogInput[];
  contacts: ContactInput[];
  companyChunks: CompanyChunkInput[];
}

export function buildKnowledgeRelationships(input: RelationshipEngineInput): KnowledgeRelationshipDraft[] {
  const edges: KnowledgeRelationshipDraft[] = [];

  // Deterministic: a product's own category, a service's own industries —
  // no inference needed, confidence 1.0.
  for (const product of input.products) {
    if (product.category) {
      edges.push({ sourceType: "Product", sourceId: product.id, targetType: "Category", targetId: product.category, relationshipType: "PRODUCT_CATEGORY", confidence: 1.0, evidence: [`Product is categorized as "${product.category}"`] });
    }
    for (const related of product.relatedProducts) {
      edges.push({ sourceType: "Product", sourceId: product.id, targetType: "Product", targetId: related.id, relationshipType: "PRODUCT_PRODUCT", confidence: related.score, evidence: [related.reason] });
    }
  }

  for (const service of input.services) {
    for (const industry of service.industries) {
      edges.push({ sourceType: "Service", sourceId: service.id, targetType: "Category", targetId: industry, relationshipType: "SERVICE_INDUSTRY", confidence: 1.0, evidence: [`Service targets the "${industry}" industry`] });
    }
    for (const related of service.relatedServices) {
      edges.push({ sourceType: "Service", sourceId: service.id, targetType: "Service", targetId: related.id, relationshipType: "SERVICE_SERVICE", confidence: related.score, evidence: [related.reason] });
    }
  }

  // Inferred: name-mention and/or embedding-similarity linking.
  const productEntities: NamedEntity[] = input.products.map((p) => ({ id: p.id, name: p.name, embedding: p.embedding }));
  const serviceEntities: NamedEntity[] = input.services.map((s) => ({ id: s.id, name: s.name, embedding: s.embedding }));

  for (const faq of input.faqs) {
    const text = `${faq.question} ${faq.answer}`;
    const embedding = faq.embedding;
    for (const match of linkToEntities(text, embedding, productEntities)) {
      edges.push({ sourceType: "Faq", sourceId: faq.id, targetType: "Product", targetId: match.id, relationshipType: "FAQ_PRODUCT", confidence: match.score, evidence: [match.reason] });
    }
    for (const match of linkToEntities(text, embedding, serviceEntities)) {
      edges.push({ sourceType: "Faq", sourceId: faq.id, targetType: "Service", targetId: match.id, relationshipType: "FAQ_SERVICE", confidence: match.score, evidence: [match.reason] });
    }
  }

  for (const policy of input.policies) {
    const text = `${policy.title ?? ""} ${policy.content}`;
    for (const match of linkToEntities(text, policy.embedding, serviceEntities)) {
      edges.push({ sourceType: "Policy", sourceId: policy.id, targetType: "Service", targetId: match.id, relationshipType: "POLICY_SERVICE", confidence: match.score, evidence: [match.reason] });
    }
  }

  for (const blog of input.blogs) {
    const text = `${blog.title ?? ""} ${blog.content}`;
    for (const match of linkToEntities(text, blog.embedding, productEntities)) {
      edges.push({ sourceType: "Chunk", sourceId: blog.id, targetType: "Product", targetId: match.id, relationshipType: "BLOG_PRODUCT", confidence: match.score, evidence: [match.reason] });
    }
  }

  // Deterministic: same-page co-location — the only reliable signal for
  // "this company info and this contact info belong together" without a
  // gazetteer or NER model; a company chunk and a contact record with no
  // page in common are never linked (no fabricated fallback).
  for (const chunk of input.companyChunks) {
    if (!chunk.pageId) continue;
    for (const contact of input.contacts) {
      if (contact.pageId === chunk.pageId) {
        edges.push({ sourceType: "Chunk", sourceId: chunk.id, targetType: "Contact", targetId: contact.id, relationshipType: "COMPANY_CONTACT", confidence: 0.8, evidence: ["Company information and this contact appear on the same page"] });
      }
    }
  }

  return edges;
}
