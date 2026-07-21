import { describe, it, expect } from "vitest";
import { validatePluginManifest, KNOWN_PLUGIN_PERMISSIONS } from "./pluginManifest";

function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "example-plugin",
    version: "1.0.0",
    entryPoint: "index.js",
    permissions: ["read:products"],
    description: "An example plugin",
    author: "KVL",
    ...overrides,
  };
}

describe("validatePluginManifest", () => {
  it("accepts a well-formed manifest", () => {
    const result = validatePluginManifest(validManifest());
    expect(result.valid).toBe(true);
    expect(result.manifest).toEqual({
      name: "example-plugin",
      version: "1.0.0",
      entryPoint: "index.js",
      permissions: ["read:products"],
      description: "An example plugin",
      author: "KVL",
    });
  });

  it("accepts a manifest with no permissions and no optional fields", () => {
    const result = validatePluginManifest({ name: "minimal-plugin", version: "0.1.0", entryPoint: "main.js" });
    expect(result.valid).toBe(true);
    expect(result.manifest?.permissions).toEqual([]);
  });

  it("rejects a non-object", () => {
    expect(validatePluginManifest("not an object").valid).toBe(false);
    expect(validatePluginManifest(null).valid).toBe(false);
    expect(validatePluginManifest([1, 2, 3]).valid).toBe(false);
  });

  it("rejects an invalid name", () => {
    const result = validatePluginManifest(validManifest({ name: "Not_Valid Name!" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("rejects a non-semver version", () => {
    const result = validatePluginManifest(validManifest({ version: "v1" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("version"))).toBe(true);
  });

  it("rejects a missing entryPoint", () => {
    const result = validatePluginManifest(validManifest({ entryPoint: "" }));
    expect(result.valid).toBe(false);
  });

  it("rejects a path-traversal entryPoint", () => {
    const result = validatePluginManifest(validManifest({ entryPoint: "../../etc/passwd" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("relative path"))).toBe(true);
  });

  it("rejects an absolute-path entryPoint", () => {
    const result = validatePluginManifest(validManifest({ entryPoint: "/etc/passwd" }));
    expect(result.valid).toBe(false);
  });

  it("rejects an unknown permission", () => {
    const result = validatePluginManifest(validManifest({ permissions: ["read:products", "delete:everything"] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("delete:everything"))).toBe(true);
  });

  it("accepts every declared known permission", () => {
    const result = validatePluginManifest(validManifest({ permissions: [...KNOWN_PLUGIN_PERMISSIONS] }));
    expect(result.valid).toBe(true);
    expect(result.manifest?.permissions).toEqual(KNOWN_PLUGIN_PERMISSIONS);
  });

  it("rejects permissions that aren't an array of strings", () => {
    expect(validatePluginManifest(validManifest({ permissions: "read:products" })).valid).toBe(false);
    expect(validatePluginManifest(validManifest({ permissions: [123] })).valid).toBe(false);
  });
});
