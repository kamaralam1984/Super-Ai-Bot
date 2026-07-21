import crypto from "node:crypto";

export type DuplicateCategory = "page" | "paragraph" | "image" | "document" | "heading";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function hashOf(text: string): string {
  return crypto.createHash("sha256").update(normalize(text)).digest("hex");
}

/**
 * Cross-page duplicate tracker for a single crawl job. Stateful by design —
 * "is this a duplicate" only means something relative to everything already
 * seen in this crawl (a boilerplate paragraph on every page is only a
 * duplicate the 2nd+ time it's seen, not standalone). One instance per
 * crawl job, shared across all pages/documents it processes.
 */
export class DuplicateTracker {
  private seen = new Map<DuplicateCategory, Map<string, string>>(); // category -> hash -> first-seen source
  private duplicateHits = new Map<DuplicateCategory, number>(); // category -> count of repeat occurrences

  private categoryMap(category: DuplicateCategory): Map<string, string> {
    let map = this.seen.get(category);
    if (!map) {
      map = new Map();
      this.seen.set(category, map);
    }
    return map;
  }

  /** Records `content` under `category`; returns the source it duplicates, or null if it's new. */
  check(category: DuplicateCategory, content: string, source: string): string | null {
    if (!content.trim()) return null;
    const map = this.categoryMap(category);
    const hash = hashOf(content);
    const existing = map.get(hash);
    if (existing) {
      this.duplicateHits.set(category, (this.duplicateHits.get(category) ?? 0) + 1);
      return existing;
    }
    map.set(hash, source);
    return null;
  }

  /** Filters a list down to first-occurrence-only items, tagging each with whether it was a duplicate. */
  filterUnique<T>(category: DuplicateCategory, items: T[], toText: (item: T) => string, toSource: (item: T) => string): { unique: T[]; duplicateCount: number } {
    let duplicateCount = 0;
    const unique: T[] = [];
    for (const item of items) {
      const duplicateOf = this.check(category, toText(item), toSource(item));
      if (duplicateOf) duplicateCount++;
      else unique.push(item);
    }
    return { unique, duplicateCount };
  }

  /** Count of distinct (unique) items recorded per category — NOT how many were duplicates. See duplicateStats() for that. */
  stats(): Record<DuplicateCategory, number> {
    const result = {} as Record<DuplicateCategory, number>;
    for (const [category, map] of this.seen) result[category] = map.size;
    return result;
  }

  /** Count of repeat (duplicate) occurrences per category — what a crawl report should show as "excluded from the knowledge base". */
  duplicateStats(): Record<DuplicateCategory, number> {
    return Object.fromEntries(this.duplicateHits) as Record<DuplicateCategory, number>;
  }
}

export function hashContent(text: string): string {
  return hashOf(text);
}
