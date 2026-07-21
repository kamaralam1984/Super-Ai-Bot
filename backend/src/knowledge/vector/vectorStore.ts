import fs from "node:fs";
import path from "node:path";
import { HierarchicalNSW } from "hnswlib-node";
import { logEvent } from "../../utils/logger";
import { formatError } from "../../utils/formatError";

export interface VectorSearchResult {
  chunkId: string;
  /** Cosine similarity in [-1, 1] (1 - hnswlib's cosine distance) — higher is closer. */
  score: number;
}

export interface VectorStoreStats {
  namespace: string;
  vectorCount: number;
  dimensions: number;
  maxElements: number;
}

interface LabelMapping {
  dimensions: number;
  nextLabel: number;
  labelToChunkId: Record<number, string>;
  chunkIdToLabel: Record<string, number>;
}

interface LoadedNamespace {
  index: HierarchicalNSW;
  mapping: LabelMapping;
  maxElements: number;
}

const DEFAULT_STORAGE_DIR = path.join(process.cwd(), "storage", "vector-index");
const INITIAL_CAPACITY = 1000;
const GROWTH_FACTOR = 2;
// hnswlib defaults — M: max graph connections per node, efConstruction:
// build-time accuracy/speed trade-off. Kept at the library's own documented
// defaults rather than invented values.
const HNSW_M = 16;
const HNSW_EF_CONSTRUCTION = 200;
const HNSW_RANDOM_SEED = 100;

function indexFilePath(namespace: string, storageDir: string): string {
  return path.join(storageDir, `${namespace}.hnsw`);
}
function mappingFilePath(namespace: string, storageDir: string): string {
  return path.join(storageDir, `${namespace}.labels.json`);
}

function emptyMapping(dimensions: number): LabelMapping {
  return { dimensions, nextLabel: 0, labelToChunkId: {}, chunkIdToLabel: {} };
}

/**
 * Enterprise vector database engine — a real HNSW (Hierarchical Navigable
 * Small World) approximate-nearest-neighbor index per namespace (one
 * namespace per installation, matching this product's single-tenant-per-
 * deployment model), persisted to disk and reloaded across restarts.
 *
 * hnswlib-node's native index only knows integer "labels", not our cuid
 * chunk IDs, and — critically — loading a saved index requires constructing
 * it with the *exact* original dimensionality up front (verified: passing
 * the wrong dimension count doesn't error, it silently returns garbage
 * results instead of failing loudly). Both the label<->chunkId mapping and
 * the true dimensionality are therefore persisted in a small sidecar JSON
 * file next to the binary index, and always read before the binary index
 * is ever opened.
 *
 * Deletions use hnswlib's markDelete (tombstone) + allowReplaceDeleted, so
 * an updated chunk's new vector can reuse a deleted slot instead of the
 * index growing unbounded on every re-embed.
 */
export class VectorStore {
  private namespaces = new Map<string, LoadedNamespace>();
  private storageDir: string;

  constructor(storageDir: string = DEFAULT_STORAGE_DIR) {
    this.storageDir = storageDir;
    fs.mkdirSync(this.storageDir, { recursive: true });
  }

  private readMappingFile(namespace: string): LabelMapping | null {
    const mapPath = mappingFilePath(namespace, this.storageDir);
    if (!fs.existsSync(mapPath)) return null;
    return JSON.parse(fs.readFileSync(mapPath, "utf-8")) as LabelMapping;
  }

  /** Loads a namespace's index from disk into memory if present, without creating one. Used by read paths (search/stats/backup) that shouldn't materialize an empty namespace. */
  private loadExisting(namespace: string): LoadedNamespace | null {
    const cached = this.namespaces.get(namespace);
    if (cached) return cached;

    const idxPath = indexFilePath(namespace, this.storageDir);
    const mapping = this.readMappingFile(namespace);
    if (!mapping || !fs.existsSync(idxPath)) return null;

    const index = new HierarchicalNSW("cosine", mapping.dimensions);
    index.readIndexSync(idxPath, true);
    const loaded: LoadedNamespace = { index, mapping, maxElements: index.getMaxElements() };
    this.namespaces.set(namespace, loaded);
    return loaded;
  }

  /** Loads a namespace if it exists, or creates a fresh empty one sized for `dimensions`. Used by write paths. */
  private loadOrCreate(namespace: string, dimensions: number): LoadedNamespace {
    const existing = this.loadExisting(namespace);
    if (existing) {
      if (existing.mapping.dimensions !== dimensions) {
        throw new Error(
          `Namespace "${namespace}" already holds ${existing.mapping.dimensions}-dimensional vectors — cannot add a ${dimensions}-dimensional vector to the same namespace. Rebuild the namespace if the embedding model changed.`
        );
      }
      return existing;
    }

    const index = new HierarchicalNSW("cosine", dimensions);
    index.initIndex(INITIAL_CAPACITY, HNSW_M, HNSW_EF_CONSTRUCTION, HNSW_RANDOM_SEED, true);
    const loaded: LoadedNamespace = { index, mapping: emptyMapping(dimensions), maxElements: INITIAL_CAPACITY };
    this.namespaces.set(namespace, loaded);
    return loaded;
  }

