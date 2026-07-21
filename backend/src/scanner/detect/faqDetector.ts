import * as cheerio from "cheerio";
import { findJsonLdByType, type StructuredDataResult } from "../parse/structuredData";

export interface DetectedFaq {
  question: string;
  answer: string;
  category: string | null;
  priority: number;
  source: "structured_data" | "heuristic";
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function fromStructuredData(jsonLd: Record<string, unknown>[]): DetectedFaq[] {
  const faqPages = findJsonLdByType(jsonLd, ["FAQPage"]);
  const faqs: DetectedFaq[] = [];

  for (const page of faqPages) {
    const mainEntity = page.mainEntity;
    const questions = Array.isArray(mainEntity) ? mainEntity : mainEntity ? [mainEntity] : [];
    for (const [i, q] of questions.entries()) {
      const question = q as Record<string, unknown>;
      const name = asString(question.name);
      const acceptedAnswer = question.acceptedAnswer as Record<string, unknown> | undefined;
      const answerText = asString(acceptedAnswer?.text);
      if (name && answerText) {
        faqs.push({ question: name, answer: answerText, category: null, priority: i, source: "structured_data" });
      }
    }
  }

  return faqs;
}

/**
 * Heuristic fallback covering the two most common real-world FAQ markups:
 * native <details>/<summary> accordions, and div/heading-based accordions
 * using a "faq"/"accordion" class name with a question (ending in "?" or
 * inside a heading) followed by an answer block.
 */
function fromHeuristic(html: string): DetectedFaq[] {
  const $ = cheerio.load(html);
  const faqs: DetectedFaq[] = [];
  let priority = 0;

  $("details").each((_i, el) => {
    const question = $(el).find("summary").first().text().trim();
    const answer = $(el).clone().find("summary").remove().end().text().trim();
    if (question && answer) faqs.push({ question, answer, category: null, priority: priority++, source: "heuristic" });
  });

  if (faqs.length > 0) return faqs;

  $("[class*=faq] h2, [class*=faq] h3, [class*=faq] h4, [class*=accordion] h2, [class*=accordion] h3, [class*=accordion] h4").each((_i, el) => {
    const question = $(el).text().trim();
    if (!question) return;
    const answer = $(el).nextAll("p, div").first().text().trim();
    if (question && answer) faqs.push({ question, answer, category: null, priority: priority++, source: "heuristic" });
  });

  if (faqs.length > 0) return faqs;

  // Last resort: any heading that reads like a question, anywhere on the page.
  $("h2, h3, h4").each((_i, el) => {
    const question = $(el).text().trim();
    if (!question.endsWith("?")) return;
    const answer = $(el).next("p").text().trim();
    if (answer) faqs.push({ question, answer, category: null, priority: priority++, source: "heuristic" });
  });

  return faqs;
}

export function detectFaqs(html: string, structuredData: StructuredDataResult): DetectedFaq[] {
  const structured = fromStructuredData(structuredData.jsonLd);
  if (structured.length > 0) return structured;
  return fromHeuristic(html);
}
