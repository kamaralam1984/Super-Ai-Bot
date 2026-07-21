import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VectorStore } from "./vectorStore";
import { embedText } from "../embed/embeddings";

let tmpDir: string;
let store: VectorStore;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vector-store-test-"));
  store = new VectorStore(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("VectorStore (real hnswlib-node index on disk)", () => {
  it("returns null stats and empty search results for a namespace that doesn't exist yet", () => {
    expect(store.stats("nope")).toBeNull();
    expect(store.search("nope", [1, 0, 0], 5)).toEqual([]);
  });

  it("upserts vectors and finds the true nearest neighbor", () => {
    store.upsertMany("ns1", [
      { chunkId: "a", vector: [1, 0, 0] },
      { chunkId: "b", vector: [0, 1, 0] },
      { chunkId: "c", vector: [0, 0, 1] },
    ]);
    const results = store.search("ns1", [0.9, 0.1, 0], 1);
    expect(results).toHaveLength(1);
    expect(results[0].chunkId).toBe("a");
    expect(results[0].score).toBeGreaterThan(0.9);
  });

  it("keeps namespaces isolated — same chunkId in two namespaces doesn't collide", () => {
    store.upsertMany("ns-a", [{ chunkId: "shared-id", vector: [1, 0] }]);
    store.upsertMany("ns-b", [{ chunkId: "shared-id", vector: [0, 1] }]);

    const resultA = store.search("ns-a", [1, 0], 1);
    const resultB = store.search("ns-b", [1, 0], 1);
    expect(resultA[0].score).toBeGreaterThan(resultB[0].score);
  });

  it("persists across a fresh VectorStore instance pointed at the same directory (simulates a process restart)", () => {
    store.upsertMany("durable", [
      { chunkId: "x", vector: [1, 0, 0, 0] },
      { chunkId: "y", vector: [0, 1, 0, 0] },
    ]);

    const reopened = new VectorStore(tmpDir);
    const stats = reopened.stats("durable");
    expect(stats).toEqual({ namespace: "durable", vectorCount: 2, dimensions: 4, maxElements: expect.any(Number) });

    const results = reopened.search("durable", [1, 0, 0, 0], 1);
    expect(results[0].chunkId).toBe("x");
  });

  it("replaces a chunk's vector on re-upsert rather than duplicating it", () => {
    store.upsertMany("ns", [{ chunkId: "a", vector: [1, 0] }]);
    expect(store.search("ns", [1, 0], 5)[0].chunkId).toBe("a");

    store.upsertMany("ns", [{ chunkId: "a", vector: [0, 1] }]);
    const results = store.search("ns", [0, 1], 5);
    expect(results).toHaveLength(1); // not two "a" entries
    expect(results[0].chunkId).toBe("a");
    expect(results[0].score).toBeGreaterThan(0.99);

    const staleQuery = store.search("ns", [1, 0], 5);
    expect(staleQuery[0].score).toBeLessThan(0.5); // no longer close to the old vector
  });

  it("removes a chunk so it stops appearing in search results", () => {
    store.upsertMany("ns", [
      { chunkId: "keep", vector: [1, 0] },
      { chunkId: "drop", vector: [0, 1] },
    ]);
    const removed = store.remove("ns", "drop");
    expect(removed).toBe(true);

    const results = store.search("ns", [0, 1], 5);
    expect(results.map((r) => r.chunkId)).not.toContain("drop");
  });

  it("remove() returns false for an unknown chunk or namespace", () => {
    expect(store.remove("ns", "missing")).toBe(false);
    expect(store.remove("no-such-namespace", "missing")).toBe(false);
  });

  it("filterChunkIds restricts search to the given set", () => {
    store.upsertMany("ns", [
      { chunkId: "a", vector: [1, 0] },
      { chunkId: "b", vector: [0.9, 0.1] },
      { chunkId: "c", vector: [0.8, 0.2] },
    ]);
    const results = store.search("ns", [1, 0], 5, { filterChunkIds: new Set(["b", "c"]) });
    expect(results.map((r) => r.chunkId).sort()).toEqual(["b", "c"]);
  });

  it("grows capacity automatically past the initial allocation", () => {
    const items = Array.from({ length: 1500 }, (_, i) => ({ chunkId: `item-${i}`, vector: [Math.random(), Math.random()] }));
    store.upsertMany("big", items);
    expect(store.stats("big")?.vectorCount).toBe(1500);
  });

  it("rebuild() replaces the entire namespace contents", () => {
    store.upsertMany("ns", [{ chunkId: "old", vector: [1, 0] }]);
    store.rebuild("ns", [{ chunkId: "new", vector: [0, 1] }]);

    const results = store.search("ns", [0, 1], 5);
    expect(results.map((r) => r.chunkId)).toEqual(["new"]);
  });

  it("rebuild() with no items deletes the namespace entirely", () => {
    store.upsertMany("ns", [{ chunkId: "a", vector: [1, 0] }]);
    store.rebuild("ns", []);
    expect(store.stats("ns")).toBeNull();
  });

  it("backs up and restores a namespace", () => {
    store.upsertMany("ns", [{ chunkId: "a", vector: [1, 0] }]);
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "vector-store-backup-"));
    const result = store.backup("ns", backupDir);
    expect(result).not.toBeNull();

    store.deleteNamespace("ns");
    expect(store.stats("ns")).toBeNull();

    store.restore("ns", backupDir);
    const stats = store.stats("ns");
    expect(stats?.vectorCount).toBe(1);
    expect(store.search("ns", [1, 0], 1)[0].chunkId).toBe("a");

    fs.rmSync(backupDir, { recursive: true, force: true });
  });

  it("restore() throws when no backup exists for the namespace", () => {
    expect(() => store.restore("ns", tmpDir)).toThrow();
  });

  it("rejects a vector whose dimensionality doesn't match the namespace", () => {
    store.upsertMany("ns", [{ chunkId: "a", vector: [1, 0, 0] }]);
    expect(() => store.upsertMany("ns", [{ chunkId: "b", vector: [1, 0] }])).toThrow();
  });
});

describe("VectorStore end-to-end with real embeddings", () => {
  it("finds the semantically relevant chunk for a real query using real local embeddings", async () => {
    const corpus = [
      { chunkId: "hours", text: "Our store is open Monday to Friday, 9am to 6pm." },
      { chunkId: "returns", text: "You can return any item within 30 days for a full refund." },
      { chunkId: "shipping", text: "We ship internationally and delivery usually takes 5-7 business days." },
    ];

    const vectors = await Promise.all(corpus.map((c) => embedText(c.text)));
    store.upsertMany(
      "real-ns",
      corpus.map((c, i) => ({ chunkId: c.chunkId, vector: vectors[i] }))
    );

    const queryVector = await embedText("What time do you close?");
    const results = store.search("real-ns", queryVector, 3);

    expect(results[0].chunkId).toBe("hours");
  }, 30000);
});
