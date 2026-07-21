import { Router } from "express";
import { z } from "zod";
import { runConnectorSetup, type ConnectorSetupParams } from "../connector/connectorOrchestrator.service";
import { ConnectorRecordService } from "../connector/connectorRecord.service";
import { generateConnectorReport } from "../connector/report/connectorReportGenerator";
import { attemptReconnection } from "../connector/reconnect/reconnectionEngine";
import { performHealthCheck, classifyStatus } from "../connector/health/healthMonitor";
import { validateSslCertificate } from "../connector/validation/sslValidator";
import { openCredential } from "../connector/vault/credentialVault";
import { logConnectorEvent } from "../connector/events/connectorEvents";
import { soapCall, SoapActionNotAllowedError } from "../connector/protocols/soapClient";
import { grpcCall, GrpcMethodNotAllowedError } from "../connector/protocols/grpcClient";
import * as aiTools from "../permission/integration/authorizedAiToolLayer";
import { PermissionOrchestratorService } from "../permission/permissionOrchestrator.service";
import { verifyApiKey, TokenBucketRateLimiter } from "../knowledge/security/accessControl";
import { recordAuditEvent } from "../knowledge/security/auditLog";
import { getSocketServer } from "../ws/socket";
import { AppError } from "../middleware/errorHandler";
import { logEvent } from "../utils/logger";
import { formatError } from "../utils/formatError";
import type { ConnectorType, RawCredentialInput } from "../connector/types";

export const connectorRouter = Router();

const RATE_LIMIT = new TokenBucketRateLimiter({ maxTokens: 20, refillPerSecond: 2 });

/** Same API_SECRET + per-caller rate-limit gate as every other authenticated API in this product — a connector can hold live credentials to a customer's system, so this is not something to leave unauthenticated. */
connectorRouter.use((req, res, next) => {
  const apiKey = req.header("x-api-key");
  const expected = process.env.API_SECRET;
  const clientId = apiKey ?? req.ip ?? "unknown";

  if (!RATE_LIMIT.tryConsume(clientId)) {
    recordAuditEvent({ type: "rate_limited", detail: `client=${clientId} path=${req.path}`, component: "connector-security" });
    next(new AppError(429, "Too many requests", "Slow down and try again shortly.", true));
    return;
  }

  if (!expected || !verifyApiKey(apiKey, expected)) {
    recordAuditEvent({ type: "access_denied", detail: `client=${clientId} path=${req.path}`, component: "connector-security" });
    next(new AppError(401, "Invalid or missing API key", "Pass the installation's API_SECRET as the x-api-key header.", false));
    return;
  }

  next();
});

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new AppError(400, "No database configured", "Complete the installer (Phase 1) first.", true);
  }
  return databaseUrl;
}

const credentialSchema = z
  .object({
    authMethod: z.enum(["API_KEY", "BEARER_TOKEN", "JWT", "OAUTH2", "BASIC_AUTH", "SESSION", "CUSTOM_HEADER", "SIGNED_REQUEST", "NONE"]),
    apiKey: z.string().optional(),
    bearerToken: z.string().optional(),
    jwt: z.string().optional(),
    oauth2: z
      .object({
        clientId: z.string().optional(),
        clientSecret: z.string().optional(),
        tokenUrl: z.string().optional(),
        accessToken: z.string().optional(),
        refreshToken: z.string().optional(),
        expiresAt: z.string().optional(),
      })
      .optional(),
    basicAuth: z.object({ username: z.string(), password: z.string() }).optional(),
    session: z.object({ cookie: z.string() }).optional(),
    customHeaders: z.record(z.string()).optional(),
    signedRequest: z.object({ keyId: z.string(), secret: z.string() }).optional(),
  })
  .strict() as z.ZodType<RawCredentialInput>;

const connectorTypeSchema = z.enum(["WORDPRESS", "WOOCOMMERCE", "SHOPIFY", "MAGENTO", "OPENCART", "PRESTASHOP", "LARAVEL", "GENERIC_REST", "GENERIC_GRAPHQL", "UNIVERSAL_REST", "WEBHOOK"]);

const startBodySchema = z.object({
  installationId: z.string().min(1),
  crawlJobId: z.string().min(1).optional(),
  manualConnectorType: connectorTypeSchema.optional(),
  manualBaseUrl: z.string().url().optional(),
  credential: credentialSchema.optional(),
  socketId: z.string().min(1),
});

