import { describe, it, expect } from "vitest";
import { detectContactChanges, detectFaqChanges, detectPolicyChanges, detectProductChanges, detectServiceChanges } from "./entityChangeDetector";
import type { ContactSnapshot, FaqSnapshot, PolicySnapshot, ProductSnapshot, ServiceSnapshot } from "./entityChangeDetector";

function product(overrides: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return { name: "Widget Pro", sku: "WID-1", price: "49.99", currency: "USD", discount: null, stockStatus: "in_stock", description: "A fine widget.", ...overrides };
}

describe("detectProductChanges", () => {
  it("detects a new product", () => {
    const summary = detectProductChanges([], [product()]);
    expect(summary).toMatchObject({ added: 1, removed: 0, updated: 0 });
    expect(summary.changes[0]).toMatchObject({ identity: "Widget Pro", changeType: "added" });
  });

  it("detects a removed product", () => {
    const summary = detectProductChanges([product()], []);
    expect(summary).toMatchObject({ added: 0, removed: 1, updated: 0 });
  });

  it("does not report an unchanged product", () => {
    const summary = detectProductChanges([product()], [product()]);
    expect(summary).toMatchObject({ added: 0, removed: 0, updated: 0 });
    expect(summary.changes).toEqual([]);
  });

  it("detects a price change and flags it as significant", () => {
    const summary = detectProductChanges([product({ price: "49.99" })], [product({ price: "39.99" })]);
    expect(summary.updated).toBe(1);
    const change = summary.changes[0];
    expect(change.fieldChanges).toContainEqual({ field: "price", oldValue: "49.99", newValue: "39.99", significant: true });
  });

  it("detects a stock status change (inventory) as significant", () => {
    const summary = detectProductChanges([product({ stockStatus: "in_stock" })], [product({ stockStatus: "out_of_stock" })]);
    const change = summary.changes.find((c) => c.identity === "Widget Pro")!;
    expect(change.fieldChanges.find((f) => f.field === "stockStatus")).toEqual({ field: "stockStatus", oldValue: "in_stock", newValue: "out_of_stock", significant: true });
  });

  it("detects a description-only change as not significant", () => {
    const summary = detectProductChanges([product({ description: "Old copy." })], [product({ description: "New copy." })]);
    const change = summary.changes[0];
    expect(change.fieldChanges).toEqual([{ field: "description", oldValue: "Old copy.", newValue: "New copy.", significant: false }]);
  });

  it("matches by SKU even if the name changes (a rename, not a delete+add)", () => {
    const summary = detectProductChanges([product({ name: "Widget Pro", sku: "WID-1" })], [product({ name: "Widget Pro Max", sku: "WID-1" })]);
    expect(summary.added).toBe(0);
    expect(summary.removed).toBe(0);
    // name isn't a diffed field today, so a pure rename with everything else identical produces no field changes — documented behavior, not a bug: SKU is the stable identity precisely so a rename doesn't look like delete+add.
  });

  it("falls back to matching by name when no SKU is present", () => {
    const summary = detectProductChanges([product({ sku: null, price: "10" })], [product({ sku: null, price: "12" })]);
    expect(summary.updated).toBe(1);
  });

  it("ranks significant changes before non-significant ones", () => {
    const oldProducts = [product({ name: "A", sku: "A", price: "10" }), product({ name: "B", sku: "B", description: "old" })];
    const newProducts = [product({ name: "A", sku: "A", price: "10", description: "new" }), product({ name: "B", sku: "B", price: "20" })];
    const summary = detectProductChanges(oldProducts, newProducts);
    expect(summary.changes[0].fieldChanges.some((f) => f.significant)).toBe(true);
  });

  it("sets truncated:true and caps the list when there are more than 50 changes", () => {
    const oldProducts = Array.from({ length: 60 }, (_, i) => product({ name: `P${i}`, sku: `SKU${i}`, price: "10" }));
    const newProducts = Array.from({ length: 60 }, (_, i) => product({ name: `P${i}`, sku: `SKU${i}`, price: "20" }));
    const summary = detectProductChanges(oldProducts, newProducts);
    expect(summary.updated).toBe(60);
    expect(summary.changes).toHaveLength(50);
    expect(summary.truncated).toBe(true);
  });
});

describe("detectServiceChanges", () => {
  function service(overrides: Partial<ServiceSnapshot> = {}): ServiceSnapshot {
    return { name: "Consulting", pricing: "$100/hr", description: "Expert advice.", ...overrides };
  }

  it("detects a pricing change as significant", () => {
    const summary = detectServiceChanges([service({ pricing: "$100/hr" })], [service({ pricing: "$150/hr" })]);
    expect(summary.changes[0].fieldChanges[0]).toMatchObject({ field: "pricing", significant: true });
  });

  it("matches services by name", () => {
    const summary = detectServiceChanges([service()], [service()]);
    expect(summary.updated).toBe(0);
  });
});

describe("detectFaqChanges", () => {
  function faq(overrides: Partial<FaqSnapshot> = {}): FaqSnapshot {
    return { question: "What are your hours?", answer: "9-5 Mon-Fri", ...overrides };
  }

  it("detects a new FAQ", () => {
    expect(detectFaqChanges([], [faq()]).added).toBe(1);
  });

  it("detects an updated answer for the same question", () => {
    const summary = detectFaqChanges([faq({ answer: "9-5" })], [faq({ answer: "24/7" })]);
    expect(summary.updated).toBe(1);
    expect(summary.changes[0].fieldChanges[0]).toMatchObject({ field: "answer", oldValue: "9-5", newValue: "24/7" });
  });

  it("matches questions case-insensitively and trims whitespace", () => {
    const summary = detectFaqChanges([faq({ question: "What are your hours?" })], [faq({ question: "  WHAT ARE YOUR HOURS?  " })]);
    expect(summary.added).toBe(0);
    expect(summary.removed).toBe(0);
  });
});

describe("detectPolicyChanges", () => {
  function policy(overrides: Partial<PolicySnapshot> = {}): PolicySnapshot {
    return { policyType: "SHIPPING", title: "Shipping Policy", content: "Ships in 3-5 days.", ...overrides };
  }

  it("matches policies by policyType, detecting a content update", () => {
    const summary = detectPolicyChanges([policy({ content: "Ships in 3-5 days." })], [policy({ content: "Ships in 1-2 days." })]);
    expect(summary.updated).toBe(1);
    expect(summary.changes[0].identity).toBe("SHIPPING");
  });

  it("detects a new policy type appearing", () => {
    expect(detectPolicyChanges([], [policy({ policyType: "REFUND" })]).added).toBe(1);
  });
});

describe("detectContactChanges", () => {
  function contact(overrides: Partial<ContactSnapshot> = {}): ContactSnapshot {
    return { contactType: "SUPPORT", branch: null, phones: ["555-1234"], emails: ["support@example.com"], addresses: [], ...overrides };
  }

  it("treats any phone/email/address change as significant", () => {
    const summary = detectContactChanges([contact({ phones: ["555-1234"] })], [contact({ phones: ["555-9999"] })]);
    expect(summary.changes[0].fieldChanges[0]).toMatchObject({ field: "phones", significant: true });
  });

  it("distinguishes branches with the same contactType", () => {
    const summary = detectContactChanges([contact({ branch: "Mumbai" })], [contact({ branch: "Mumbai" }), contact({ branch: "Delhi" })]);
    expect(summary.added).toBe(1);
    expect(summary.changes.find((c) => c.changeType === "added")?.identity).toBe("SUPPORT (Delhi)");
  });
});
