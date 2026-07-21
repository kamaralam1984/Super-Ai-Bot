import { PrismaClient, Prisma, type PluginStatus } from "@prisma/client";
import type { PluginManifest } from "./pluginManifest";

function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export interface PluginRow {
  id: string;
  name: string;
  version: string;
  entryPoint: string;
  permissions: string[];
  manifest: PluginManifest;
  status: PluginStatus;
  errorMessage: string | null;
  installedAt: Date;
  updatedAt: Date;
}

function toRow(row: {
  id: string;
  name: string;
  version: string;
  entryPoint: string;
  permissions: unknown;
  manifest: unknown;
  status: PluginStatus;
  errorMessage: string | null;
  installedAt: Date;
  updatedAt: Date;
}): PluginRow {
  return {
    ...row,
    permissions: Array.isArray(row.permissions) ? (row.permissions as string[]) : [],
    manifest: row.manifest as unknown as PluginManifest,
  };
}

export class PluginRecordService {
  private prisma: PrismaClient;

  constructor(databaseUrl: string) {
    this.prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /** Upsert on (installationId, name) — reinstalling/upgrading a plugin (same name, new version) updates the existing row rather than creating a duplicate, so its enabled/disabled state survives an upgrade. */
  async upsert(installationId: string, manifest: PluginManifest): Promise<string> {
    const row = await this.prisma.plugin.upsert({
      where: { installationId_name: { installationId, name: manifest.name } },
      create: {
        installationId,
        name: manifest.name,
        version: manifest.version,
        entryPoint: manifest.entryPoint,
        permissions: toJson(manifest.permissions),
        manifest: toJson(manifest),
        status: "DISABLED",
      },
      update: {
        version: manifest.version,
        entryPoint: manifest.entryPoint,
        permissions: toJson(manifest.permissions),
        manifest: toJson(manifest),
        errorMessage: null,
      },
    });
    return row.id;
  }

  async setStatus(id: string, status: PluginStatus, errorMessage: string | null = null): Promise<void> {
    await this.prisma.plugin.update({ where: { id }, data: { status, errorMessage } });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.plugin.delete({ where: { id } });
  }

  async get(id: string): Promise<PluginRow | null> {
    const row = await this.prisma.plugin.findUnique({ where: { id } });
    return row ? toRow(row) : null;
  }

  async list(installationId: string): Promise<PluginRow[]> {
    const rows = await this.prisma.plugin.findMany({ where: { installationId }, orderBy: { name: "asc" } });
    return rows.map(toRow);
  }
}
