import { describe, it, expect, vi } from "vitest";
import { runCrawlQueue } from "./crawlQueue";

const BASE_OPTIONS = { maxDepth: 5, maxPages: 100, concurrency: 3, maxRetries: 2, retryDelayMs: 1 };

describe("runCrawlQueue", () => {
  it("crawls a simple link graph in BFS order and stops at maxDepth", async () => {
    // A(depth0) -> B, C(depth1) ; B -> D(depth2) ; D -> E(depth3, excluded at maxDepth=2)
    const graph: Record<string, string[]> = {
      A: ["B", "C"],
      B: ["D"],
      C: [],
      D: ["E"],
      E: [],
    };
    const visitedOrder: string[] = [];
    const handler = vi.fn(async (url: string) => {
      visitedOrder.push(url);
      return { discoveredUrls: graph[url] ?? [] };
    });

    const summary = await runCrawlQueue(["A"], handler, () => true, { ...BASE_OPTIONS, maxDepth: 2, concurrency: 1 });

    expect(summary.visitedUrls.sort()).toEqual(["A", "B", "C", "D"]);
    expect(summary.visitedUrls).not.toContain("E");
  });

  it("respects maxPages as a hard cap", async () => {
    const handler = vi.fn(async (url: string) => ({ discoveredUrls: [`${url}-child`] }));
    const summary = await runCrawlQueue(["root"], handler, () => true, { ...BASE_OPTIONS, maxDepth: 20, maxPages: 5 });
    expect(summary.visitedUrls.length).toBeLessThanOrEqual(5);
  });

  it("retries a failing task up to maxRetries then records the failure", async () => {
    let attempts = 0;
    const handler = vi.fn(async (url: string) => {
      attempts++;
      throw new Error(`fail for ${url}`);
    });
    const summary = await runCrawlQueue(["A"], handler, () => true, { ...BASE_OPTIONS, maxRetries: 2 });
    expect(attempts).toBe(3); // initial attempt + 2 retries
    expect(summary.failedUrls).toEqual([{ url: "A", error: "fail for A" }]);
    expect(summary.visitedUrls).toEqual([]);
  });

  it("succeeds after a transient failure within the retry budget", async () => {
    let calls = 0;
    const handler = vi.fn(async () => {
      calls++;
      if (calls < 2) throw new Error("transient");
      return { discoveredUrls: [] };
    });
    const summary = await runCrawlQueue(["A"], handler, () => true, BASE_OPTIONS);
    expect(summary.visitedUrls).toEqual(["A"]);
    expect(summary.failedUrls).toEqual([]);
  });

  it("skips URLs disallowed by robots.txt without visiting them", async () => {
    const graph: Record<string, string[]> = { A: ["B", "/admin"] };
    const handler = vi.fn(async (url: string) => ({ discoveredUrls: graph[url] ?? [] }));
    const isAllowed = (url: string) => url !== "/admin";

    const summary = await runCrawlQueue(["A"], handler, isAllowed, BASE_OPTIONS);
    expect(summary.visitedUrls).toContain("B");
    expect(summary.visitedUrls).not.toContain("/admin");
    expect(summary.skippedUrls).toEqual([{ url: "/admin", reason: "disallowed by robots.txt" }]);
  });

  it("never visits the same URL twice even if linked from multiple pages", async () => {
    const graph: Record<string, string[]> = { A: ["C"], B: ["C"], C: [] };
    const handler = vi.fn(async (url: string) => ({ discoveredUrls: graph[url] ?? [] }));
    await runCrawlQueue(["A", "B"], handler, () => true, BASE_OPTIONS);
    const cCalls = handler.mock.calls.filter(([url]) => url === "C").length;
    expect(cCalls).toBe(1);
  });

  it("resolves immediately with empty seed list", async () => {
    const handler = vi.fn(async () => ({ discoveredUrls: [] }));
    const summary = await runCrawlQueue([], handler, () => true, BASE_OPTIONS);
    expect(summary.visitedUrls).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });
});
