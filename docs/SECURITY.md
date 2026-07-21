# Security Design

## Secret generation

All secrets are generated with `crypto.randomBytes` (CSPRNG), never
`Math.random()`. See `backend/src/services/security.service.ts`.

| Secret | Size | Encoding |
|---|---|---|
| `JWT_SECRET` | 64 bytes | base64url |
| `ENCRYPTION_KEY` | 32 bytes | hex (a valid AES-256 key) |
| `API_SECRET`, `WEBHOOK_SECRET`, `CSRF_SECRET`, `COOKIE_SECRET`, `SESSION_SECRET` | 32 bytes each | base64url |
| Database password | 24 bytes | base64url |

`APPLICATION_ID` / `INSTALLATION_ID` are generated the same way (12 random
bytes, hex, prefixed) — not sequential, not guessable.

## Storage

- Raw secrets are written **only** to `.env` at the repository root, with
  file mode `0600` (owner read/write only) — see `utils/envFileWriter.ts`.
  Every write re-applies the `0600` mode explicitly, since `fs.writeFile`'s
  `mode` option is filtered by the process umask.
- Raw secrets are applied to the running process's `process.env`
  immediately after being written, so later install steps in the same
  process see fresh values without requiring a restart — they are **not**
  re-read from disk mid-request.

## What the API is allowed to return

`GeneratedConfig` (the `POST /api/configuration` response contract) contains
only: `applicationId`, `installationId`, `createdAt`, and non-sensitive
connection metadata (`host`, `port`, `name`, `user` — no passwords). This is
enforced by the type contract in `shared/src/types.ts`, not just by
convention: `generateInstallationConfig()` (the HTTP-facing function) has no
code path that can return a secret, because the type it returns doesn't
have a field for one.

## Audit trail without exposure

Once a secret is generated, the *only* thing that ever gets persisted about
it elsewhere is a **one-way SHA-256 fingerprint**
(`security.service.ts#fingerprint`), stored in the `secret_fingerprints`
table (see [DATABASE.md](DATABASE.md)). This lets an operator verify a
secret hasn't silently changed since install without the audit trail itself
becoming a second place a real secret could leak from.

## SQL injection posture

Database provisioning (`CREATE ROLE`, `CREATE DATABASE`) uses DDL that
Postgres doesn't allow parameterized placeholders for. `utils/pgIdentifier.ts`
provides `assertSafeIdentifier` (allowlist regex, throws on anything
unexpected) and `quoteIdentifier` / `quoteLiteral` (proper escaping) — every
identifier and value that reaches raw SQL in `database.service.ts` goes
through these. In practice, every identifier is machine-generated hex from
`security.service.ts`, but the validation doesn't rely on that assumption
holding forever.

## Transport-layer checks are real, not simulated

Website SSL/HTTPS validation (`utils/tlsProbe.ts`) performs an actual TLS
handshake against the customer's domain and inspects the real peer
certificate (issuer, expiry, trust-chain validity via `socket.authorized`)
rather than just checking whether an HTTPS `fetch()` didn't throw — this
distinguishes "no TLS listener at all" from "TLS listener with an untrusted
or expired certificate," which the wizard surfaces as two different
findings.

## Known gap (documented, not hidden)

Dev-tooling dependencies (Vite's dev server, Vitest's `--ui`) carry
moderate/high/critical advisories in `npm audit` as of this writing. Both
are **dev-server-only** exposure surfaces (path traversal / arbitrary file
read via a locally-running dev or test UI server) — they do not affect the
production build or the deployed installer, and are not reachable unless
someone runs `vite dev` or `vitest --ui` exposed to an untrusted network.
Upgrading requires a Vite 5 → 8 major bump not attempted in Phase 1; tracked
here rather than silently ignored.
