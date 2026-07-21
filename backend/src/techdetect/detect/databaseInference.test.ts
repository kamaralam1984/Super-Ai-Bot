import { describe, it, expect } from "vitest";
import { detectDatabase } from "./databaseInference";
import { buildSignals } from "../testFixtures";
import type { ScoredCandidate } from "../types";

function namesOf(result: ReturnType<typeof detectDatabase>): string[] {
  return result.map((c) => c.name);
}

function confident(name: string): ScoredCandidate {
  return { name, confidence: 0.9, evidence: [] };
}

function weak(name: string): ScoredCandidate {
  return { name, confidence: 0.2, evidence: [] };
}

describe("detectDatabase — leaked artifacts (direct evidence)", () => {
  it("detects MySQL from a leaked SQL syntax error", () => {
    const signals = buildSignals({ html: "Warning: You have an error in your SQL syntax; check the manual" });
    expect(namesOf(detectDatabase(signals, [], []))).toContain("MySQL");
  });

  it("detects PostgreSQL from a leaked connection string", () => {
    const signals = buildSignals({ html: 'const url = "postgres://user:pass@db.example.com:5432/app";' });
    const result = detectDatabase(signals, [], []);
    expect(namesOf(result)).toContain("PostgreSQL");
    expect(result.find((c) => c.name === "PostgreSQL")!.matches[0].weight).toBeGreaterThan(0.7);
  });

  it("detects MongoDB from a leaked connection string", () => {
    const signals = buildSignals({ html: 'MONGO_URI=mongodb+srv://user:pass@cluster0.mongodb.net/app' });
    expect(namesOf(detectDatabase(signals, [], []))).toContain("MongoDB");
  });

  it("detects Redis from a leaked connection refused error", () => {
    const signals = buildSignals({ html: "Error: connect ECONNREFUSED 127.0.0.1:6379" });
    expect(namesOf(detectDatabase(signals, [], []))).toContain("Redis");
  });

  it("detects Oracle from a leaked ORA-##### error code", () => {
    const signals = buildSignals({ html: "ORA-00942: table or view does not exist" });
    expect(namesOf(detectDatabase(signals, [], []))).toContain("Oracle");
  });

  it("detects SQL Server from a leaked .NET SqlClient error", () => {
    const signals = buildSignals({ html: "System.Data.SqlClient.SqlException: Unclosed quotation mark after the character string" });
    expect(namesOf(detectDatabase(signals, [], []))).toContain("SQL Server");
  });

  it("weights leaked evidence higher than ecosystem-convention inference for the same candidate", () => {
    const leaked = detectDatabase(buildSignals({ html: "mongodb://user:pass@host/db" }), [], []);
    const leakedWeight = leaked.find((c) => c.name === "MongoDB")!.matches[0].weight;
    const inferred = detectDatabase(buildSignals(), [confident("WordPress")], []);
    const inferredWeight = inferred.find((c) => c.name === "MySQL")!.matches[0].weight;
    expect(leakedWeight).toBeGreaterThan(inferredWeight);
  });
});

describe("detectDatabase — ecosystem-convention inference", () => {
  it("infers MySQL and MariaDB from a confidently-detected WordPress CMS", () => {
    const result = detectDatabase(buildSignals(), [confident("WordPress")], []);
    const names = namesOf(result);
    expect(names).toContain("MySQL");
    expect(names).toContain("MariaDB");
  });

  it("infers PostgreSQL and SQLite from a confidently-detected Django backend", () => {
    const result = detectDatabase(buildSignals(), [], [confident("Django")]);
    const names = namesOf(result);
    expect(names).toContain("PostgreSQL");
    expect(names).toContain("SQLite");
  });

  it("infers SQL Server from a confidently-detected ASP.NET backend", () => {
    const result = detectDatabase(buildSignals(), [], [confident("ASP.NET")]);
    expect(namesOf(result)).toContain("SQL Server");
  });

  it("does not infer a database from a low-confidence CMS/backend match — real bug found testing against github.com, where a single weak path-existence signal (see cmsDetector.ts) previously cascaded into a confident-looking MySQL guess", () => {
    const result = detectDatabase(buildSignals(), [weak("WordPress")], [weak("Django")]);
    expect(result).toEqual([]);
  });

  it("never guesses a database for a fully-managed SaaS CMS like Shopify", () => {
    const result = detectDatabase(buildSignals(), [confident("Shopify")], []);
    expect(result).toEqual([]);
  });

  it("never guesses a database for Wix, Squarespace, Webflow, or Blogger", () => {
    for (const name of ["Wix", "Squarespace", "Webflow", "Blogger"]) {
      const result = detectDatabase(buildSignals(), [confident(name)], []);
      expect(result).toEqual([]);
    }
  });

  it("returns no candidates when nothing is known at all", () => {
    expect(detectDatabase(buildSignals(), [], [])).toEqual([]);
  });

  it("all ecosystem-convention weights stay in a deliberately low, honest range", () => {
    const result = detectDatabase(buildSignals(), [confident("WordPress")], [confident("Laravel")]);
    for (const candidate of result) {
      for (const match of candidate.matches) {
        expect(match.weight).toBeLessThanOrEqual(0.4);
      }
    }
  });
});
