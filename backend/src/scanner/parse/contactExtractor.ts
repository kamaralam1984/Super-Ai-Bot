import * as cheerio from "cheerio";
import type { StructuredDataResult } from "./structuredData";
import { findJsonLdByType } from "./structuredData";

export interface ContactInfo {
  phones: string[];
  emails: string[];
  addresses: string[];
  businessHours: string[];
  mapsLinks: string[];
  whatsappLinks: string[];
  socialLinks: { platform: string; url: string }[];
}

// International-ish phone matcher: optional +country, groups of digits separated by spaces/dashes/dots/parens, 7-15 digits total.
const PHONE_REGEX = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const SOCIAL_PLATFORM_MATCHERS: [string, RegExp][] = [
  ["Facebook", /facebook\.com|fb\.com/i],
  ["Twitter/X", /twitter\.com|x\.com/i],
  ["Instagram", /instagram\.com/i],
  ["LinkedIn", /linkedin\.com/i],
  ["YouTube", /youtube\.com|youtu\.be/i],
  ["TikTok", /tiktok\.com/i],
  ["Pinterest", /pinterest\.com/i],
  ["Telegram", /t\.me|telegram\.org/i],
];

function digitsOnlyLength(phone: string): number {
  return phone.replace(/\D/g, "").length;
}

/**
 * Extracts contact details two ways: structured data first (schema.org
 * PostalAddress/telephone/openingHours in JSON-LD — precise when present),
 * then heuristic scanning of visible text and link hrefs as a fallback/
 * supplement. Both sources are merged and deduplicated.
 */
export function extractContactInfo(html: string, structuredData: StructuredDataResult): ContactInfo {
  const $ = cheerio.load(html);
  const bodyText = $("body").text();

  const phones = new Set<string>();
  const emails = new Set<string>();
  const addresses = new Set<string>();
  const businessHours = new Set<string>();
  const mapsLinks = new Set<string>();
  const whatsappLinks = new Set<string>();
  const socialLinks = new Map<string, { platform: string; url: string }>();

  // tel: / mailto: links — high precision, always trusted
  $('a[href^="tel:"]').each((_i, el) => {
    const value = $(el).attr("href")?.replace("tel:", "").trim();
    if (value && digitsOnlyLength(value) >= 7) phones.add(value);
  });
  $('a[href^="mailto:"]').each((_i, el) => {
    const value = $(el).attr("href")?.replace("mailto:", "").split("?")[0].trim();
    if (value) emails.add(value);
  });

  // heuristic text scan (bounded — full body text, but regex is linear)
  for (const match of bodyText.match(PHONE_REGEX) ?? []) {
    const trimmed = match.trim();
    if (digitsOnlyLength(trimmed) >= 7 && digitsOnlyLength(trimmed) <= 15) phones.add(trimmed);
  }
  for (const match of bodyText.match(EMAIL_REGEX) ?? []) emails.add(match.toLowerCase());

  // links: maps, whatsapp, social
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (/google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(href)) mapsLinks.add(href);
    if (/wa\.me\/|api\.whatsapp\.com/i.test(href)) whatsappLinks.add(href);
    for (const [platform, matcher] of SOCIAL_PLATFORM_MATCHERS) {
      if (matcher.test(href) && !socialLinks.has(href)) {
        socialLinks.set(href, { platform, url: href });
      }
    }
  });

  // structured data: LocalBusiness / Organization → address, hours, phone
  const businesses = findJsonLdByType(structuredData.jsonLd, ["LocalBusiness", "Organization", "Store", "Restaurant"]);
  for (const biz of businesses) {
    const telephone = biz.telephone;
    if (typeof telephone === "string") phones.add(telephone);

    const email = biz.email;
    if (typeof email === "string") emails.add(email);

    const address = biz.address as Record<string, unknown> | string | undefined;
    if (typeof address === "string") {
      addresses.add(address);
    } else if (address && typeof address === "object") {
      const parts = [address.streetAddress, address.addressLocality, address.addressRegion, address.postalCode, address.addressCountry]
        .filter((p) => typeof p === "string" && p.trim())
        .join(", ");
      if (parts) addresses.add(parts);
    }

    const hours = biz.openingHours ?? biz.openingHoursSpecification;
    for (const h of Array.isArray(hours) ? hours : hours ? [hours] : []) {
      if (typeof h === "string") businessHours.add(h);
      else if (h && typeof h === "object") {
        const spec = h as Record<string, unknown>;
        const days = Array.isArray(spec.dayOfWeek) ? spec.dayOfWeek.join(", ") : spec.dayOfWeek;
        if (days && spec.opens && spec.closes) businessHours.add(`${days}: ${spec.opens}-${spec.closes}`);
      }
    }
  }

  return {
    phones: [...phones].slice(0, 20),
    emails: [...emails].slice(0, 20),
    addresses: [...addresses].slice(0, 10),
    businessHours: [...businessHours].slice(0, 20),
    mapsLinks: [...mapsLinks].slice(0, 10),
    whatsappLinks: [...whatsappLinks].slice(0, 10),
    socialLinks: [...socialLinks.values()],
  };
}
