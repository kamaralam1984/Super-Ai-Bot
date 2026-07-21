import { PrismaClient, Prisma, type LicenseStatus } from "@prisma/client";
import type { SignedLicenseFile } from "./licenseValidator";

function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export interface LicenseRow {
  id: string;
  licenseKey: string;
  tier: "STANDARD" | "ENTERPRISE" | "AGENCY";
  machineFingerprint: string;
  status: LicenseStatus;
  issuedAt: Date;
  expiresAt: Date | null;
  activatedAt: Date;
  lastValidatedAt: Date;
  payload: SignedLicenseFile;
}

function toRow(row: {
  id: string;
  licenseKey: string;
  tier: "STANDARD" | "ENTERPRISE" | "AGENCY";
  machineFingerprint: string;
  status: LicenseStatus;
  issuedAt: Date;
  expiresAt: Date | null;
  activatedAt: Date;
  lastValidatedAt: Date;
  payload: unknown;
}): LicenseRow {
  return { ...row, payload: row.payload as unknown as SignedLicenseFile };
}

export class LicenseRecordService {
  private prisma: PrismaClient;

  constructor(databaseUrl: string) {
    this.prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async upsert(installationId: string, file: SignedLicenseFile, machineFingerprint: string, status: LicenseStatus): Promise<LicenseRow> {
    const row = await this.prisma.license.upsert({
      where: { installationId },
      create: {
        installationId,
        licenseKey: file.payload.licenseKey,
        tier: file.payload.tier,
        machineFingerprint,
        status,
        issuedAt: new Date(file.payload.issuedAt),
        expiresAt: file.payload.expiresAt ? new Date(file.payload.expiresAt) : null,
        payload: toJson(file),
      },
      update: {
        licenseKey: file.payload.licenseKey,
        tier: file.payload.tier,
        machineFingerprint,
        status,
        issuedAt: new Date(file.payload.issuedAt),
        expiresAt: file.payload.expiresAt ? new Date(file.payload.expiresAt) : null,
        payload: toJson(file),
        lastValidatedAt: new Date(),
      },
    });
    return toRow(row);
  }

  async updateStatus(installationId: string, status: LicenseStatus): Promise<void> {
    await this.prisma.license.update({ where: { installationId }, data: { status, lastValidatedAt: new Date() } });
  }

  async get(installationId: string): Promise<LicenseRow | null> {
    const row = await this.prisma.license.findUnique({ where: { installationId } });
    return row ? toRow(row) : null;
  }
}
