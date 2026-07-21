import { PrismaClient, Prisma } from "@prisma/client";
import type { TechnologyReport } from "./report/reportGenerator";

function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Phase 4's Prisma persistence layer — one client per detection run, same pattern as Phase 2/3's record services. Every other techdetect/ module stays Prisma-free; this is the only place that reads or writes the database. */
export class TechDetectRecordService {
  private prisma: PrismaClient;

  constructor(databaseUrl: string) {
    this.prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async getCrawlJobWebsiteUrl(crawlJobId: string): Promise<string> {
    const job = await this.prisma.crawlJob.findUniqueOrThrow({ where: { id: crawlJobId }, select: { websiteUrl: true } });
    return job.websiteUrl;
  }

  async saveReport(crawlJobId: string, report: TechnologyReport): Promise<void> {
    const data = {
      websiteUrl: report.websiteUrl,
      cms: toJson(report.cms),
      frontendFrameworks: toJson(report.frontendFrameworks),
      backendFrameworks: toJson(report.backendFrameworks),
      programmingLanguages: toJson(report.programmingLanguages),
      hosting: toJson(report.hosting),
      server: toJson(report.server),
      cdn: toJson(report.cdn),
      database: toJson(report.database),
      jsLibraries: toJson(report.jsLibraries),
      cssFrameworks: toJson(report.cssFrameworks),
      seoTools: toJson(report.seoTools),
      analytics: toJson(report.analytics),
      paymentGateways: toJson(report.paymentGateways),
      authentication: toJson(report.authentication),
      liveChat: toJson(report.liveChat),
      forms: toJson(report.forms),
      securityFindings: toJson(report.security.findings),
      securityScore: report.security.score,
      performanceFindings: toJson(report.performance.findings),
      performanceScore: report.performance.score,
      overallConfidence: report.overallConfidence,
      recommendations: toJson(report.recommendations),
      smartConnectorCompatibility: toJson(report.smartConnectorCompatibility),
    };

    await this.prisma.techDetectionReport.upsert({
      where: { crawlJobId },
      create: { crawlJobId, ...data },
      update: data,
    });
  }

  async getReport(crawlJobId: string): Promise<TechnologyReport | null> {
    const row = await this.prisma.techDetectionReport.findUnique({ where: { crawlJobId } });
    if (!row) return null;

    return {
      websiteUrl: row.websiteUrl,
      cms: row.cms as unknown as TechnologyReport["cms"],
      frontendFrameworks: row.frontendFrameworks as unknown as TechnologyReport["frontendFrameworks"],
      backendFrameworks: row.backendFrameworks as unknown as TechnologyReport["backendFrameworks"],
      programmingLanguages: row.programmingLanguages as unknown as TechnologyReport["programmingLanguages"],
      hosting: row.hosting as unknown as TechnologyReport["hosting"],
      server: row.server as unknown as TechnologyReport["server"],
      cdn: row.cdn as unknown as TechnologyReport["cdn"],
      database: row.database as unknown as TechnologyReport["database"],
      jsLibraries: row.jsLibraries as unknown as TechnologyReport["jsLibraries"],
      cssFrameworks: row.cssFrameworks as unknown as TechnologyReport["cssFrameworks"],
      seoTools: row.seoTools as unknown as TechnologyReport["seoTools"],
      analytics: row.analytics as unknown as TechnologyReport["analytics"],
      paymentGateways: row.paymentGateways as unknown as TechnologyReport["paymentGateways"],
      authentication: row.authentication as unknown as TechnologyReport["authentication"],
      liveChat: row.liveChat as unknown as TechnologyReport["liveChat"],
      forms: row.forms as unknown as TechnologyReport["forms"],
      security: { findings: row.securityFindings as unknown as TechnologyReport["security"]["findings"], score: row.securityScore },
      performance: { findings: row.performanceFindings as unknown as TechnologyReport["performance"]["findings"], score: row.performanceScore },
      overallConfidence: row.overallConfidence,
      recommendations: row.recommendations as unknown as string[],
      smartConnectorCompatibility: row.smartConnectorCompatibility as unknown as TechnologyReport["smartConnectorCompatibility"],
    };
  }
}
