import { PrismaClient, Prisma, type BackupType, type BackupStatus } from "@prisma/client";

function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export interface BackupRecordRow {
  id: string;
  label: string | null;
  type: BackupType;
  status: BackupStatus;
  filePath: string;
  sizeBytes: bigint | null;
  checksumSha256: string | null;
  includes: string[];
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export class BackupRecordService {
  private prisma: PrismaClient;

  constructor(databaseUrl: string) {
    this.prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async createInProgress(installationId: string, type: BackupType, label: string | null, filePath: string): Promise<string> {
    const row = await this.prisma.backupRecord.create({
      data: { installationId, type, label, filePath, status: "IN_PROGRESS", includes: toJson([]) },
    });
    return row.id;
  }

  async markCompleted(id: string, sizeBytes: number, checksumSha256: string, includes: string[]): Promise<void> {
    await this.prisma.backupRecord.update({
      where: { id },
      data: { status: "COMPLETED", sizeBytes: BigInt(sizeBytes), checksumSha256, includes: toJson(includes), completedAt: new Date() },
    });
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.prisma.backupRecord.update({ where: { id }, data: { status: "FAILED", errorMessage, completedAt: new Date() } });
  }

  async list(installationId: string, limit = 50): Promise<BackupRecordRow[]> {
    const rows = await this.prisma.backupRecord.findMany({
      where: { installationId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((r) => ({ ...r, includes: Array.isArray(r.includes) ? (r.includes as string[]) : [] }));
  }

  async get(id: string): Promise<BackupRecordRow | null> {
    const row = await this.prisma.backupRecord.findUnique({ where: { id } });
    if (!row) return null;
    return { ...row, includes: Array.isArray(row.includes) ? (row.includes as string[]) : [] };
  }

  async delete(id: string): Promise<void> {
    await this.prisma.backupRecord.delete({ where: { id } });
  }
}
