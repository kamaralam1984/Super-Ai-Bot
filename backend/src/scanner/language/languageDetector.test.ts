import { describe, it, expect } from "vitest";
import { detectLanguage, detectPageLanguages } from "./languageDetector";

describe("detectLanguage", () => {
  it("detects English", () => {
    const result = detectLanguage("The quick brown fox jumps over the lazy dog and runs into the deep forest at night.");
    expect(result.name).toBe("English");
  });

  it("detects Hindi", () => {
    const result = detectLanguage("यह एक हिंदी वाक्य है जो भाषा पहचान परीक्षण के लिए विशेष रूप से लिखा गया है।");
    expect(result.name).toBe("Hindi");
  });

  it("detects Arabic", () => {
    const result = detectLanguage("هذه جملة عربية مكتوبة خصيصًا لاختبار خاصية التعرف على اللغة في هذا النظام.");
    expect(result.name).toBe("Arabic");
  });

  it("detects French", () => {
    const result = detectLanguage("Ceci est une phrase française écrite spécialement pour tester la détection de la langue.");
    expect(result.name).toBe("French");
  });

  it("detects German", () => {
    const result = detectLanguage("Dies ist ein deutscher Satz, der speziell zum Testen der Spracherkennung geschrieben wurde.");
    expect(result.name).toBe("German");
  });

  it("detects Spanish", () => {
    const result = detectLanguage("Esta es una oración en español escrita especialmente para probar la detección del idioma.");
    expect(result.name).toBe("Spanish");
  });

  it("returns low confidence / undetermined for very short text", () => {
    const result = detectLanguage("hi");
    expect(result.confidence).toBe("low");
  });
});

describe("detectPageLanguages", () => {
  it("flags a single-language page as not multilingual", () => {
    const paragraphs = [
      "This website sells handmade furniture crafted by local artisans across the country.",
      "We ship worldwide and offer a thirty day return policy on every single order placed.",
    ];
    const result = detectPageLanguages(paragraphs);
    expect(result.primary.name).toBe("English");
    expect(result.isMultilingual).toBe(false);
  });

  it("flags a page mixing English and Hindi paragraphs as multilingual", () => {
    const paragraphs = [
      "Welcome to our store, where quality and craftsmanship come together beautifully every day.",
      "हमारी दुकान में आपका स्वागत है, जहाँ गुणवत्ता और शिल्प कौशल एक साथ मिलते हैं।",
    ];
    const result = detectPageLanguages(paragraphs);
    expect(result.isMultilingual).toBe(true);
    expect(result.detected).toEqual(expect.arrayContaining(["English", "Hindi"]));
  });
});
