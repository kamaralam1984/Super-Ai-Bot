import { describe, it, expect } from "vitest";
import { splitIntoSentences } from "./sentenceSplitter";

describe("splitIntoSentences", () => {
  it("returns an empty array for empty input", () => {
    expect(splitIntoSentences("")).toEqual([]);
    expect(splitIntoSentences("   ")).toEqual([]);
  });

  it("splits plain multi-sentence text", () => {
    expect(splitIntoSentences("Hello world. How are you? I am fine!")).toEqual(["Hello world.", "How are you?", "I am fine!"]);
  });

  it("does not split on common abbreviations", () => {
    const text = "This is Dr. Smith speaking. He works at Acme Inc. in Boston.";
    expect(splitIntoSentences(text)).toEqual(["This is Dr. Smith speaking.", "He works at Acme Inc. in Boston."]);
  });

  it("does not split on decimal numbers", () => {
    expect(splitIntoSentences("The price is 3.14 dollars. Thats odd.")).toEqual(["The price is 3.14 dollars.", "Thats odd."]);
  });

  it("does not split on initials", () => {
    expect(splitIntoSentences("J. K. Rowling wrote this. It is famous.")).toEqual(["J. K. Rowling wrote this.", "It is famous."]);
  });

  it("keeps a trailing closing quote attached to its sentence", () => {
    expect(splitIntoSentences('He said "Hello." Then he left.')).toEqual(['He said "Hello."', "Then he left."]);
  });

  it("never drops any characters — sentences rejoin to the normalized input", () => {
    const text = "First sentence here. Second one, with a comma. Third and final sentence!";
    const sentences = splitIntoSentences(text);
    expect(sentences.join(" ")).toBe(text);
  });

  it("treats a single sentence with no terminal punctuation as one sentence", () => {
    expect(splitIntoSentences("just some words with no period")).toEqual(["just some words with no period"]);
  });
});
