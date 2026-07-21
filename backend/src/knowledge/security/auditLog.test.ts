import { describe, it, expect } from "vitest";
import { recordAuditEvent, type AuditEventType } from "./auditLog";

describe("recordAuditEvent", () => {
  const ALL_TYPES: AuditEventType[] = ["search_performed", "access_denied", "rate_limited", "encryption_failure", "decryption_failure", "chunk_removed", "rollback_performed"];

  it.each(ALL_TYPES)("does not throw for event type %s", (type) => {
    expect(() => recordAuditEvent({ type, detail: "test detail" })).not.toThrow();
  });

  it("accepts optional metadata without throwing", () => {
    expect(() => recordAuditEvent({ type: "access_denied", detail: "bad api key", metadata: { ip: "1.2.3.4" } })).not.toThrow();
  });
});
