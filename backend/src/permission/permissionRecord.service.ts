import { PrismaClient, Prisma } from "@prisma/client";
import type { DataScope, PermissionEventType, PermissionGrantRecord } from "./types";

function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export interface PermissionEventRecord {
  id: string;
  installationId: string;
  connectorId: string | null;
  dataScope: DataScope | null;
  eventType: PermissionEventType;
  message: string;
  metadata: unknown;
  createdAt: Date;
}

/**
 * Phase 7's Prisma persistence layer — same one-service-per-phase pattern
 * as every prior phase's record service. Every other permission/ module
 * stays Prisma-free; this is the only place that touches PermissionGrant/
 * PermissionEvent.
 */
export class PermissionRecordService {
  private prisma: PrismaClient;

  constructor(databaseUrl: string) {
    this.prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /** Every ACTIVE grant for an installation, across both its own knowledge base (connectorId null) and every Phase 5 connector — the shape accessControlEngine.evaluateAccess expects, so the caller loads once and evaluates many requests against it. */
  async getActiveGrants(installationId: string): Promise<PermissionGrantRecord[]> {
    const rows = await this.prisma.permissionGrant.findMany({ where: { installationId, status: "ACTIVE" } });
    return rows.map((r) => this.mapGrant(r));
  }

  /** Full grant history (including revoked) for one installation — the wizard's "current state" view and the admin UI's audit trail both need this, not just the active subset. */
  async getAllGrants(installationId: string, connectorId?: string | null): Promise<PermissionGrantRecord[]> {
    const rows = await this.prisma.permissionGrant.findMany({
      where: { installationId, ...(connectorId !== undefined ? { connectorId } : {}) },
      orderBy: { grantedAt: "desc" },
    });
    return rows.map((r) => this.mapGrant(r));
  }

  /**
   * Grants one scope, enforcing "at most one ACTIVE grant per
   * (installationId, connectorId, dataScope)" at the application layer
   * (see schema.prisma's PermissionGrant doc comment for why this can't be
   * a DB unique constraint given connectorId is nullable). Any existing
   * active grant for the same (installationId, connectorId, dataScope) is
   * revoked first inside the same transaction, then a fresh grant row is
   * created — preserving full history instead of mutating a row in place.
   */
  async grantScope(params: { installationId: string; connectorId: string | null; dataScope: DataScope; grantedBy: string; notes?: string }): Promise<PermissionGrantRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.permissionGrant.updateMany({
        where: { installationId: params.installationId, connectorId: params.connectorId, dataScope: params.dataScope, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: new Date(), revokedBy: params.grantedBy },
      });
      return tx.permissionGrant.create({
        data: {
          installationId: params.installationId,
          connectorId: params.connectorId,
          dataScope: params.dataScope as never,
          accessLevel: "READ_ONLY",
          status: "ACTIVE",
          grantedBy: params.grantedBy,
          notes: params.notes,
        },
      });
    });
    return this.mapGrant(row);
  }

  /** Revokes the currently active grant, if any, for a scope. Idempotent — revoking an already-revoked or never-granted scope is a no-op, not an error, matching a wizard resubmission that simply omits a scope it never had. */
  async revokeScope(params: { installationId: string; connectorId: string | null; dataScope: DataScope; revokedBy: string }): Promise<boolean> {
    const result = await this.prisma.permissionGrant.updateMany({
      where: { installationId: params.installationId, connectorId: params.connectorId, dataScope: params.dataScope, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date(), revokedBy: params.revokedBy },
    });
    return result.count > 0;
  }

  async recordEvent(installationId: string, eventType: PermissionEventType, message: string, options?: { connectorId?: string | null; dataScope?: DataScope; metadata?: Record<string, unknown> }): Promise<void> {
    await this.prisma.permissionEvent.create({
      data: {
        installationId,
        connectorId: options?.connectorId ?? null,
        dataScope: (options?.dataScope as never) ?? null,
        eventType: eventType as never,
        message,
        metadata: options?.metadata ? toJson(options.metadata) : Prisma.JsonNull,
      },
    });
  }

  async getEvents(installationId: string, limit = 50): Promise<PermissionEventRecord[]> {
    const rows = await this.prisma.permissionEvent.findMany({ where: { installationId }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.map((r) => ({
      id: r.id,
      installationId: r.installationId,
      connectorId: r.connectorId,
      dataScope: r.dataScope as DataScope | null,
      eventType: r.eventType as PermissionEventType,
      message: r.message,
      metadata: r.metadata,
      createdAt: r.createdAt,
    }));
  }

  private mapGrant(row: {
    id: string;
    installationId: string;
    connectorId: string | null;
    dataScope: string;
    accessLevel: string;
    status: string;
    grantedAt: Date;
    grantedBy: string;
    revokedAt: Date | null;
    revokedBy: string | null;
    notes: string | null;
  }): PermissionGrantRecord {
    return {
      id: row.id,
      installationId: row.installationId,
      connectorId: row.connectorId,
      dataScope: row.dataScope as DataScope,
      accessLevel: row.accessLevel as PermissionGrantRecord["accessLevel"],
      status: row.status as PermissionGrantRecord["status"],
      grantedAt: row.grantedAt,
      grantedBy: row.grantedBy,
      revokedAt: row.revokedAt,
      revokedBy: row.revokedBy,
      notes: row.notes,
    };
  }
}
