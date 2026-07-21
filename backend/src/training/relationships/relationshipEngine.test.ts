import { describe, it, expect } from "vitest";
import { linkToEntities, buildKnowledgeRelationships } from "./relationshipEngine";

// Unit-vector fixtures — cosineSimilarity is a raw dot product, correct
// only for pre-normalized inputs (see faqLearning.test.ts's note; real
// embeddings are generated with normalize:true).
const UNIT_X = [1, 0, 0];
const UNIT_CLOSE = [0.9, 0.4359, 0]; // cosine 0.9 vs UNIT_X
const UNIT_FAR = [0, 0, 1]; // cosine 0 vs UNIT_X

describe("linkToEntities", () => {
  const candidates = [
    { id: "p1", name: "Wireless Mouse", embedding: UNIT_CLOSE },
    { id: "p2", name: "Garden Hose", embedding: UNIT_FAR },
  ];

  it("links via embedding similarity above the threshold, without a name mention", () => {
    const result = linkToEntities("This is a great accessory for your desk setup.", UNIT_X, candidates);
    expect(result.map((r) => r.id)).toEqual(["p1"]);
    expect(result[0].reason).toContain("Semantically similar");
  });

  it("links via an explicit name mention even when embedding similarity is low", () => {
    // Both candidates here have low similarity to the source (UNIT_FAR) —
    // isolates the mention path from the similarity path, unlike the
    // shared `candidates` fixture where p1's embedding alone would qualify.
    const lowSimilarityCandidates = [
      { id: "p1", name: "Wireless Mouse", embedding: UNIT_FAR },
      { id: "p2", name: "Garden Hose", embedding: UNIT_FAR },
    ];
    const result = linkToEntities("Have you tried the Garden Hose for your backyard?", UNIT_X, lowSimilarityCandidates);
    expect(result.map((r) => r.id)).toEqual(["p2"]);
    expect(result[0].reason).toContain("explicitly mentioned");
  });

  it("gives a name-mention match at least a 0.85 base score even with weak embedding similarity", () => {
    const result = linkToEntities("Ask us about the Garden Hose warranty.", UNIT_X, candidates);
    expect(result[0].score).toBeGreaterThanOrEqual(0.85);
  });

  it("excludes candidates with neither a mention nor sufficient similarity", () => {
    const result = linkToEntities("Totally unrelated text about the weather today.", UNIT_X, [{ id: "p2", name: "Garden Hose", embedding: UNIT_FAR }]);
    expect(result).toHaveLength(0);
  });

  it("does not false-positive-match a very short name, even when the text literally contains it as a standalone word, and embedding similarity is low", () => {
    const result = linkToEntities("We will go there tomorrow to pick it up.", UNIT_X, [{ id: "x", name: "Go", embedding: UNIT_FAR }]);
    expect(result).toHaveLength(0);
  });

  it("respects the k limit", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `Product ${i}`, embedding: UNIT_CLOSE }));
    expect(linkToEntities("text", UNIT_X, many, { k: 2 })).toHaveLength(2);
  });
});

