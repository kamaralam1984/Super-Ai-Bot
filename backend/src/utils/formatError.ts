/**
 * Node's AggregateError (thrown by undici/net when multiple connection
 * attempts — e.g. IPv4 + IPv6 — all fail) has an empty top-level `.message`
 * by default; the useful detail lives in `.errors[]`. A plain
 * `err.message` extraction silently produces an empty string for exactly
 * the errors most worth logging (multi-address connection failures).
 */
export function formatError(err: unknown): string {
  if (err instanceof AggregateError) {
    const inner = err.errors.map((e) => (e instanceof Error ? e.message : String(e))).join("; ");
    return inner || err.message || "AggregateError with no details";
  }
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}
