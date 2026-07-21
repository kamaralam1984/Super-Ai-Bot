import { describe, it, expect } from "vitest";
import { assertReadOnlyAccessLevel, DEFAULT_ACCESS_LEVEL, isForbiddenOperation } from "./leastPrivilegePolicy";

describe("DEFAULT_ACCESS_LEVEL", () => {
  it("is READ_ONLY", () => {
    expect(DEFAULT_ACCESS_LEVEL).toBe("READ_ONLY");
  });
});

describe("assertReadOnlyAccessLevel", () => {
  it("accepts READ_ONLY", () => {
    expect(assertReadOnlyAccessLevel("READ_ONLY")).toBe("READ_ONLY");
  });

  it.each(["WRITE", "DELETE", "UPDATE", "INSERT", "DROP", "ADMIN", ""])("rejects %s", (value) => {
    expect(() => assertReadOnlyAccessLevel(value)).toThrow();
  });
});

describe("isForbiddenOperation", () => {
  it.each(["DELETE", "delete", "Update", "insert", "DROP TABLE", "execute_admin", "admin_reset", "bulk_update", "POST"])("flags %s as forbidden", (op) => {
    expect(isForbiddenOperation(op)).toBe(true);
  });

  it.each(["GET", "read", "search", "list_products", "READ_ONLY"])("does not flag %s", (op) => {
    expect(isForbiddenOperation(op)).toBe(false);
  });
});
