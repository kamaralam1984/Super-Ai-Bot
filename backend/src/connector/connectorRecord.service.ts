import { PrismaClient, Prisma } from "@prisma/client";
import type {
  ConnectorAuthMethod,
  ConnectorEventType,
  ConnectorRecommendation,
  ConnectorRuntimeConfig,
  ConnectorStatus,
  ConnectorType,
  EndpointCategory,
  HealthCheckResult,
  ValidatedEndpoint,
} from "./types";
import type { VaultedCredential } from "./vault/credentialVault";

function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export interface ConnectorRecord {
  id: string;
  installationId: string;
  crawlJobId: string | null;
  name: string;
  connectorType: ConnectorType;
  authMethod: ConnectorAuthMethod;
  baseUrl: string;
  status: ConnectorStatus;
  /** Lower value = tried first when more than one connector can serve the same category — see connector/manage/connectionManager.ts. */
  priority: number;
  config: ConnectorRuntimeConfig;
  healthScore: number | null;
  securityScore: number | null;
  lastHealthCheckAt: Date | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectorEndpointRecord {
  id: string;
  category: EndpointCategory;
  path: string;
  method: string;
  discoveredVia: string;
  validated: boolean;
  responseSample: unknown;
  latencyMs: number | null;
  errorMessage: string | null;
  lastValidatedAt: Date | null;
}

/** Phase 5's Prisma persistence layer — same one-service-per-phase pattern as Phase 4's TechDetectRecordService. Every other connector/ module stays Prisma-free. */
export class ConnectorRecordService {
  private prisma: PrismaClient;

  constructor(databaseUrl: string) {
    this.prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async createConnector(params: {
    installationId: string;
    crawlJobId?: string | null;
    recommendation: ConnectorRecommendation;
    config: ConnectorRuntimeConfig;
  }): Promise<ConnectorRecord> {
    const row = await this.prisma.connector.create({
      data: {
        installationId: params.installationId,
        crawlJobId: params.crawlJobId ?? null,
        name: params.recommendation.suggestedName,
        connectorType: params.recommendation.connectorType as never,
        authMethod: params.recommendation.authMethod as never,
        baseUrl: params.recommendation.baseUrl,
        status: "PENDING",
        config: toJson(params.config),
      },
    });
    await this.recordEvent(row.id, "CREATED", `Connector "${row.name}" created (${row.connectorType}, auth: ${row.authMethod}).`);
    return this.mapConnector(row);
  }

  async getConnector(connectorId: string): Promise<ConnectorRecord | null> {
    const row = await this.prisma.connector.findUnique({ where: { id: connectorId } });
    return row ? this.mapConnector(row) : null;
  }

  async listConnectors(installationId: string): Promise<ConnectorRecord[]> {
    const rows = await this.prisma.connector.findMany({ where: { installationId }, orderBy: { createdAt: "desc" } });
    return rows.map((row) => this.mapConnector(row));
  }

  /** Sets a connector's failover priority — lower value tried first among connectors that can serve the same category; see manage/connectionManager.ts. */
  async updateConnectorPriority(connectorId: string, priority: number): Promise<void> {
    await this.prisma.connector.update({ where: { id: connectorId }, data: { priority } });
  }

  async updateConnectorStatus(connectorId: string, status: ConnectorStatus, extra?: { healthScore?: number; securityScore?: number; lastErrorMessage?: string | null; lastHealthCheckAt?: Date }): Promise<void> {
    await this.prisma.connector.update({
      where: { id: connectorId },
      data: {
        status: status as never,
        healthScore: extra?.healthScore,
        securityScore: extra?.securityScore,
        lastErrorMessage: extra?.lastErrorMessage,
        lastHealthCheckAt: extra?.lastHealthCheckAt,
      },
    });
  }

  async storeCredential(connectorId: string, vaulted: VaultedCredential): Promise<void> {
    await this.prisma.connectorCredential.upsert({
      where: { connectorId },
      create: {
        connectorId,
        authMethod: vaulted.authMethod as never,
        encryptedPayload: vaulted.encryptedPayload,
        fingerprint: vaulted.fingerprint,
      },
      update: {
        authMethod: vaulted.authMethod as never,
        encryptedPayload: vaulted.encryptedPayload,
        fingerprint: vaulted.fingerprint,
        rotatedAt: new Date(),
      },
    });
    await this.recordEvent(connectorId, "AUTHENTICATED", `Credential stored for connector (auth: ${vaulted.authMethod}, fingerprint: ${vaulted.fingerprint.slice(0, 12)}…).`);
  }

  async getCredential(connectorId: string): Promise<VaultedCredential | null> {
    const row = await this.prisma.connectorCredential.findUnique({ where: { connectorId } });
    if (!row) return null;
    return { authMethod: row.authMethod as ConnectorAuthMethod, encryptedPayload: row.encryptedPayload, fingerprint: row.fingerprint };
  }

  async saveEndpoints(connectorId: string, endpoints: ValidatedEndpoint[]): Promise<void> {
    for (const endpoint of endpoints) {
      await this.prisma.connectorEndpoint.upsert({
        where: { connectorId_path: { connectorId, path: endpoint.path } },
        create: {
          connectorId,
          category: endpoint.category,
          path: endpoint.path,
          method: endpoint.method,
          discoveredVia: endpoint.discoveredVia,
          validated: endpoint.validated,
          responseSample: endpoint.responseSample !== undefined ? toJson(endpoint.responseSample) : Prisma.JsonNull,
          latencyMs: endpoint.latencyMs ?? null,
          errorMessage: endpoint.errorMessage ?? null,
          lastValidatedAt: endpoint.validated ? new Date() : null,
        },
        update: {
          validated: endpoint.validated,
          responseSample: endpoint.responseSample !== undefined ? toJson(endpoint.responseSample) : Prisma.JsonNull,
          latencyMs: endpoint.latencyMs ?? null,
          errorMessage: endpoint.errorMessage ?? null,
          lastValidatedAt: endpoint.validated ? new Date() : null,
        },
      });
    }
  }

  async getEndpoints(connectorId: string): Promise<ConnectorEndpointRecord[]> {
    const rows = await this.prisma.connectorEndpoint.findMany({ where: { connectorId } });
    return rows.map((row) => ({
      id: row.id,
      category: row.category as EndpointCategory,
      path: row.path,
      method: row.method,
      discoveredVia: row.discoveredVia,
      validated: row.validated,
      responseSample: row.responseSample,
      latencyMs: row.latencyMs,
      errorMessage: row.errorMessage,
      lastValidatedAt: row.lastValidatedAt,
    }));
  }

  async getEndpointForCategory(connectorId: string, category: EndpointCategory): Promise<ConnectorEndpointRecord | null> {
    const row = await this.prisma.connectorEndpoint.findFirst({ where: { connectorId, category, validated: true } });
    if (!row) return null;
    return {
      id: row.id,
      category: row.category as EndpointCategory,
      path: row.path,
      method: row.method,
      discoveredVia: row.discoveredVia,
      validated: row.validated,
      responseSample: row.responseSample,
      latencyMs: row.latencyMs,
      errorMessage: row.errorMessage,
      lastValidatedAt: row.lastValidatedAt,
    };
  }

  async recordHealthCheck(connectorId: string, result: HealthCheckResult): Promise<void> {
    await this.prisma.connectorHealthCheck.create({
      data: {
        connectorId,
        checkedAt: new Date(result.checkedAt),
        status: result.status as never,
        latencyMs: result.latencyMs,
        errorMessage: result.errorMessage ?? null,
        availability: result.availability,
      },
    });
    await this.recordEvent(connectorId, "HEALTH_CHECK", `Health check: ${result.status}${result.latencyMs !== null ? ` (${result.latencyMs}ms)` : ""}.`, { status: result.status, latencyMs: result.latencyMs });
  }

  async getRecentHealthChecks(connectorId: string, limit = 20): Promise<HealthCheckResult[]> {
    const rows = await this.prisma.connectorHealthCheck.findMany({
      where: { connectorId },
      orderBy: { checkedAt: "desc" },
      take: limit,
    });
    return rows
      .map((row) => ({
        status: row.status as ConnectorStatus,
        latencyMs: row.latencyMs,
        availability: row.availability,
        errorMessage: row.errorMessage ?? undefined,
        checkedAt: row.checkedAt.toISOString(),
      }))
      .reverse(); // oldest-first, matching what computeHealthScore/classifyStatus expect
  }

  async recordEvent(connectorId: string, eventType: ConnectorEventType, message: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.prisma.connectorEvent.create({
      data: {
        connectorId,
        eventType: eventType as never,
        message,
        metadata: metadata ? toJson(metadata) : Prisma.JsonNull,
      },
    });
  }

  async getEvents(connectorId: string, limit = 50): Promise<Array<{ eventType: ConnectorEventType; message: string; metadata: unknown; createdAt: Date }>> {
    const rows = await this.prisma.connectorEvent.findMany({ where: { connectorId }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.map((row) => ({ eventType: row.eventType as ConnectorEventType, message: row.message, metadata: row.metadata, createdAt: row.createdAt }));
  }

  private mapConnector(row: {
    id: string;
    installationId: string;
    crawlJobId: string | null;
    name: string;
    connectorType: string;
    authMethod: string;
    baseUrl: string;
    status: string;
    priority: number;
    config: unknown;
    healthScore: number | null;
    securityScore: number | null;
    lastHealthCheckAt: Date | null;
    lastErrorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): ConnectorRecord {
    return {
      id: row.id,
      installationId: row.installationId,
      crawlJobId: row.crawlJobId,
      name: row.name,
      connectorType: row.connectorType as ConnectorType,
      authMethod: row.authMethod as ConnectorAuthMethod,
      baseUrl: row.baseUrl,
      status: row.status as ConnectorStatus,
      priority: row.priority,
      config: row.config as unknown as ConnectorRuntimeConfig,
      healthScore: row.healthScore,
      securityScore: row.securityScore,
      lastHealthCheckAt: row.lastHealthCheckAt,
      lastErrorMessage: row.lastErrorMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