/** Kicks off connector recommendation → auth → discovery → validation → health check and returns immediately — progress streams over the caller's Socket.IO room, mirroring /api/techdetect/start. */
connectorRouter.post("/start", (req, res, next) => {
  try {
    const parsed = startBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    }
    const databaseUrl = requireDatabaseUrl();
    const io = getSocketServer();
    const { socketId, ...setupParams } = parsed.data;

    runConnectorSetup(databaseUrl, setupParams as ConnectorSetupParams, (event) => {
      io.to(socketId).emit("connector:progress", event);
    })
      .then((result) => {
        if (result.success) {
          io.to(socketId).emit("connector:complete", result);
        } else {
          io.to(socketId).emit("connector:error", { message: result.errorMessage });
        }
      })
      .catch((err) => {
        logEvent({ component: "connector-orchestrator", message: "Unhandled connector setup error", status: "error", error: formatError(err) });
        io.to(socketId).emit("connector:error", { message: formatError(err) });
      });

    res.json({ success: true, data: { started: true } });
  } catch (err) {
    next(err);
  }
});

/** Lists every connector configured for an installation. */
connectorRouter.get("/", async (req, res, next) => {
  const installationId = typeof req.query.installationId === "string" ? req.query.installationId : undefined;
  if (!installationId) {
    next(new AppError(400, "installationId query parameter is required", "Pass ?installationId=... .", true));
    return;
  }
  const records = new ConnectorRecordService(requireDatabaseUrl());
  try {
    const connectors = await records.listConnectors(installationId);
    res.json({ success: true, data: connectors });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

const priorityBodySchema = z.object({ priority: z.number().int() });

/** Sets a connector's failover priority — lower value tried first when more than one connector for this installation can serve the same category. See connector/manage/connectionManager.ts and docs/CONNECTOR_EXTENSIONS.md. */
connectorRouter.patch("/:id/priority", async (req, res, next) => {
  const parsed = priorityBodySchema.safeParse(req.body);
  if (!parsed.success) {
    next(new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true));
    return;
  }
  const records = new ConnectorRecordService(requireDatabaseUrl());
  try {
    const connector = await records.getConnector(req.params.id);
    if (!connector) {
      throw new AppError(404, "Connector not found", "Check the connector id.", false);
    }
    await records.updateConnectorPriority(req.params.id, parsed.data.priority);
    res.json({ success: true, data: { updated: true, priority: parsed.data.priority } });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

/** Fetches a freshly-assembled report for one connector — regenerated from its current persisted state rather than a stale cached snapshot. */
connectorRouter.get("/:id", async (req, res, next) => {
  const records = new ConnectorRecordService(requireDatabaseUrl());
  try {
    const connector = await records.getConnector(req.params.id);
    if (!connector) {
      throw new AppError(404, "Connector not found", "Check the connector id, or run POST /api/connector/start first.", false);
    }
    const [endpoints, recentHealthChecks, sslCertificate] = await Promise.all([records.getEndpoints(connector.id), records.getRecentHealthChecks(connector.id), validateSslCertificate(connector.baseUrl)]);
    const report = generateConnectorReport({ connector, endpoints, recentHealthChecks, detectedPlatformName: connector.name, sslCertificate });
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

/** On-demand health check; if it fails, automatically attempts reconnection (token refresh + bounded retries) before reporting the final status. */
connectorRouter.post("/:id/health-check", async (req, res, next) => {
  const records = new ConnectorRecordService(requireDatabaseUrl());
  try {
    const connector = await records.getConnector(req.params.id);
    if (!connector) {
      throw new AppError(404, "Connector not found", "Check the connector id.", false);
    }
    const vaultedCredential = await records.getCredential(connector.id);
    const credential: RawCredentialInput = vaultedCredential ? openCredential(vaultedCredential) : { authMethod: "NONE" };
    const endpoints = await records.getEndpoints(connector.id);
    const checkPath = endpoints.find((e) => e.validated)?.path ?? "/";

    const initial = await performHealthCheck({ connectorId: connector.id, baseUrl: connector.baseUrl, checkPath, credential, config: connector.config });
    await records.recordHealthCheck(connector.id, initial);

    let finalStatus = initial.status;
    let reconnection = null;
    if (initial.status !== "CONNECTED") {
      reconnection = await attemptReconnection({ connectorId: connector.id, baseUrl: connector.baseUrl, checkPath, credential, config: connector.config });
      for (const check of reconnection.history) await records.recordHealthCheck(connector.id, check);
      finalStatus = reconnection.finalStatus;
      if (reconnection.recovered) {
        logConnectorEvent(connector.id, "RECOVERED", reconnection.message);
      } else {
        logConnectorEvent(connector.id, "DISCONNECTED", reconnection.message);
      }
    }

    const recentHistory = await records.getRecentHealthChecks(connector.id);
    const status = classifyStatus(recentHistory);
    await records.updateConnectorStatus(connector.id, status, { lastHealthCheckAt: new Date(), lastErrorMessage: initial.errorMessage ?? null });

    res.json({ success: true, data: { status, initial, reconnection } });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

const toolNameSchema = z.enum([
  "getProducts",
  "searchProducts",
  "getProductDetails",
  "getServices",
  "searchServices",
  "getOrderStatus",
  "getOrders",
  "getCustomer",
  "searchCustomer",
  "getAppointments",
  "searchAppointments",
  "getInventory",
]);
const toolInvokeBodySchema = z.object({ orderId: z.string().optional(), productId: z.string().optional(), customerId: z.string().optional(), query: z.string().optional() });

async function invokeTool(toolName: z.infer<typeof toolNameSchema>, body: z.infer<typeof toolInvokeBodySchema>, permissions: PermissionOrchestratorService, records: ConnectorRecordService, connector: Parameters<typeof aiTools.getProducts>[2]) {
  switch (toolName) {
    case "getProducts":
      return aiTools.getProducts(permissions, records, connector);
    case "searchProducts":
      if (!body.query) throw new AppError(400, "searchProducts requires a query", "Pass { query } in the request body.", true);
      return aiTools.searchProducts(permissions, records, connector, body.query);
    case "getProductDetails":
      if (!body.productId) throw new AppError(400, "getProductDetails requires a productId", "Pass { productId } in the request body.", true);
      return aiTools.getProductDetails(permissions, records, connector, body.productId);
    case "getServices":
      return aiTools.getServices(permissions, records, connector);
    case "searchServices":
      if (!body.query) throw new AppError(400, "searchServices requires a query", "Pass { query } in the request body.", true);
      return aiTools.searchServices(permissions, records, connector, body.query);
    case "getOrderStatus":
      return aiTools.getOrderStatus(permissions, records, connector, body.orderId);
    case "getOrders":
      return aiTools.getOrders(permissions, records, connector);
    case "getCustomer":
      if (!body.customerId) throw new AppError(400, "getCustomer requires a customerId", "Pass { customerId } in the request body.", true);
      return aiTools.getCustomer(permissions, records, connector, body.customerId);
    case "searchCustomer":
      if (!body.query) throw new AppError(400, "searchCustomer requires a query", "Pass { query } in the request body.", true);
      return aiTools.searchCustomer(permissions, records, connector, body.query);
    case "getAppointments":
      return aiTools.getAppointments(permissions, records, connector);
    case "searchAppointments":
      if (!body.query) throw new AppError(400, "searchAppointments requires a query", "Pass { query } in the request body.", true);
      return aiTools.searchAppointments(permissions, records, connector, body.query);
    case "getInventory":
      return aiTools.getInventory(permissions, records, connector);
  }
}

/** Invokes one of the connector-backed AI tools — permission-checked (connector must be CONNECTED/DEGRADED with a validated endpoint) before any outbound call is made. */
connectorRouter.post("/:id/tools/:toolName", async (req, res, next) => {
  const toolNameParsed = toolNameSchema.safeParse(req.params.toolName);
  if (!toolNameParsed.success) {
    next(new AppError(400, "Unknown tool name", `Must be one of: ${toolNameSchema.options.join(", ")}.`, true));
    return;
  }
  const bodyParsed = toolInvokeBodySchema.safeParse(req.body ?? {});
  if (!bodyParsed.success) {
    next(new AppError(400, "Invalid request body", bodyParsed.error.issues.map((i) => i.message).join("; "), true));
    return;
  }

  const records = new ConnectorRecordService(requireDatabaseUrl());
  const permissions = new PermissionOrchestratorService(requireDatabaseUrl());
  try {
    const connector = await records.getConnector(req.params.id);
    if (!connector) {
      throw new AppError(404, "Connector not found", "Check the connector id.", false);
    }

    const result = await invokeTool(toolNameParsed.data, bodyParsed.data, permissions, records, connector);
    res.json({ success: result.ok, data: result });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
    await permissions.close();
  }
});

const soapCallBodySchema = z.object({
  path: z.string().min(1),
  action: z.string().min(1),
  operationName: z.string().min(1),
  parameters: z.record(z.unknown()).optional(),
});

/**
 * Invokes one SOAP operation on a SOAP_API connector. `action` must be on
 * that connector's `SoapConnectionConfig.allowedActions` list — an action
 * not on the list is refused with a 403 before any request reaches the
 * target system (see protocols/soapClient.ts's `SoapActionNotAllowedError`).
 */
connectorRouter.post("/:id/soap-call", async (req, res, next) => {
  const parsed = soapCallBodySchema.safeParse(req.body);
  if (!parsed.success) {
    next(new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true));
    return;
  }
  const records = new ConnectorRecordService(requireDatabaseUrl());
  try {
    const connector = await records.getConnector(req.params.id);
    if (!connector) {
      throw new AppError(404, "Connector not found", "Check the connector id.", false);
    }
    if (connector.connectorType !== "SOAP_API") {
      throw new AppError(400, "Not a SOAP connector", `Connector "${connector.name}" is a ${connector.connectorType} connector, not SOAP_API.`, false);
    }
    const soapConfig = connector.config.soap;
    if (!soapConfig) {
      throw new AppError(400, "SOAP connection config missing", "This connector has no soap config (targetNamespace/allowedActions) set.", false);
    }

    const vaultedCredential = await records.getCredential(connector.id);
    const credential: RawCredentialInput = vaultedCredential ? openCredential(vaultedCredential) : { authMethod: "NONE" };

    const result = await soapCall({ connectorId: connector.id, baseUrl: connector.baseUrl, path: parsed.data.path, action: parsed.data.action, operationName: parsed.data.operationName, parameters: parsed.data.parameters, credential, config: connector.config, soapConfig });
    await records.recordEvent(connector.id, "API_CALL", `SOAP call: ${parsed.data.action} → HTTP ${result.statusCode}`);
    res.json({ success: result.ok, data: result });
  } catch (err) {
    if (err instanceof SoapActionNotAllowedError) {
      next(new AppError(403, "SOAP action not allowed", err.message, false));
      return;
    }
    next(err);
  } finally {
    await records.close();
  }
});

const grpcCallBodySchema = z.object({
  methodName: z.string().min(1),
  request: z.record(z.unknown()).default({}),
});

/**
 * Invokes one unary RPC method on a GRPC_API connector. `methodName` must
 * be on that connector's `GrpcConnectionConfig.allowedMethods` list — same
 * least-privilege enforcement as SOAP's action allow-list (see
 * protocols/grpcClient.ts's `GrpcMethodNotAllowedError`).
 */
connectorRouter.post("/:id/grpc-call", async (req, res, next) => {
  const parsed = grpcCallBodySchema.safeParse(req.body);
  if (!parsed.success) {
    next(new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true));
    return;
  }
  const records = new ConnectorRecordService(requireDatabaseUrl());
  try {
    const connector = await records.getConnector(req.params.id);
    if (!connector) {
      throw new AppError(404, "Connector not found", "Check the connector id.", false);
    }
    if (connector.connectorType !== "GRPC_API") {
      throw new AppError(400, "Not a gRPC connector", `Connector "${connector.name}" is a ${connector.connectorType} connector, not GRPC_API.`, false);
    }
    const grpcConfig = connector.config.grpc;
    if (!grpcConfig) {
      throw new AppError(400, "gRPC connection config missing", "This connector has no grpc config (protoSource/packageName/serviceName/allowedMethods) set.", false);
    }

    const vaultedCredential = await records.getCredential(connector.id);
    const credential: RawCredentialInput = vaultedCredential ? openCredential(vaultedCredential) : { authMethod: "NONE" };
    // gRPC targets are "host:port", not a scheme-prefixed URL — baseUrl is
    // stored the same way every other connector type stores it, so any
    // "https://"/"http://" prefix is stripped here rather than asking the
    // administrator to enter it differently for this one connector type.
    const target = connector.baseUrl.replace(/^https?:\/\//, "");

    const result = await grpcCall({ target, methodName: parsed.data.methodName, request: parsed.data.request, credential, grpcConfig, timeoutMs: connector.config.timeoutMs });
    await records.recordEvent(connector.id, "API_CALL", `gRPC call: ${parsed.data.methodName} → ${result.ok ? "ok" : "error"}`);
    res.json({ success: result.ok, data: result });
  } catch (err) {
    if (err instanceof GrpcMethodNotAllowedError) {
      next(new AppError(403, "gRPC method not allowed", err.message, false));
      return;
    }
    next(err);
  } finally {
    await records.close();
  }
});

const searchKnowledgeBodySchema = z.object({
  installationId: z.string().min(1),
  query: z.string().min(1),
  category: z.string().optional(),
  language: z.string().optional(),
  k: z.number().int().positive().max(50).optional(),
});

/** The one AI tool that isn't connector-backed — wired directly to Phase 3's real semantic search. Kept on this router since it shares the same AI-tool permission surface and auth gate. */
connectorRouter.post("/tools/search-knowledge", async (req, res, next) => {
  const parsed = searchKnowledgeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    next(new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true));
    return;
  }
  const permissions = new PermissionOrchestratorService(requireDatabaseUrl());
  try {
    const result = await aiTools.searchKnowledge(permissions, parsed.data.installationId, requireDatabaseUrl(), parsed.data);
    res.json({ success: result.ok, data: result });
  } catch (err) {
    next(err);
  } finally {
    await permissions.close();
  }
});

connectorRouter.get("/meta/ai-tools", (_req, res) => {
  res.json({ success: true, data: aiTools.AI_TOOL_NAMES });
});
