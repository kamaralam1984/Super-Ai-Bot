import { Router } from "express";
import { z } from "zod";
import { runKnowledgeBuild } from "../knowledge/knowledgeBuilder.service";
import { performKnowledgeSearch } from "../knowledge/knowledgeSearch.service";
import { getActiveInstallationId } from "../scanner/scanRecord.service";
import { KnowledgeRecordService } from "../knowledge/knowledgeRecord.service";
import { planRollback, type VersionedChunkState } from "../knowledge/version/versionManager";
import { rollbackTrainingRun } from "../knowledge/rollback/trainingRunRollback.service";
import { getDefaultVectorStore } from "../knowledge/vector/vectorStore";
import { EMBEDDING_MODEL } from "../knowledge/embed/embeddings";
import { verifyApiKey, TokenBucketRateLimiter } from "../knowledge/security/accessControl";
import { recordAuditEvent } from "../knowledge/security/auditLog";
import { getSocketServer } from "../ws/socket";
import { AppError } from "../middleware/errorHandler";
import { logEvent } from "../utils/logger";
import { formatError } from "../utils/formatError";

export const knowledgeRouter = Router();

const SEARCH_RATE_LIMIT = new TokenBucketRateLimiter({ maxTokens: 20, refillPerSecond: 2 });

/**
 * Every route here requires the installer's own `API_SECRET` (generated in
 * .env by Phase 1, same secret already used for other internal API
 * surfaces) via an `x-api-key` header, plus a per-caller token-bucket rate
 * limit keyed by that header value (falling back to the connection's IP
 * when no key is presented, so an unauthenticated flood still gets
 * throttled before it's rejected). Search is deliberately still a
 * network-reachable HTTP endpoint (not admin-only) — it's meant to be
 * called by a customer-facing chat surface — but that surface is expected
 * to hold the API key server-side, not ship it to end users' browsers.
 */
knowledgeRouter.use((req, res, next) => {
  const apiKey = req.header("x-api-key");
  const expected = process.env.API_SECRET;
  const clientId = apiKey ?? req.ip ?? "unknown";

  if (!SEARCH_RATE_LIMIT.tryConsume(clientId)) {
    recordAuditEvent({ type: "rate_limited", detail: `client=${clientId} path=${req.path}` });
    next(new AppError(429, "Too many requests", "Slow down and try again shortly.", true));
    return;
  }

  if (!expected || !verifyApiKey(apiKey, expected)) {
    recordAuditEvent({ type: "access_denied", detail: `client=${clientId} path=${req.path}` });
    next(new AppError(401, "Invalid or missing API key", "Pass the installation's API_SECRET as the x-api-key header.", false));
    return;
  }

  next();
});

const buildBodySchema = z.object({
  crawlJobId: z.string().min(1),
  socketId: z.string().min(1),
});

/** Kicks off the knowledge build pipeline for one completed crawl job and returns immediately — progress streams over the caller's Socket.IO room, mirroring /api/scan/start's pattern exactly. */
knowledgeRouter.post("/build", (req, res, next) => {
  try {
    const parsed = buildBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new AppError(400, "No database configured", "Complete the installer (Phase 1) first.", true);
    }

    const io = getSocketServer();
    const { crawlJobId, socketId } = parsed.data;

    runKnowledgeBuild(databaseUrl, crawlJobId, (event) => {
      io.to(socketId).emit("knowledge:progress", event);
    })
      .then((result) => {
        if (result.success) {
          io.to(socketId).emit("knowledge:complete", result);
        } else {
          io.to(socketId).emit("knowledge:error", { crawlJobId, message: result.errorMessage });
        }
      })
      .catch((err) => {
        logEvent({ component: "knowledge-builder", message: "Unhandled knowledge build error", status: "error", error: formatError(err) });
        io.to(socketId).emit("knowledge:error", { crawlJobId, message: formatError(err) });
      });

    res.json({ success: true, data: { started: true } });
  } catch (err) {
    next(err);
  }
});

const searchBodySchema = z.object({
  query: z.string().min(1).max(1000),
  mode: z.enum(["semantic", "keyword", "hybrid"]).optional(),
  category: z.string().optional(),
  language: z.string().optional(),
  k: z.number().int().min(1).max(20).optional(),
});

knowledgeRouter.post("/search", async (req, res, next) => {
  try {
    const parsed = searchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new AppError(400, "No database configured", "Complete the installer (Phase 1) first.", true);
    }
    const installationId = await getActiveInstallationId(databaseUrl);
    if (!installationId) {
      throw new AppError(400, "No completed installation found", "Complete the installer (Phase 1) first.", true);
    }

    const result = await performKnowledgeSearch(databaseUrl, { installationId, ...parsed.data });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

const rollbackBodySchema = z.object({
  chunkId: z.string().min(1),
  targetVersion: z.number().int().min(1),
});

knowledgeRouter.post("/rollback", async (req, res, next) => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    next(new AppError(400, "No database configured", "Complete the installer (Phase 1) first.", true));
    return;
  }

  const records = new KnowledgeRecordService(databaseUrl);
  try {
    const parsed = rollbackBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    }
    const { chunkId, targetVersion } = parsed.data;

    const current = await records.getChunkById(chunkId);
    if (!current) {
      throw new AppError(404, "Chunk not found", undefined, false);
    }
    const installationId = await records.getChunkInstallationId(chunkId);
    const history = await records.getChunkVersionHistory(chunkId);

    const currentState: VersionedChunkState = { version: current.version, content: current.content, embedding: current.embedding, confidenceScore: current.confidenceScore };
    const plan = planRollback(currentState, history, targetVersion);

    await records.archiveVersion(chunkId, plan.archivedVersion);
    await records.restoreChunkContent(chunkId, {
      content: plan.restoredContent,
      embedding: plan.restoredEmbedding,
      confidenceScore: plan.restoredConfidenceScore,
    });

    // Postgres content and the vector index must agree after a rollback —
    // the chunk's restored embedding is only ever the exact one that was
    // live (and therefore already indexed) at that earlier version, so
    // this is always a genuine upsert, never a stale/mismatched vector.
    if (installationId) {
      const vectorStore = getDefaultVectorStore();
      vectorStore.upsert(installationId, chunkId, plan.restoredEmbedding);
      const stats = vectorStore.stats(installationId);
      if (stats) {
        await records.upsertVectorIndexMeta(installationId, {
          vectorCount: stats.vectorCount,
          dimensions: stats.dimensions,
          indexFilePath: `storage/vector-index/${installationId}.hnsw`,
          embeddingModel: EMBEDDING_MODEL,
        });
      }
    }

    recordAuditEvent({ type: "rollback_performed", detail: `chunk=${chunkId} targetVersion=${targetVersion} newVersion=${plan.nextVersion}` });
    res.json({ success: true, data: { chunkId, version: plan.nextVersion } });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

const trainingRunRollbackBodySchema = z.object({
  crawlJobId: z.string().min(1),
});

/**
 * Rolls back every chunk one training run touched in a single operation —
 * see knowledge/rollback/trainingRunRollback.service.ts. The typical case
 * ("that last update broke something, undo it") for when reverting an
 * entire run is faster than finding and reverting each affected chunk
 * individually via POST /rollback.
 */
knowledgeRouter.post("/rollback/training-run", async (req, res, next) => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    next(new AppError(400, "No database configured", "Complete the installer (Phase 1) first.", true));
    return;
  }

  try {
    const parsed = trainingRunRollbackBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    }

    const report = await rollbackTrainingRun(databaseUrl, parsed.data.crawlJobId);
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});
