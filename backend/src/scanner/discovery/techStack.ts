import * as cheerio from "cheerio";

export interface TechStackSignals {
  cms: string | null;
  frameworks: string[];
  server: string | null;
  ecommerce: string | null;
  confidence: "high" | "medium" | "low";
}

interface Signal {
  name: string;
  test: ($: cheerio.CheerioAPI, html: string, headers: Record<string, string | string[] | undefined>) => boolean;
}

const CMS_SIGNALS: Signal[] = [
  { name: "WordPress", test: ($, html) => /\/wp-content\/|\/wp-includes\/|wp-json/i.test(html) || $('meta[name="generator"][content*="WordPress" i]').length > 0 },
  { name: "WooCommerce", test: ($, html) => /woocommerce/i.test(html) },
  { name: "Shopify", test: ($, html) => /cdn\.shopify\.com|Shopify\.theme/i.test(html) },
  { name: "Magento", test: ($, html) => /Mage\.Cookies|\/static\/version\d+\/frontend\//i.test(html) },
  { name: "Drupal", test: ($, html) => /Drupal\.settings|\/sites\/default\/files\//i.test(html) || $('meta[name="generator"][content*="Drupal" i]').length > 0 },
  { name: "Joomla", test: ($, html) => /\/media\/jui\/|Joomla!/i.test(html) },
  { name: "Wix", test: ($, html) => /static\.wixstatic\.com|wix-code/i.test(html) },
  { name: "Squarespace", test: ($, html) => /static1\.squarespace\.com/i.test(html) },
];

const FRAMEWORK_SIGNALS: Signal[] = [
  { name: "Next.js", test: ($, html) => /__NEXT_DATA__|_next\/static/i.test(html) },
  { name: "React", test: ($, html) => /data-reactroot|react-dom/i.test(html) || $("[id=root],[id=app]").length > 0 && /react/i.test(html) },
  { name: "Vue", test: ($, html) => /__NUXT__|data-v-[a-f0-9]{8}|vue\.(runtime\.)?(min\.)?js/i.test(html) },
  { name: "Angular", test: ($) => $("[ng-version]").length > 0 || $("app-root").length > 0 },
  { name: "Laravel", test: (_$, _html, headers) => Boolean(headers["set-cookie"]?.toString().includes("laravel_session")) },
  { name: "Django", test: (_$, _html, headers) => Boolean(headers["set-cookie"]?.toString().includes("csrftoken")) },
  { name: "ASP.NET", test: ($, html, headers) => /__VIEWSTATE/i.test(html) || Boolean(headers["x-aspnet-version"] || headers["x-powered-by"]?.toString().includes("ASP.NET")) },
  { name: "FastAPI", test: (_$, _html, headers) => Boolean(headers["x-process-time"]) },
];

/** Read-only heuristic detection from HTML markers and response headers — no active fingerprinting requests. */
export function detectTechStack(html: string, headers: Record<string, string | string[] | undefined>): TechStackSignals {
  const $ = cheerio.load(html);

  const cms = CMS_SIGNALS.find((s) => s.test($, html, headers))?.name ?? null;
  const frameworks = FRAMEWORK_SIGNALS.filter((s) => s.test($, html, headers)).map((s) => s.name);
  const ecommerce = ["WooCommerce", "Shopify", "Magento"].find((name) => cms === name || frameworks.includes(name)) ?? null;

  const serverHeader = headers["server"];
  const poweredByHeader = headers["x-powered-by"];
  const server = (Array.isArray(serverHeader) ? serverHeader[0] : serverHeader) ?? (Array.isArray(poweredByHeader) ? poweredByHeader[0] : poweredByHeader) ?? null;

  const signalCount = (cms ? 1 : 0) + frameworks.length;
  const confidence = signalCount >= 2 ? "high" : signalCount === 1 ? "medium" : "low";

  return { cms, frameworks, server, ecommerce, confidence };
}
