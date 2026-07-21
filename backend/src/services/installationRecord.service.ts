import { PrismaClient, type InstallationStatus, type LogStatus } from "@prisma/client";
import { logEvent } from "../utils/logger";
import type { InstallProgressEvent } from "@kvl/shared";

/**
 * These records live inside the *product's own* per-installation database
 * (the one Step 6 just created), not some separate global tracking DB — so
 * every function here opens a short-lived Prisma Client scoped to that one
 * connection string and disconnects when done, rather than reusing a single
 * shared client.
 */
function clientFor(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

export async function recordInstallationStart(
  databaseUrl: string,
  input: { applicationId: string; installationId: string; websiteName: string; websiteUrl: string }
): Promise<string> {
  const prisma = clientFor(databaseUrl);
  try {
    const record = await prisma.installation.create({
      data: {
        applicationId: input.applicationId,
        installationId: input.installationId,
        websiteName: input.websiteName,
        websiteUrl: input.websiteUrl,
        status: "IN_PROGRESS",
      },
    });
    return record.id;
  } finally {
    await prisma.$disconnect();
  }
}

export async function recordSecretFingerprints(databaseUrl: string, installationRowId: string, fingerprints: Record<string, string>): Promise<void> {
  const prisma = clientFor(databaseUrl);
  try {
    await prisma.secretFingerprint.createMany({
      data: Object.entries(fingerprints).map(([secretName, fingerprintHash]) => ({
        installationId: installationRowId,
        secretName,
        fingerprintHash,
      })),
    });
  } finally {
    await prisma.$disconnect();
  }
}

const EVENT_TO_LOG_STATUS: Record<InstallProgressEvent["status"], LogStatus> = {
  running: "INFO",
  success: "SUCCESS",
  error: "ERROR",
};

export async function recordProgressEvents(databaseUrl: string, installationRowId: string, events: InstallProgressEvent[]): Promise<void> {
  if (events.length === 0) return;
  const prisma = clientFor(databaseUrl);
  try {
    await prisma.installationLog.createMany({
      data: events.map((e) => ({
        installationId: installationRowId,
        time: new Date(e.timestamp),
        status: EVENT_TO_LOG_STATUS[e.status],
        component: e.stepId,
        message: e.message,
        durationMs: e.durationMs ?? null,
      })),
    });
  } finally {
    await prisma.$disconnect();
  }
}

export async function finalizeInstallationRecord(databaseUrl: string, installationRowId: string, status: InstallationStatus): Promise<void> {
  const prisma = clientFor(databaseUrl);
  try {
    await prisma.installation.update({ where: { id: installationRowId }, data: { status, completedAt: new Date() } });
    logEvent({ component: "installation-record", message: `Installation ${installationRowId} marked ${status}`, status: "info" });
  } finally {
    await prisma.$disconnect();
  }
}
