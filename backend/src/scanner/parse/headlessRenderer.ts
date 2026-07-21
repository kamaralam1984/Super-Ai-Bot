import { chromium, type Browser } from "playwright-core";
import * as cheerio from "cheerio";
import { logEvent } from "../../utils/logger";
import { formatError } from "../../utils/formatError";

const MIN_TEXT_LENGTH_FOR_SERVER_RENDERED = 250;

/**
 * Heuristic: a page whose visible text (scripts/styles stripped) is
 * suspiciously short but which does ship JavaScript is very likely a
 * client-rendered SPA shell (React/Vue/Angular apps that mount into an
 * empty <div id="root">) rather than a genuinely sparse page.
 */
export function isLikelyJsShell(html: string): boolean {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const hasScripts = /<script/i.test(html);
  return hasScripts && text.length < MIN_TEXT_LENGTH_FOR_SERVER_RENDERED;
}

let browserPromise: Promise<Browser> | null = null;

/**
 * playwright-core ships no browser of its own — it needs either a browser
 * downloaded via `playwright install chromium` (checked first, the normal
 * production path) or a system Chrome/Chromium, which this falls back to
 * via PLAYWRIGHT_CHROMIUM_PATH / common install locations. Documented as a
 * deployment prerequisite rather than silently failing at first use.
 */
async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  } catch (firstError) {
    const fallbackPath = process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/google-chrome-stable";
    try {
      return await chromium.launch({ headless: true, executablePath: fallbackPath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    } catch {
      throw firstError;
    }
  }
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

export async function closeHeadlessBrowser(): Promise<void> {
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    await browser?.close().catch(() => undefined);
    browserPromise = null;
  }
}

/**
 * Renders a page with a real (headless) browser and returns the resulting
 * DOM as HTML — used only when isLikelyJsShell() flags a page, since
 * spinning up a browser per page is far more expensive than a plain fetch.
 * The browser instance is a lazily-created singleton, reused across calls.
 */
export async function renderWithHeadlessBrowser(url: string, timeoutMs = 20000): Promise<string> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: "KVL-Super-AI-Chatbot-Scanner/1.0 (+read-only website scan)" });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    return await page.content();
  } catch (err) {
    logEvent({ component: "scanner-parse", message: `Headless render failed for ${url}`, status: "warn", error: formatError(err) });
    throw err;
  } finally {
    await context.close().catch(() => undefined);
  }
}
