// Least-Privilege Policy — the single place that pins down what "least
// privilege" means for this engine at the type/value level, not just in a
// comment. PermissionAccessLevel has exactly one legal value ("READ_ONLY"),
// so there is no write-access value a caller could construct even by
// mistake through the normal TS-typed path; this module makes that
// guarantee explicit, testable, and enforced defense-in-depth against any
// future input surface that constructs an access level from a plain string
// (e.g. an admin API body) rather than the closed union.

import type { PermissionAccessLevel } from "../types";

export const DEFAULT_ACCESS_LEVEL: PermissionAccessLevel = "READ_ONLY";

/** Operation/verb names the Permission Engine must never be asked to authorize, per the product spec's explicit list. Matched as a substring so e.g. "bulk_update" or "admin_execute" are still caught. */
const FORBIDDEN_OPERATIONS = ["DELETE", "UPDATE", "INSERT", "DROP", "EXECUTE", "ADMIN", "WRITE", "TRUNCATE", "ALTER", "GRANT", "PATCH", "PUT", "POST"] as const;

/**
 * Defense-in-depth guard for any code path that constructs an access level
 * from an external string rather than the closed TS union — throws rather
 * than silently downgrading to something unsafe.
 */
export function assertReadOnlyAccessLevel(value: string): PermissionAccessLevel {
  if (value !== "READ_ONLY") {
    throw new Error(`Refusing to grant non-read-only access level "${value}" — the Permission Engine only ever grants READ_ONLY access, by design.`);
  }
  return "READ_ONLY";
}

/**
 * True if a free-text operation/action name describes a mutation the engine
 * must never be asked to authorize — a keyword tripwire for any future
 * admin-facing input surface, independent of (and in addition to) the type
 * system's own guarantee.
 */
export function isForbiddenOperation(operation: string): boolean {
  const normalized = operation.trim().toUpperCase();
  return FORBIDDEN_OPERATIONS.some((op) => normalized.includes(op));
}
