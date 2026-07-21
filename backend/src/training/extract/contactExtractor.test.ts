import { describe, it, expect } from "vitest";
import { extractContact } from "./contactExtractor";
import type { ContactInfo } from "../../scanner/parse/contactExtractor";

function contactInfo(overrides: Partial<ContactInfo> = {}): ContactInfo {
  return {
    phones: [],
    emails: [],
    addresses: [],
    businessHours: [],
    mapsLinks: [],
    whatsappLinks: [],
    socialLinks: [],
    ...overrides,
  };
}

describe("extractContact", () => {
  it("returns null when contactInfo is null", () => {
    expect(extractContact({ title: "Contact Us", contactInfo: null })).toBeNull();
  });

  it("returns null when contactInfo has nothing usable", () => {
    expect(extractContact({ title: "Contact Us", contactInfo: contactInfo() })).toBeNull();
  });

  it("extracts phones/emails/addresses/hours/mapsLinks into the draft, mapping businessHours -> hours", () => {
    const draft = extractContact({
      title: "Contact Us",
      contactInfo: contactInfo({
        phones: ["+1 555 123 4567"],
        emails: ["hello@example.com"],
        addresses: ["123 Main St, Springfield"],
        businessHours: ["Mon-Fri 9am-5pm"],
        mapsLinks: ["https://maps.google.com/?q=123+Main+St"],
      }),
    });
    expect(draft).toEqual({
      contactType: "GENERAL",
      branch: null,
      department: null,
      phones: ["+1 555 123 4567"],
      emails: ["hello@example.com"],
      addresses: ["123 Main St, Springfield"],
      mapsLinks: ["https://maps.google.com/?q=123+Main+St"],
      hours: ["Mon-Fri 9am-5pm"],
      source: "heuristic",
    });
  });

  it("classifies contactType as SUPPORT from title keywords", () => {
    const draft = extractContact({ title: "Customer Support", contactInfo: contactInfo({ emails: ["support@example.com"] }) });
    expect(draft?.contactType).toBe("SUPPORT");
  });

  it("classifies contactType as SALES from title keywords", () => {
    const draft = extractContact({ title: "Get a Quote — Sales Team", contactInfo: contactInfo({ emails: ["sales@example.com"] }) });
    expect(draft?.contactType).toBe("SALES");
  });

  it("defaults contactType to GENERAL when no keyword matches", () => {
    const draft = extractContact({ title: "Reach Us", contactInfo: contactInfo({ emails: ["hello@example.com"] }) });
    expect(draft?.contactType).toBe("GENERAL");
  });

  it("infers a branch name from an 'Office' title pattern", () => {
    const draft = extractContact({ title: "Mumbai Office", contactInfo: contactInfo({ phones: ["123"] }) });
    expect(draft?.branch).toBe("Mumbai");
  });

  it("infers a branch name from a 'Contact Us - City' title pattern", () => {
    const draft = extractContact({ title: "Contact Us - Bangalore", contactInfo: contactInfo({ phones: ["123"] }) });
    expect(draft?.branch).toBe("Bangalore");
  });

  it("leaves branch null when the title has no recognizable location pattern (honest, not guessed)", () => {
    const draft = extractContact({ title: "Get in Touch", contactInfo: contactInfo({ phones: ["123"] }) });
    expect(draft?.branch).toBeNull();
  });

  it("infers department from title keywords", () => {
    expect(extractContact({ title: "HR Department", contactInfo: contactInfo({ emails: ["hr@example.com"] }) })?.department).toBe("Human Resources");
    expect(extractContact({ title: "Billing Inquiries", contactInfo: contactInfo({ emails: ["billing@example.com"] }) })?.department).toBe("Billing");
  });

  it("handles a null title without throwing", () => {
    const draft = extractContact({ title: null, contactInfo: contactInfo({ emails: ["hello@example.com"] }) });
    expect(draft?.contactType).toBe("GENERAL");
    expect(draft?.branch).toBeNull();
  });
});