  private ensureCapacity(ns: LoadedNamespace, additional: number): void {
    const needed = ns.index.getCurrentCount() + additional;
    if (needed > ns.maxElements) {
      const newCapacity = Math.max(needed, Math.ceil(ns.maxElements * GROWTH_FACTOR));
      ns.index.resizeIndex(newCapacity);
      ns.maxElements = newCapacity;
    }
  }

  private persist(namespace: string, ns: LoadedNamespace): void {
    ns.index.writeIndexSync(indexFilePath(namespace, this.storageDir));
    fs.writeFileSync(mappingFilePath(namespace, this.storageDir), JSON.stringify(ns.mapping));
  }

  /** Inserts or updates a single chunk's vector. Updating re-embeds at a fresh label and tombstones the old one — see class docstring. */
  upsert(namespace: string, chunkId: string, vector: number[]): void {
    this.upsertMany(namespace, [{ chunkId, vector }]);
  }

  upsertMany(namespace: string, items: { chunkId: string; vector: number[] }[]): void {
    if (items.length === 0) return;
    const dimensions = items[0].vector.length;
    const ns = this.loadOrCreate(namespace, dimensions);
    this.ensureCapacity(ns, items.length);

    for (const item of items) {
      if (item.vector.length !== dimensions) {
        throw new Error(`Vector for chunk "${item.chunkId}" has ${item.vector.length} dimensions, expected ${dimensions}`);
      }
      const existingLabel = ns.mapping.chunkIdToLabel[item.chunkId];
      if (existingLabel !== undefined) {
        ns.index.markDelete(existingLabel);
        delete ns.mapping.labelToChunkId[existingLabel];
      }
      const label = ns.mapping.nextLabel++;
      ns.index.addPoint(item.vector, label, true);
      ns.mapping.labelToChunkId[label] = item.chunkId;
      ns.mapping.chunkIdToLabel[item.chunkId] = label;
    }

    this.persist(namespace, ns);
    logEvent({ component: "knowledge-vector", message: `Upserted ${items.length} vector(s) into namespace "${namespace}" (now ${ns.index.getCurrentCount()} live)`, status: "success" });
  }

  /** Tombstones a chunk's vector so it stops appearing in search results. Returns false if the chunk (or namespace) isn't present. */
  remove(namespace: string, chunkId: string): boolean {
    const ns = this.loadExisting(namespace);
    if (!ns) return false;
    const label = ns.mapping.chunkIdToLabel[chunkId];
    if (label === undefined) return false;
    ns.index.markDelete(label);
    delete ns.mapping.labelToChunkId[label];
    delete ns.mapping.chunkIdToLabel[chunkId];
    this.persist(namespace, ns);
    return true;
  }

  /**
   * Approximate k-nearest-neighbor search. `options.filterChunkIds`, when
   * given, restricts results to that set of chunk IDs (e.g. scoping search
   * to one category or excluding known duplicates) — hnswlib applies the
   * filter natively during graph traversal rather than post-filtering a
   * fixed top-k, so it doesn't under-return when the filter is narrow.
   */
  search(namespace: string, queryVector: number[], k: number, options: { filterChunkIds?: Set<string> } = {}): VectorSearchResult[] {
    const ns = this.loadExisting(namespace);
    if (!ns || ns.index.getCurrentCount() === 0 || k <= 0) return [];
    if (queryVector.length !== ns.mapping.dimensions) {
      throw new Error(`Query vector has ${queryVector.length} dimensions, namespace "${namespace}" holds ${ns.mapping.dimensions}-dimensional vectors`);
    }

    const filter = options.filterChunkIds
      ? (label: number) => {
          const chunkId = ns.mapping.labelToChunkId[label];
          return chunkId !== undefined && options.filterChunkIds!.has(chunkId);
        }
      : undefined;

    const safeK = Math.min(k, ns.index.getCurrentCount());
    const result = ns.index.searchKnn(queryVector, safeK, filter);
    const hits: VectorSearchResult[] = [];
    for (let i = 0; i < result.neighbors.length; i++) {
      const chunkId = ns.mapping.labelToChunkId[result.neighbors[i]];
      if (chunkId !== undefined) hits.push({ chunkId, score: 1 - result.distances[i] });
    }
    return hits;
  }

