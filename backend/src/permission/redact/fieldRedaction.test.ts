import { describe, it, expect } from "vitest";
import { redactPricingFields } from "./fieldRedaction";

describe("redactPricingFields", () => {
  it("strips a top-level price field", () => {
    expect(redactPricingFields({ name: "Widget", price: "19.99" })).toEqual({ name: "Widget" });
  });

  it("strips common price-adjacent field names case-insensitively", () => {
    const input = { Name: "Widget", Price: "19.99", DISCOUNT: "10%", currency: "USD", regular_price: "20", salePrice: "18" };
    expect(redactPricingFields(input)).toEqual({ Name: "Widget" });
  });

  it("recurses into nested objects and arrays, removing an entire price-named subtree", () => {
    const input = { products: [{ name: "A", pricing: { amount: 5, currency: "USD" } }, { name: "B", cost: 3 }] };
    expect(redactPricingFields(input)).toEqual({ products: [{ name: "A" }, { name: "B" }] });
  });

  it("still redacts a price-named key nested inside a non-price-named object", () => {
    const input = { details: { title: "Widget", cost: 3 } };
    expect(redactPricingFields(input)).toEqual({ details: { title: "Widget" } });
  });

  it("leaves non-price fields, including nested ones, untouched", () => {
    const input = { name: "Widget", description: "A useful widget", specs: { color: "red", weight: "1kg" } };
    expect(redactPricingFields(input)).toEqual(input);
  });

  it("does not choke on primitives, null, or arrays of primitives", () => {
    expect(redactPricingFields("hello")).toBe("hello");
    expect(redactPricingFields(null)).toBeNull();
    expect(redactPricingFields([1, 2, 3])).toEqual([1, 2, 3]);
  });
});
