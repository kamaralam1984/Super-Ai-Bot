/**
 * Postgres DDL (CREATE ROLE/DATABASE) doesn't support bind-parameter
 * placeholders the way DML does, so identifiers and literals used in the
 * DatabaseManager are validated/escaped here instead. Generated names only
 * ever come from security.service.ts (hex from crypto.randomBytes), but this
 * module is defense-in-depth against that assumption ever changing.
 */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export function assertSafeIdentifier(name: string, kind: string): void {
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new Error(`Unsafe ${kind} identifier: "${name}"`);
  }
}

export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
