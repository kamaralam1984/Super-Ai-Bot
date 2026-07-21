import { describe, it, expect } from "vitest";
import { extractPolicy } from "./policyExtractor";

describe("extractPolicy", () => {
  it("returns null for near-empty content", () => {
    expect(extractPolicy({ content: "too short", title: "Privacy Policy", sourceUrl: "/privacy" })).toBeNull();
  });

  it("classifies a real privacy policy correctly with a confident score", () => {
    const draft = extractPolicy({
      title: "Privacy Policy",
      sourceUrl: "https://example.com/privacy-policy",
      content:
        "This Privacy Policy describes how we collect, use, and protect your personal data. " +
        "We comply with GDPR requirements regarding data protection and your rights over personal data we hold.",
    });
    expect(draft?.policyType).toBe("PRIVACY");
    expect(draft?.confidenceScore).toBeGreaterThan(0.5);
  });

  it("classifies a refund policy correctly", () => {
    const draft = extractPolicy({
      title: "Refund Policy",
      sourceUrl: "https://example.com/refund-policy",
      content: "If you are not satisfied, you may request a refund within 30 days. Money-back guarantee applies to all refund requests.",
    });
    expect(draft?.policyType).toBe("REFUND");
  });

  it("classifies a shipping policy correctly", () => {
    const draft = extractPolicy({
      title: "Shipping & Delivery",
      sourceUrl: "https://example.com/shipping",
      content: "Our shipping policy covers delivery time, shipping charges, and delivery windows for domestic and international orders.",
    });
    expect(draft?.policyType).toBe("SHIPPING");
  });

  it("classifies a cancellation policy correctly", () => {
    const draft = extractPolicy({
      title: "Cancellation Policy",
      sourceUrl: "https://example.com/cancellation",
      content: "You may cancel your order within 24 hours. Cancellation requests after this window may not be honored.",
    });
    expect(draft?.policyType).toBe("CANCELLATION");
  });

  it("classifies a warranty policy correctly", () => {
    const draft = extractPolicy({
      title: "Warranty",
      sourceUrl: "https://example.com/warranty",
      content: "All products come with a 1-year warranty. This guarantee covers manufacturing defects only.",
    });
    expect(draft?.policyType).toBe("WARRANTY");
  });

  it("classifies terms and conditions correctly", () => {
    const draft = extractPolicy({
      title: "Terms and Conditions",
      sourceUrl: "https://example.com/terms",
      content: "These terms and conditions govern your use of this website. By accessing this site, you agree to these terms of service.",
    });
    expect(draft?.policyType).toBe("TERMS");
  });

  it("classifies a cookies policy correctly", () => {
    const draft = extractPolicy({
      title: "Cookie Policy",
      sourceUrl: "https://example.com/cookies",
      content: "This cookie policy explains how we use cookies on our website and how you can manage cookie preferences.",
    });
    expect(draft?.policyType).toBe("COOKIES");
  });

  it("falls back to OTHER for policy-like content that matches no specific sub-type", () => {
    const draft = extractPolicy({
      title: "Legal Notice",
      sourceUrl: "https://example.com/legal",
      content: "This page contains general legal information about the company and its operations, without matching any specific policy sub-type keywords.",
    });
    expect(draft?.policyType).toBe("OTHER");
  });

  it("gives a title match more weight than a content-only match", () => {
    const titleMatch = extractPolicy({ title: "Refund Policy", sourceUrl: "/x", content: "Please read this page carefully before proceeding with your purchase today." });
    const contentOnly = extractPolicy({ title: "Legal", sourceUrl: "/x", content: "Please read this page carefully. A refund may be issued in some cases at our discretion." });
    expect(titleMatch!.confidenceScore).toBeGreaterThan(contentOnly!.confidenceScore);
  });

  it("caps confidence at 1", () => {
    const draft = extractPolicy({
      title: "Privacy Policy Privacy Privacy",
      sourceUrl: "https://example.com/privacy-policy",
      content: "privacy personal data gdpr data protection privacy personal data gdpr data protection privacy personal data gdpr",
    });
    expect(draft!.confidenceScore).toBeLessThanOrEqual(1);
  });
});
