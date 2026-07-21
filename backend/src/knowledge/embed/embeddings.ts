import fs from "node:fs";
import path from "node:path";
import { pipeline, env as transformersEnv, type FeatureExtractionPipeline } from "@xenova/transformers";
import { MODELS_DIR } from "../../config/paths";
import { logEvent } from "../../utils/logger";

// Left at its library default (a path inside node_modules/@xenova/transformers
// itself), the ~90MB model download would be lost on every container
// recreate — a real problem for a self-hosted product that may run with
// restricted outbound internet access after initial setup, not just a
// performance nicety. Redirecting it into the persistent `models/` runtime
// directory (the same one Docker mounts as a volume — see
// deploy/docker-compose.yml) makes the download survive restarts/upgrades.
// Applied lazily (inside getPipeline, not at module load) so merely
// importing this file — e.g. transitively, in unrelated tests — never
// touches the filesystem; only actually generating an embedding does.
const TRANSFORMERS_CACHE_DIR = path.join(MODELS_DIR, "transformers");
function configureTransformersCacheDir(): void {
  fs.mkdirSync(TRANSFORMERS_CACHE_DIR, { recursive: true, mode: 0o750 });
  transformersEnv.cacheDir = `${TRANSFORMERS_CACHE_DIR}${path.sep}`;
}

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = 384;
// Bump whenever EMBEDDING_MODEL changes, or the pooling/normalization
// strategy changes in a way that makes previously-stored vectors
// incompatible with freshly-generated ones. KnowledgeChunk rows record the
// model + version they were embedded with (see isEmbeddingStale below) so
// an upgrade can detect exactly which chunks need re-embedding and
// re-indexing, rather than assuming the whole knowledge base is fine or
// blindly re-embedding everything.
export const EMBEDDING_VERSION = 1;

export interface EmbeddingMeta {
  model: string;
  version: number;
}

export function currentEmbeddingMeta(): EmbeddingMeta {
  return { model: EMBEDDING_MODEL, version: EMBEDDING_VERSION };
}

/** True when a stored chunk's embedding was produced by a different model/version than the one currently active — it needs re-embedding before it's safe to compare against freshly-generated vectors in the same vector index. */
export function isEmbeddingStale(storedModel: string | null | undefined, storedVersion: number | null | undefined): boolean {
  return storedModel !== EMBEDDING_MODEL || storedVersion !== EMBEDDING_VERSION;
}

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Local, self-hosted embedding model (ONNX via @xenova/transformers) — no
 * external API key, no per-request cost, no crawled content leaving the
 * server. First call downloads and caches the model (~90MB); every call
 * after that reuses the same in-process pipeline. See docs/SCANNER.md for
 * why this is Float[] + in-app cosine similarity rather than pgvector.
 */
async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    configureTransformersCacheDir();
    pipelinePromise = pipeline("feature-extraction", EMBEDDING_MODEL).catch((err) => {
      pipelinePromise = null;
      throw err;
    }) as Promise<FeatureExtractionPipeline>;
  }
  return pipelinePromise;
}

async function embedOne(extractor: FeatureExtractionPipeline, text: string): Promise<number[]> {
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

export async function embedText(text: string): Promise<number[]> {
  const extractor = await getPipeline();
  return embedOne(extractor, text);
}

export interface EmbedTextsOptions {
  /** How many single-sequence embedding calls to run concurrently. Default 4. */
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

const DEFAULT_CONCURRENCY = 4;

/**
 * Embeds many chunks with bounded concurrency rather than fusing multiple
 * texts into one batched tensor.
 *
 * The fused-tensor approach (calling the pipeline with a `string[]` so the
 * model processes several sequences in one forward pass) was tried and
 * rejected after measuring it against this exact model
 * (Xenova/all-MiniLM-L6-v2, ONNX/WASM): batching mixed-length texts
 * together produces embeddings that measurably diverge from the
 * single-sequence result — cosine similarity as low as ~0.966 for a short
 * text batched alongside a much longer one. This isn't a padding-masking
 * bug in transformers.js's own pooling step (`mean_pooling` in
 * utils/tensor.js correctly multiplies by, and divides by the count of,
 * the attention mask) — the drift originates upstream, in the ONNX
 * model's own hidden states shifting slightly based on batch composition.
 * Concurrent *single*-sequence calls, by contrast, were verified to match
 * sequential single-sequence calls to ~1.0 cosine similarity (no
 * cross-request contamination), and are measurably faster than running
 * everything strictly one-at-a-time — so that's the strategy used here:
 * correctness first, with a real throughput gain from concurrency alone.
 */
export async function embedTexts(texts: string[], options: EmbedTextsOptions = {}): Promise<number[][]> {
  if (texts.length === 0) return [];
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const extractor = await getPipeline();

  const embeddings: number[][] = new Array(texts.length);
  let done = 0;

  for (let i = 0; i < texts.length; i += concurrency) {
    const group = texts.slice(i, i + concurrency);
    const results = await Promise.all(group.map((text) => embedOne(extractor, text)));
    results.forEach((vector, offset) => {
      embeddings[i + offset] = vector;
    });
    done += group.length;
    options.onProgress?.(done, texts.length);
  }

  logEvent({ component: "knowledge-embed", message: `Generated ${embeddings.length} embeddings locally (model=${EMBEDDING_MODEL}, concurrency=${concurrency})`, status: "success" });
  return embeddings;
}

/** Cosine similarity for two already-normalized embedding vectors (normalize:true above makes this equivalent to a dot product). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
