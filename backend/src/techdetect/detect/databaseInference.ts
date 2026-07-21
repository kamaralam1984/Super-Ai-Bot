import type { SiteSignals, DetectionCandidate, ScoredCandidate } from "../types";
import { CandidateBuilder, htmlAndScriptsHaystack } from "./signalUtils";

/** Ecosystem-convention inference only fires from a CMS/backend match that's actually reasonably likely — a single weak raw signal (e.g. one coincidentally-reachable path) shouldn't cascade into a confident-looking database guess. Real bug found testing against github.com: a low-confidence Joomla/WordPress false-positive (see cmsDetector.ts) was still triggering "conventionally runs on MySQL" even though the underlying CMS match itself was barely above noise. */
const MIN_CONFIDENCE_FOR_ECOSYSTEM_INFERENCE = 0.4;

/**
 * Infers *likely* database technology — never probed, never connected to,
 * never queried. This is inherently the lowest-confidence category in the
 * whole engine: a database has no reason to expose itself to an ordinary
 * visitor, so there is no equivalent here of a CMS's wp-content path or a
 * CDN's response header. Every signal below is one of exactly two kinds:
 *
 * 1. A **leaked artifact** — an error message or connection string that
 *    accidentally made it into HTML/JS the server already sent (a real
 *    misconfiguration on the target's side, purely observed, never
 *    induced — this module never sends malformed input trying to trigger
 *    an error). These get meaningfully higher weight because they're
 *    direct evidence, not inference.
 * 2. An **ecosystem-convention inference** from the already-detected CMS/
 *    backend framework (e.g. "WordPress sites overwhelmingly use MySQL").
 *    These are deliberately low-weight — a real possibility, not a
 *    finding — and are skipped entirely for fully-managed SaaS platforms
 *    (Shopify, Wix, Squarespace, Webflow, Blogger) whose database is
 *    proprietary and irrelevant to report; guessing one would be
 *    fabricating confidence that doesn't exist.
 */
export function detectDatabase(signals: SiteSignals, cmsCandidates: ScoredCandidate[], backendCandidates: ScoredCandidate[]): DetectionCandidate[] {
  const html = htmlAndScriptsHaystack(signals);
  const builder = new CandidateBuilder();

  // Leaked error messages / connection strings — real, direct evidence.
  if (/you have an error in your sql syntax|mysqli_|warning: mysql_/i.test(html)) builder.add("MySQL", "leaked MySQL error string found in page content", 0.8);
  if (/\bmariadb\b/i.test(html)) builder.add("MariaDB", '"MariaDB" mentioned directly in page content', 0.5);
  if (/pg_query\(\)|org\.postgresql|postgresql query failed/i.test(html)) builder.add("PostgreSQL", "leaked PostgreSQL error/driver string found in page content", 0.8);
  if (/postgres(ql)?:\/\/[^\s"']+/i.test(html)) builder.add("PostgreSQL", "leaked postgres:// connection string found", 0.9);
  if (/mongoerror|mongooseerror/i.test(html)) builder.add("MongoDB", "leaked MongoDB/Mongoose error string found in page content", 0.8);
  if (/mongodb(\+srv)?:\/\/[^\s"']+/i.test(html)) builder.add("MongoDB", "leaked mongodb:// connection string found", 0.9);
  if (/\bSQLITE_ERROR\b|\.sqlite3?\b/i.test(html)) builder.add("SQLite", "leaked SQLite error string or .sqlite file reference found", 0.6);
  if (/redis:\/\/[^\s"']+/i.test(html)) builder.add("Redis", "leaked redis:// connection string found", 0.9);
  if (/ECONNREFUSED[^\n]*:6379/i.test(html)) builder.add("Redis", "leaked Redis connection error (default port 6379) found", 0.7);
  if (/\bORA-\d{5}\b/.test(html)) builder.add("Oracle", "leaked Oracle error code (ORA-#####) found", 0.85);
  if (/oracle\.jdbc/i.test(html)) builder.add("Oracle", "leaked Oracle JDBC driver reference found", 0.7);
  if (/unclosed quotation mark|system\.data\.sqlclient|microsoft sql server/i.test(html)) builder.add("SQL Server", "leaked SQL Server error/driver string found in page content", 0.8);

  // Ecosystem-convention inference — skipped for managed SaaS platforms
  // whose database is proprietary (Shopify, Wix, Squarespace, Webflow,
  // Blogger) since guessing there would fabricate confidence.
  const MANAGED_SAAS = new Set(["Shopify", "Wix", "Squarespace", "Webflow", "Blogger"]);
  const confidentCms = cmsCandidates.filter((c) => c.confidence >= MIN_CONFIDENCE_FOR_ECOSYSTEM_INFERENCE);
  const confidentBackend = backendCandidates.filter((c) => c.confidence >= MIN_CONFIDENCE_FOR_ECOSYSTEM_INFERENCE);
  const cmsNames = new Set(confidentCms.map((c) => c.name));
  const isManagedSaas = [...cmsNames].some((name) => MANAGED_SAAS.has(name));

  if (!isManagedSaas) {
    const MYSQL_FAMILY_CMS = ["WordPress", "WooCommerce", "Drupal", "Joomla", "Magento", "OpenCart", "PrestaShop"];
    if (MYSQL_FAMILY_CMS.some((name) => cmsNames.has(name))) {
      const matched = MYSQL_FAMILY_CMS.find((name) => cmsNames.has(name));
      builder.add("MySQL", `${matched} conventionally runs on MySQL by default`, 0.3);
      builder.add("MariaDB", `${matched} deployments commonly substitute MariaDB as a drop-in MySQL replacement`, 0.15);
    }

    const backendNames = new Set(confidentBackend.map((c) => c.name));
    if (backendNames.has("Laravel") || backendNames.has("CodeIgniter") || backendNames.has("CakePHP")) {
      builder.add("MySQL", "detected PHP framework conventionally defaults to MySQL", 0.25);
    }
    if (backendNames.has("Django")) {
      builder.add("PostgreSQL", "Django production deployments commonly use PostgreSQL", 0.3);
      builder.add("SQLite", "Django's own default for development/small deployments", 0.2);
    }
    if (backendNames.has("Ruby on Rails")) {
      builder.add("PostgreSQL", "Rails production deployments commonly use PostgreSQL", 0.3);
      builder.add("SQLite", "Rails' own default for development", 0.2);
    }
    if (backendNames.has("ASP.NET")) {
      builder.add("SQL Server", "ASP.NET conventionally pairs with SQL Server", 0.4);
    }
    if (cmsNames.has("Ghost")) {
      builder.add("SQLite", "Ghost's own default database", 0.25);
      builder.add("MySQL", "Ghost's recommended production database", 0.25);
    }
  }

  return builder.build();
}