describe("buildKnowledgeRelationships", () => {
  it("emits a deterministic PRODUCT_CATEGORY edge for every categorized product", () => {
    const edges = buildKnowledgeRelationships({
      products: [{ id: "p1", name: "Wireless Mouse", category: "Electronics", embedding: UNIT_X, relatedProducts: [] }],
      services: [],
      faqs: [],
      policies: [],
      blogs: [],
      contacts: [],
      companyChunks: [],
    });
    expect(edges).toContainEqual({ sourceType: "Product", sourceId: "p1", targetType: "Category", targetId: "Electronics", relationshipType: "PRODUCT_CATEGORY", confidence: 1.0, evidence: ['Product is categorized as "Electronics"'] });
  });

  it("skips PRODUCT_CATEGORY when category is null", () => {
    const edges = buildKnowledgeRelationships({
      products: [{ id: "p1", name: "Mystery Item", category: null, embedding: UNIT_X, relatedProducts: [] }],
      services: [],
      faqs: [],
      policies: [],
      blogs: [],
      contacts: [],
      companyChunks: [],
    });
    expect(edges.filter((e) => e.relationshipType === "PRODUCT_CATEGORY")).toHaveLength(0);
  });

  it("emits SERVICE_INDUSTRY edges for every industry a service targets", () => {
    const edges = buildKnowledgeRelationships({
      products: [],
      services: [{ id: "s1", name: "Cloud Migration", industries: ["Finance", "Healthcare"], embedding: UNIT_X, relatedServices: [] }],
      faqs: [],
      policies: [],
      blogs: [],
      contacts: [],
      companyChunks: [],
    });
    const industryEdges = edges.filter((e) => e.relationshipType === "SERVICE_INDUSTRY");
    expect(industryEdges.map((e) => e.targetId).sort()).toEqual(["Finance", "Healthcare"]);
  });

  it("carries productLearning's precomputed relatedProducts through as PRODUCT_PRODUCT edges", () => {
    const edges = buildKnowledgeRelationships({
      products: [{ id: "p1", name: "A", category: null, embedding: UNIT_X, relatedProducts: [{ id: "p2", name: "B", score: 0.77, reason: "Semantically similar (0.77)" }] }],
      services: [],
      faqs: [],
      policies: [],
      blogs: [],
      contacts: [],
      companyChunks: [],
    });
    expect(edges).toContainEqual({ sourceType: "Product", sourceId: "p1", targetType: "Product", targetId: "p2", relationshipType: "PRODUCT_PRODUCT", confidence: 0.77, evidence: ["Semantically similar (0.77)"] });
  });

  it("links a FAQ to a product it explicitly mentions", () => {
    const edges = buildKnowledgeRelationships({
      products: [{ id: "p1", name: "Wireless Mouse", category: null, embedding: UNIT_FAR, relatedProducts: [] }],
      services: [],
      faqs: [{ id: "f1", question: "Does the Wireless Mouse work with Mac?", answer: "Yes, it supports both Windows and Mac.", embedding: UNIT_X }],
      policies: [],
      blogs: [],
      contacts: [],
      companyChunks: [],
    });
    const faqProductEdges = edges.filter((e) => e.relationshipType === "FAQ_PRODUCT");
    expect(faqProductEdges).toHaveLength(1);
    expect(faqProductEdges[0].targetId).toBe("p1");
  });

  it("links a policy to a service by embedding similarity", () => {
    const edges = buildKnowledgeRelationships({
      products: [],
      services: [{ id: "s1", name: "Premium Support Plan", industries: [], embedding: UNIT_CLOSE, relatedServices: [] }],
      faqs: [],
      policies: [{ id: "pol1", title: "Cancellation Policy", content: "You can cancel anytime.", embedding: UNIT_X }],
      blogs: [],
      contacts: [],
      companyChunks: [],
    });
    expect(edges.filter((e) => e.relationshipType === "POLICY_SERVICE")).toHaveLength(1);
  });

  it("links a blog post to a product it mentions", () => {
    const edges = buildKnowledgeRelationships({
      products: [{ id: "p1", name: "EcoBottle", category: null, embedding: UNIT_FAR, relatedProducts: [] }],
      services: [],
      faqs: [],
      policies: [],
      blogs: [{ id: "b1", title: "5 Ways to Reduce Plastic Waste", content: "Our EcoBottle is a great way to start.", embedding: UNIT_X }],
      contacts: [],
      companyChunks: [],
    });
    expect(edges.filter((e) => e.relationshipType === "BLOG_PRODUCT")).toHaveLength(1);
  });

  it("links a company chunk to a contact on the same page", () => {
    const edges = buildKnowledgeRelationships({
      products: [],
      services: [],
      faqs: [],
      policies: [],
      blogs: [],
      contacts: [{ id: "c1", pageId: "page-about" }],
      companyChunks: [{ id: "chunk1", pageId: "page-about" }],
    });
    expect(edges).toContainEqual({ sourceType: "Chunk", sourceId: "chunk1", targetType: "Contact", targetId: "c1", relationshipType: "COMPANY_CONTACT", confidence: 0.8, evidence: ["Company information and this contact appear on the same page"] });
  });

  it("does not link a company chunk to a contact on a different page", () => {
    const edges = buildKnowledgeRelationships({
      products: [],
      services: [],
      faqs: [],
      policies: [],
      blogs: [],
      contacts: [{ id: "c1", pageId: "page-contact" }],
      companyChunks: [{ id: "chunk1", pageId: "page-about" }],
    });
    expect(edges.filter((e) => e.relationshipType === "COMPANY_CONTACT")).toHaveLength(0);
  });

  it("does not link a company chunk with no pageId to anything", () => {
    const edges = buildKnowledgeRelationships({
      products: [],
      services: [],
      faqs: [],
      policies: [],
      blogs: [],
      contacts: [{ id: "c1", pageId: "page-about" }],
      companyChunks: [{ id: "chunk1", pageId: null }],
    });
    expect(edges.filter((e) => e.relationshipType === "COMPANY_CONTACT")).toHaveLength(0);
  });

  it("returns an empty array for completely empty input", () => {
    expect(buildKnowledgeRelationships({ products: [], services: [], faqs: [], policies: [], blogs: [], contacts: [], companyChunks: [] })).toEqual([]);
  });
});
