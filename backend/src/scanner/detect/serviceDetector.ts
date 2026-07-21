import * as cheerio from "cheerio";
import { findJsonLdByType, type StructuredDataResult } from "../parse/structuredData";

export interface DetectedService {
  name: string;
  description: string | null;
  pricing: string | null;
  benefits: string[] | null;
  features: string[] | null;
  workflow: string[] | null;
  industries: string[] | null;
  source: "structured_data" | "heuristic";
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function fromStructuredData(entry: Record<string, unknown>): DetectedService | null {
  const name = asString(entry.name);
  if (!name) return null;
  const offers = Array.isArray(entry.offers) ? entry.offers[0] : entry.offers;
  const offer = (offers ?? {}) as Record<string, unknown>;

  return {
    name,
    description: asString(entry.description),
    pricing: asString(offer.price) ?? (offer.price ? String(offer.price) : null),
    benefits: null,
    features: null,
    workflow: null,
    industries: Array.isArray(entry.areaServed) ? (entry.areaServed as unknown[]).map(String) : null,
    source: "structured_data",
  };
}

const SERVICE_SECTION_SELECTOR = "[class*=service], [id*=service], section:has(h2:contains('Service')), section:has(h2:contains('service'))";

/**
 * Heuristic fallback: most service-business sites present services as a
 * repeated card/section pattern (icon + heading + short description) under
 * a "services" section — there's no schema.org convention as strong as
 * Product's, so this pattern match is the primary real-world signal.
 */
function fromHeuristic(html: string): DetectedService[] {
  const $ = cheerio.load(html);
  const services: DetectedService[] = [];

  $(SERVICE_SECTION_SELECTOR)
    .find("h3, h4")
    .each((_i, el) => {
      const name = $(el).text().trim();
      if (!name || name.length > 100) return;
      const description = $(el).nextAll("p").first().text().trim() || $(el).parent().find("p").first().text().trim() || null;
      if (services.some((s) => s.name === name)) return;
      services.push({ name, description, pricing: null, benefits: null, features: null, workflow: null, industries: null, source: "heuristic" });
    });

  return services.slice(0, 30);
}

export function detectServices(html: string, structuredData: StructuredDataResult): DetectedService[] {
  const serviceEntries = findJsonLdByType(structuredData.jsonLd, ["Service"]);
  const fromStructured = serviceEntries.map(fromStructuredData).filter((s): s is DetectedService => s !== null);
  if (fromStructured.length > 0) return fromStructured;

  return fromHeuristic(html);
}
