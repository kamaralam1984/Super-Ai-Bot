import * as cheerio from "cheerio";

/** Finds RSS/Atom feed URLs declared via <link rel="alternate"> in the page head. */
export function discoverDeclaredFeeds(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const feeds = new Set<string>();

  $('link[type="application/rss+xml"], link[type="application/atom+xml"]').each((_i, el) => {
    const href = $(el).attr("href");
    if (href) {
      try {
        feeds.add(new URL(href, baseUrl).toString());
      } catch {
        // ignore malformed href
      }
    }
  });

  return [...feeds];
}

/** Common conventional feed paths to probe when none are declared in <head>. */
export function commonFeedCandidates(baseUrl: string): string[] {
  return ["/feed", "/feed.xml", "/rss.xml", "/rss", "/atom.xml", "/blog/feed"].map((path) => new URL(path, baseUrl).toString());
}
