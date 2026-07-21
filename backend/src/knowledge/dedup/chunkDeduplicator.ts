import crypto from "node:crypto";
import { cosineSimilarity } from "../embed/embeddings";

export interface DedupItem {
  id: string;
  content: string;
  embedding?: number[];
}

export interface DedupResult {
  /** every input id, mapped to its cluster's canonical id (an id maps to itself when it IS the canonical) */
  canonicalOf: Map<string, string>;
  /** canonical id -> every member id in its cluster, including the canonical itself */
  clusters: Map<string, string[]>;
}

function normalizeForHash(content: string): string {
  return content.toLowerCase().replace(/\s+/g, " ").trim();
}

/** SHA-256 of whitespace/case-normalized content — two chunks that only differ in formatting still hash identically. */
export function contentHash(content: string): string {
  return crypto.createHash("sha256").update(normalizeForHash(content)).digest("hex");
}

/** Minimal union-find (disjoint-set) with path compression — used so near-duplicate relationships merge transitively (a~b and b~c implies a~b~c in one cluster) rather than needing every pair to be directly compared. */
class UnionFind {
  private parent = new Map<string, string>();

  private ensure(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }

  find(x: string): string {
    this.ensure(x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
}

// Empirically calibrated against the actual embedding model in use
// (Xenova/all-MiniLM-L6-v2, see embed/embeddings.ts): genuine paraphrases
// of the same information ("30-day refund window" reworded two ways)
// measured at ~0.75-0.89 cosine similarity, while topically-related but
// substantively different content (different hours, different policy)
// measured at ~0.35-0.50 — a wide gap, with 0.85 sitting safely above the
// "different information" ceiling while still catching most real
// paraphrases. Not 0.97: that value assumed near-bit-identical vectors,
// which real paraphrased prose essentially never produces with this model.
const DEFAULT_NEAR_DUPLICATE_THRESHOLD = 0.85;

/**
 * Groups chunks (or FAQ question+answer pairs, or table content — anything
 * reduced to a `{id, content}` pair) into duplicate clusters, never
 * dropping anything: the caller decides what to do with the resulting
 * `canonicalOf` map (in this product, that means flagging every non-
 * canonical member `isDuplicate = true` and pointing it at the canonical
 * row, while every source page/document that produced the content keeps
 * its own queryable row — only the canonical gets embedded/indexed).
 *
 * Two passes:
 * 1. Exact match — SHA-256 of normalized content. Cheap, catches
 *    byte-for-byte (or whitespace/case-only-different) duplicates.
 * 2. Near-duplicate — cosine similarity between embeddings, for items
 *    whose exact hash differs but which are still effectively the same
 *    content (the same FAQ answer copy-edited slightly across two pages).
 *    Only run across one representative per exact-hash group (not every
 *    raw item), and it's pairwise (O(m^2) over m distinct-content groups)
 *    — a deliberate, documented scaling boundary matching this product's
 *    single-site knowledge-base scale, the same trade-off already made for
 *    the vector store's HNSW index (see docs/KNOWLEDGE_BUILDER.md).
 */
export function deduplicate(items: DedupItem[], options: { nearDuplicateThreshold?: number } = {}): DedupResult {
  const threshold = options.nearDuplicateThreshold ?? DEFAULT_NEAR_DUPLICATE_THRESHOLD;
  const uf = new UnionFind();
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of items) uf.find(item.id);

  const byHash = new Map<string, string[]>();
  for (const item of items) {
    const hash = contentHash(item.content);
    const ids = byHash.get(hash);
    if (ids) ids.push(item.id);
    else byHash.set(hash, [item.id]);
  }
  for (const ids of byHash.values()) {
    for (let i = 1; i < ids.length; i++) uf.union(ids[0], ids[i]);
  }

  const hashRepresentatives = [...byHash.values()].map((ids) => byId.get(ids[0])!);
  const withEmbedding = hashRepresentatives.filter((item) => item.embedding);
  for (let i = 0; i < withEmbedding.length; i++) {
    for (let j = i + 1; j < withEmbedding.length; j++) {
      const a = withEmbedding[i];
      const b = withEmbedding[j];
      if (cosineSimilarity(a.embedding!, b.embedding!) >= threshold) uf.union(a.id, b.id);
    }
  }

  const groups = new Map<string, string[]>();
  for (const item of items) {
    const root = uf.find(item.id);
    const ids = groups.get(root);
    if (ids) ids.push(item.id);
    else groups.set(root, [item.id]);
  }

  const canonicalOf = new Map<string, string>();
  const clusters = new Map<string, string[]>();
  for (const memberIds of groups.values()) {
    const members = memberIds.map((id) => byId.get(id)!);
    // Longest content wins as canonical — usually the most complete
    // version; ties keep whichever appeared first in the input.
    const canonical = members.reduce((best, current) => (current.content.length > best.content.length ? current : best));
    clusters.set(canonical.id, memberIds);
    for (const id of memberIds) canonicalOf.set(id, canonical.id);
  }

  return { canonicalOf, clusters };
}

export interface FaqDedupInput {
  id: string;
  question: string;
  answer: string;
  embedding?: number[];
}

/** Convenience wrapper for ExtractedFaq rows — reduces each FAQ to a `question + answer` content pair and reuses the same clustering engine. */
export function deduplicateFaqs(faqs: FaqDedupInput[], options: { nearDuplicateThreshold?: number } = {}): DedupResult {
  return deduplicate(
    faqs.map((f) => ({ id: f.id, content: `${f.question}\n${f.answer}`, embedding: f.embedding })),
    options
  );
}
