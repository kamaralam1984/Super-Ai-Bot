import { describe, it, expect, afterAll } from "vitest";
import { chromium } from "playwright-core";
import { runOcr, closeOcrEngine, resolveOcrLanguage } from "./ocrEngine";

describe("resolveOcrLanguage", () => {
  it("combines a recognized language with English", () => {
    expect(resolveOcrLanguage("Hindi")).toBe("hin+eng");
    expect(resolveOcrLanguage("Arabic")).toBe("ara+eng");
  });

  it("returns English alone when the hint is already English", () => {
    expect(resolveOcrLanguage("English")).toBe("eng");
  });

  it("falls back to English alone when the hint is missing or unrecognized", () => {
    expect(resolveOcrLanguage(null)).toBe("eng");
    expect(resolveOcrLanguage(undefined)).toBe("eng");
    expect(resolveOcrLanguage("Klingon")).toBe("eng");
  });
});

async function renderTextToPng(text: string): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 200 } });
    await page.setContent(
      `<html><body style="margin:0;padding:20px;background:white;"><div style="font-size:36px;font-family:'Noto Sans Devanagari','Noto Sans',sans-serif;color:black;">${text}</div></body></html>`
    );
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

describe("runOcr (real Tesseract recognition against real Chromium-rendered images)", () => {
  afterAll(async () => {
    await closeOcrEngine();
  });

  it("reads real English text from a rendered image", async () => {
    const image = await renderTextToPng("Welcome to our store, contact support today");
    const result = await runOcr(image);
    expect(result.text.toLowerCase()).toContain("welcome");
    expect(result.language).toBe("eng");
    expect(result.confidence).toBeGreaterThan(60);
  }, 30000);

  it("reads real Hindi (Devanagari) text once given a Hindi language hint", async () => {
    const image = await renderTextToPng("नमस्ते, हमारी दुकान में आपका स्वागत है");
    const result = await runOcr(image, "Hindi");
    expect(result.text).toContain("स्वागत");
    expect(result.language).toBe("hin+eng");
    expect(result.confidence).toBeGreaterThan(60);
  }, 30000);

  it("fails to read Hindi text when no language hint is given (English-only worker)", async () => {
    const image = await renderTextToPng("नमस्ते, हमारी दुकान में आपका स्वागत है");
    const result = await runOcr(image);
    expect(result.text).not.toContain("स्वागत");
  }, 30000);
});
