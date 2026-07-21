import { describe, it, expect } from "vitest";
import { looksLikeHinglish, detectChunkLanguage, isSupportedLanguage, SUPPORTED_LANGUAGES } from "./multiLanguage";

describe("looksLikeHinglish", () => {
  it("returns false for empty text", () => {
    expect(looksLikeHinglish("")).toBe(false);
  });

  it("returns false for genuine English prose", () => {
    expect(looksLikeHinglish("Our support team is available around the clock to help with any questions you may have.")).toBe(false);
    expect(looksLikeHinglish("Please contact us if you need further assistance with your recent order.")).toBe(false);
  });

  it("does not false-positive on a single incidental marker word in otherwise English text", () => {
    // "hai" isn't an English word, but this guards against a stray one-off match in a long sentence.
    expect(looksLikeHinglish("The word hai does not usually appear in English text at all, but one instance alone should not flip the whole classification.")).toBe(false);
  });

  it("detects real romanized Hindi (Hinglish) sentences", () => {
    expect(looksLikeHinglish("bhai mujhe iska price kya hai batao")).toBe(true);
    expect(looksLikeHinglish("aap kaise ho, sab theek hai na")).toBe(true);
    expect(looksLikeHinglish("isko 100% kro prompt ke hisab se")).toBe(true);
  });

  it("detects mixed Hindi-English (code-switched) sentences", () => {
    expect(looksLikeHinglish("bhai web site ka design pure ai type ka lag rha hai isko full human type ka kro")).toBe(true);
  });
});

describe("detectChunkLanguage", () => {
  it("detects genuine English as English, not Hinglish", () => {
    const result = detectChunkLanguage("Welcome to our online store. We offer fast shipping and easy returns on every order.");
    expect(result.name).toBe("English");
    expect(result.isHinglish).toBe(false);
  });

  it("detects genuine Devanagari-script Hindi as Hindi, not Hinglish", () => {
    const result = detectChunkLanguage("नमस्ते, हमारी दुकान में आपका स्वागत है। हम सोमवार से शुक्रवार तक खुले रहते हैं और आपकी हर संभव मदद करने की कोशिश करते हैं।");
    expect(result.name).toBe("Hindi");
    expect(result.isHinglish).toBe(false);
  });

  it("detects romanized Hindi as Hinglish", () => {
    const result = detectChunkLanguage("bhai mujhe iska price kya hai, thoda jaldi batao yaar, kal tak chahiye");
    expect(result.name).toBe("Hinglish");
    expect(result.code).toBe("hin-Latn");
    expect(result.isHinglish).toBe(true);
  });

  it("detects other supported languages via the underlying franc-based detector", () => {
    const french = detectChunkLanguage("Bonjour, notre magasin est ouvert du lundi au vendredi de neuf heures à dix-huit heures.");
    expect(french.name).toBe("French");
  });

  it("falls back to English for short, low-signal category-list fragments franc misreads as an unsupported language (real bug found against a live crawl of books.toscrape.com)", () => {
    // franc reads this short bulleted nav-list fragment as "sot" (Southern
    // Sotho) — nowhere close to a real detection, just noise from too
    // little genuine linguistic signal in short, repetitive list text.
    const result = detectChunkLanguage("- Home\n- Books\n- Romance");
    expect(result.name).toBe("English");
  });

  it("falls back to English for currency/digit-dominated content misread as an unsupported language (real bug: a repeated price list read as Slovenian)", () => {
    const result = detectChunkLanguage("£37.97 In stock £21.87 In stock £30.03 In stock £25.27 In stock £51.77 In stock");
    expect(result.name).toBe("English");
  });
});

describe("isSupportedLanguage / SUPPORTED_LANGUAGES", () => {
  it("includes Hinglish alongside the other spec-listed languages", () => {
    expect(SUPPORTED_LANGUAGES).toContain("Hinglish");
    expect(SUPPORTED_LANGUAGES).toContain("English");
    expect(SUPPORTED_LANGUAGES).toContain("Hindi");
    expect(SUPPORTED_LANGUAGES).toContain("Urdu");
    expect(SUPPORTED_LANGUAGES).toContain("Arabic");
    expect(SUPPORTED_LANGUAGES).toContain("French");
    expect(SUPPORTED_LANGUAGES).toContain("German");
    expect(SUPPORTED_LANGUAGES).toContain("Spanish");
  });

  it("correctly type-guards a supported vs unsupported language name", () => {
    expect(isSupportedLanguage("Hinglish")).toBe(true);
    expect(isSupportedLanguage("Klingon")).toBe(false);
  });
});
