import * as cheerio from "cheerio";
import { findJsonLdByType, type StructuredDataResult } from "../parse/structuredData";

export interface DetectedProduct {
  name: string;
  category: string | null;
  price: string | null;
  currency: string | null;
  discount: string | null;
  description: string | null;
  specifications: Record<string, string> | null;
  features: string[] | null;
  images: string[];
  sku: string | null;
  brand: string | null;
  stockStatus: string | null;
  rating: number | null;
  reviewCount: number | null;
  source: "structured_data" | "heuristic";
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
}

function fromStructuredData(entry: Record<string, unknown>): DetectedProduct | null {
  const name = asString(entry.name);
  if (!name) return null;

  const offers = Array.isArray(entry.offers) ? entry.offers[0] : entry.offers;
  const offer = (offers ?? {}) as Record<string, unknown>;

  const brand = entry.brand as Record<string, unknown> | string | undefined;
  const brandName = typeof brand === "string" ? brand : asString(brand?.name);

  const aggregateRating = entry.aggregateRating as Record<string, unknown> | undefined;

  const rawImages = entry.image;
  const images = Array.isArray(rawImages) ? rawImages.filter((i): i is string => typeof i === "string") : typeof rawImages === "string" ? [rawImages] : [];

  return {
    name,
    category: asString(entry.category),
    price: asString(offer.price ?? offer.lowPrice),
    currency: asString(offer.priceCurrency),
    discount: null,
    description: asString(entry.description),
    specifications: null,
    features: null,
    images,
    sku: asString(entry.sku ?? entry.mpn),
    brand: brandName,
    stockStatus: asString(offer.availability)?.replace("https://schema.org/", "") ?? null,
    rating: aggregateRating ? Number(aggregateRating.ratingValue) || null : null,
    reviewCount: aggregateRating ? Number(aggregateRating.reviewCount) || null : null,
    source: "structured_data",
  };
}

const PRICE_REGEX = /(?:USD|EUR|GBP|INR|₹|\$|€|£)\s?[\d,]+(?:\.\d{1,2})?/;

const KNOWN_PRODUCT_CONTAINER_SELECTOR =
  ".product, .product-single, .product_main, [class*='product-detail'], [class*='product_detail'], [itemtype*='schema.org/Product'], .woocommerce-product, [data-product-id]";

/**
 * Heuristic fallback for when no schema.org Product JSON-LD is present.
 * Known CMS container class names (WooCommerce, Shopify, generic
 * itemtype microdata) are tried first; real-world custom-built sites
 * (verified against a live demo storefront) often use neither — as a
 * second pass, any page with an <h1> and a price pattern anywhere in its
 * text is treated as a product page, using the whole document as the
 * search scope instead of a specific container.
 */
function fromHeuristic(html: string): DetectedProduct | null {
  const $ = cheerio.load(html);

  let container = $(KNOWN_PRODUCT_CONTAINER_SELECTOR).first();
  if (container.length === 0) {
    const h1 = $("h1").first();
    const hasPriceSignal = PRICE_REGEX.test($("body").text());
    if (h1.length === 0 || !hasPriceSignal) return null;
    container = $("body");
  }

  const name = container.find("h1, .product_title, .product-title, [itemprop=name]").first().text().trim() || $("h1").first().text().trim();
  if (!name) return null;

  const priceText = container.find(".price, .product-price, .price_color, [itemprop=price], .amount").first().text().trim();
  const priceMatch = (priceText.match(PRICE_REGEX) ?? container.text().match(PRICE_REGEX))?.[0] ?? null;

  const description =
    container.find(".product-description, .woocommerce-product-details__short-description, [itemprop=description]").first().text().trim() ||
    $("#product_description").next("p").text().trim() ||
    null;

  const images = container
    .find("img")
    .map((_i, el) => $(el).attr("src") || $(el).attr("data-src"))
    .get()
    .filter((src): src is string => Boolean(src) && !/icon|logo|sprite|avatar/i.test(src))
    .slice(0, 8); // container may be the whole <body> in the no-known-class fallback path

  const stockText = container.find(".stock, .availability, .instock, [itemprop=availability]").first().text().trim();

  const sku = container.find(".sku, [itemprop=sku]").first().text().trim() || null;
  const brand = container.find(".brand, [itemprop=brand]").first().text().trim() || null;

  return {
    name,
    category: null,
    price: priceMatch,
    currency: null,
    discount: container.find(".discount, .sale-badge, .price del").first().text().trim() || null,
    description,
    specifications: null,
    features: null,
    images,
    sku,
    brand,
    stockStatus: stockText || null,
    rating: null,
    reviewCount: null,
    source: "heuristic",
  };
}

export function detectProducts(html: string, structuredData: StructuredDataResult): DetectedProduct[] {
  const productEntries = findJsonLdByType(structuredData.jsonLd, ["Product"]);
  const fromStructured = productEntries.map(fromStructuredData).filter((p): p is DetectedProduct => p !== null);
  if (fromStructured.length > 0) return fromStructured;

  const heuristic = fromHeuristic(html);
  return heuristic ? [heuristic] : [];
}