  stats(namespace: string): VectorStoreStats | null {
    const ns = this.loadExisting(namespace);
    if (!ns) return null;
    return { namespace, vectorCount: ns.index.getCurrentCount(), dimensions: ns.mapping.dimensions, maxElements: ns.maxElements };
  }

  /**
   * Full rebuild from scratch — discards tombstoned slots entirely rather
   * than carrying them forward, which is what "re-indexing" after a batch
   * of updates/deletes (or an embedding model upgrade) should do to keep
   * the on-disk index from accumulating dead weight indefinitely.
   */
  rebuild(namespace: string, items: { chunkId: string; vector: number[] }[]): void {
    if (items.length === 0) {
      this.namespaces.delete(namespace);
      for (const file of [indexFilePath(namespace, this.storageDir), mappingFilePath(namespace, this.storageDir)]) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      logEvent({ component: "knowledge-vector", message: `Rebuilt namespace "${namespace}" as empty (no items)`, status: "success" });
      return;
    }

    const dimensions = items[0].vector.length;
    const capacity = Math.max(INITIAL_CAPACITY, items.length);
    const index = new HierarchicalNSW("cosine", dimensions);
    index.initIndex(capacity, HNSW_M, HNSW_EF_CONSTRUCTION, HNSW_RANDOM_SEED, true);

    const mapping = emptyMapping(dimensions);
    for (const item of items) {
      if (item.vector.length !== dimensions) {
        throw new Error(`Vector for chunk "${item.chunkId}" has ${item.vector.length} dimensions, expected ${dimensions}`);
      }
      const label = mapping.nextLabel++;
      index.addPoint(item.vector, label, true);
      mapping.labelToChunkId[label] = item.chunkId;
      mapping.chunkIdToLabel[item.chunkId] = label;
    }

    const ns: LoadedNamespace = { index, mapping, maxElements: capacity };
    this.namespaces.set(namespace, ns);
    this.persist(namespace, ns);
    logEvent({ component: "knowledge-vector", message: `Rebuilt namespace "${namespace}" with ${items.length} vectors`, status: "success" });
  }

  /** Copies a namespace's current on-disk index + label mapping into `backupDir`. Returns null if the namespace doesn't exist. */
  backup(namespace: string, backupDir: string): { indexFile: string; mappingFile: string } | null {
    const ns = this.loadExisting(namespace);
    if (!ns) return null;
    this.persist(namespace, ns); // ensure the files on disk reflect the in-memory state before copying
    fs.mkdirSync(backupDir, { recursive: true });
    const destIdx = path.join(backupDir, `${namespace}.hnsw`);
    const destMap = path.join(backupDir, `${namespace}.labels.json`);
    fs.copyFileSync(indexFilePath(namespace, this.storageDir), destIdx);
    fs.copyFileSync(mappingFilePath(namespace, this.storageDir), destMap);
    logEvent({ component: "knowledge-vector", message: `Backed up namespace "${namespace}" to ${backupDir}`, status: "success" });
    return { indexFile: destIdx, mappingFile: destMap };
  }

  /** Restores a namespace from a prior `backup()` output directory, replacing whatever is currently on disk/in memory for it. */
  restore(namespace: string, backupDir: string): void {
    const srcIdx = path.join(backupDir, `${namespace}.hnsw`);
    const srcMap = path.join(backupDir, `${namespace}.labels.json`);
    if (!fs.existsSync(srcIdx) || !fs.existsSync(srcMap)) {
      throw new Error(`No backup found for namespace "${namespace}" in ${backupDir}`);
    }
    fs.copyFileSync(srcIdx, indexFilePath(namespace, this.storageDir));
    fs.copyFileSync(srcMap, mappingFilePath(namespace, this.storageDir));
    this.namespaces.delete(namespace); // force a reload from the restored files on next access
    logEvent({ component: "knowledge-vector", message: `Restored namespace "${namespace}" from ${backupDir}`, status: "success" });
  }

  /** Permanently deletes a namespace's index files and drops it from memory. */
  deleteNamespace(namespace: string): void {
    this.namespaces.delete(namespace);
    for (const file of [indexFilePath(namespace, this.storageDir), mappingFilePath(namespace, this.storageDir)]) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }
}

/** Process-wide default store instance, matching the embedding pipeline's one-in-process-pipeline pattern — callers that need an isolated store (tests, one-off scripts) should construct their own `new VectorStore(dir)` instead. */
let defaultStore: VectorStore | null = null;
export function getDefaultVectorStore(): VectorStore {
  if (!defaultStore) {
    try {
      defaultStore = new VectorStore();
    } catch (err) {
      logEvent({ component: "knowledge-vector", message: "Failed to initialize the default vector store", status: "error", error: formatError(err) });
      throw err;
    }
  }
  return defaultStore;
}
