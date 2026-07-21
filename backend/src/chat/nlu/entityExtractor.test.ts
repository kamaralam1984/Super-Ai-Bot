import { describe, it, expect } from "vitest";
import { extractEntities } from "./entityExtractor";

describe("extractEntities", () => {
  it("extracts an email address, lowercased", () => {
    const entities = extractEntities("You can reach me at John.Doe@Example.com");
    expect(entities).toContainEqual({ type: "email", value: "john.doe@example.com", raw: "John.Doe@Example.com" });
  });

  it("extracts a URL", () => {
    const entities = extractEntities("See https://example.com/products/123 for details");
    expect(entities.some((e) => e.type === "url" && e.value === "https://example.com/products/123")).toBe(true);
  });

  it("extracts an order id from a #-prefixed mention, preserving letters (not digits-only)", () => {
    const entities = extractEntities("What's the status of order #A12345?");
    expect(entities).toContainEqual(expect.objectContaining({ type: "order_id", value: "A12345" }));
  });

  it("extracts a money amount with a currency symbol", () => {
    const entities = extractEntities("Is this under $49.99?");
    expect(entities.some((e) => e.type === "money" && e.value.includes("49.99"))).toBe(true);
  });

  it("extracts a date-like mention", () => {
    const entities = extractEntities("Can I get this delivered by tomorrow?");
    expect(entities.some((e) => e.type === "date" && e.value === "tomorrow")).toBe(true);
  });

  it("extracts a phone number with 7+ digits", () => {
    const entities = extractEntities("Call me at 555-123-4567");
    expect(entities.some((e) => e.type === "phone" && e.value === "5551234567")).toBe(true);
  });

  it("does not extract a short digit run as a phone number", () => {
    const entities = extractEntities("Only 3 left in stock");
    expect(entities.some((e) => e.type === "phone")).toBe(false);
  });

  it("matches known product names case-insensitively", () => {
    const entities = extractEntities("Do you have the Wireless Mouse Pro in stock?", { knownProductNames: ["Wireless Mouse Pro", "USB-C Hub"] });
    expect(entities).toContainEqual({ type: "product_mention", value: "Wireless Mouse Pro", raw: "Wireless Mouse Pro" });
    expect(entities.some((e) => e.type === "product_mention" && e.value === "USB-C Hub")).toBe(false);
  });

  it("matches known service names case-insensitively", () => {
    const entities = extractEntities("I'd like to book a Home Consultation", { knownServiceNames: ["home consultation"] });
    expect(entities).toContainEqual({ type: "service_mention", value: "home consultation", raw: "home consultation" });
  });

  it("returns an empty array for text with no entities", () => {
    expect(extractEntities("Hello there, how are you?")).toEqual([]);
  });

  it("extracts multiple distinct entity types from one message", () => {
    const entities = extractEntities("Email me at ops@example.com about order #98765, budget is $200");
    const types = entities.map((e) => e.type).sort();
    expect(types).toEqual(["email", "money", "order_id"]);
  });
});
