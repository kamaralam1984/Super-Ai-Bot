// Secure Credential Vault — encrypts, stores, and rotates connector
// credentials. Wraps Phase 3's AES-256-GCM primitive (encryption.ts) and
// Phase 1's one-way fingerprint helper (security.service.ts) rather than
// reimplementing either. A `RawCredentialInput` never touches disk or the
// database in plaintext — only `VaultedCredential.encryptedPayload` (the
// ciphertext) and `fingerprint` (a one-way hash, for audit) are persisted.
//
// HSM readiness (Phase 9): every encrypt/decrypt call in this module goes
// through the `SecretsCipher` interface below, not the AES-256-GCM
// primitive directly. `Aes256GcmCipher` (wrapping `encryption.ts`'s
// software implementation, keyed by the installer-generated
// `ENCRYPTION_KEY`) is the only implementation that ships today — this
// product's self-hosted, single-server deployment model has no Hardware
// Security Module or cloud KMS to integrate with by default, and shipping
// a fake/no-op HSM integration would be worse than not claiming one. What
// this seam provides is real: a future PKCS#11-, AWS KMS-, or HashiCorp
// Vault Transit-backed `SecretsCipher` can be registered via
// `setSecretsCipher()` at process startup, and every existing call site
// (`sealCredential`/`openCredential`/`rotateCredential`, and everywhere
// else in the codebase that vaults a secret this way) picks it up with no
// changes — the abstraction boundary is the actual deliverable, not a
// concrete HSM driver nobody asked for yet.

import { decrypt, encrypt } from "../../knowledge/security/encryption";
import { fingerprint } from "../../services/security.service";
import type { ConnectorAuthMethod, RawCredentialInput } from "../types";

export interface SecretsCipher {
  readonly name: string;
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

/** The default, always-available implementation — AES-256-GCM keyed by `ENCRYPTION_KEY` (see encryption.ts). */
export class Aes256GcmCipher implements SecretsCipher {
  readonly name = "aes-256-gcm-software";
  encrypt(plaintext: string): string {
    return encrypt(plaintext);
  }
  decrypt(ciphertext: string): string {
    return decrypt(ciphertext);
  }
}

let activeCipher: SecretsCipher = new Aes256GcmCipher();

/** Swaps the vault's active cipher — e.g. to an HSM/KMS-backed implementation. Call once at process startup, before any credential is sealed or opened; swapping mid-run would leave already-vaulted ciphertext unreadable by the new cipher (that's a deliberate key-rotation operation, not something this function does implicitly — see `rotateCredential`). */
export function setSecretsCipher(cipher: SecretsCipher): void {
  activeCipher = cipher;
}

export function getSecretsCipher(): SecretsCipher {
  return activeCipher;
}

/** Test-only hook — restores the default software cipher between test cases that call `setSecretsCipher`. */
export function resetSecretsCipher(): void {
  activeCipher = new Aes256GcmCipher();
}

export interface VaultedCredential {
  authMethod: ConnectorAuthMethod;
  encryptedPayload: string;
  fingerprint: string;
}

/** Extracts the actual secret material for a given auth method, for fingerprinting/encryption — everything else in the input (e.g. a public clientId) is not secret and isn't what the fingerprint should track. */
function secretMaterial(input: RawCredentialInput): string {
  switch (input.authMethod) {
    case "API_KEY":
      return input.apiKey ?? "";
    case "BEARER_TOKEN":
      return input.bearerToken ?? "";
    case "JWT":
      return input.jwt ?? "";
    case "OAUTH2":
      return JSON.stringify(input.oauth2 ?? {});
    case "BASIC_AUTH":
      return JSON.stringify(input.basicAuth ?? {});
    case "SESSION":
      return input.session?.cookie ?? "";
    case "CUSTOM_HEADER":
      return JSON.stringify(input.customHeaders ?? {});
    case "SIGNED_REQUEST":
      return JSON.stringify(input.signedRequest ?? {});
    case "NONE":
      return "";
    default:
      return "";
  }
}

/** Encrypts a raw credential for storage. Throws if the auth method requires a value that wasn't supplied. */
export function sealCredential(input: RawCredentialInput): VaultedCredential {
  const material = secretMaterial(input);
  if (input.authMethod !== "NONE" && material.length === 0) {
    throw new Error(`Credential of type ${input.authMethod} requires a secret value, but none was provided`);
  }
  return {
    authMethod: input.authMethod,
    encryptedPayload: activeCipher.encrypt(JSON.stringify(input)),
    fingerprint: fingerprint(material),
  };
}

/** Decrypts a vaulted credential back to its raw form for use by the auth manager. Throws on tampering (auth-tag failure) or a wrong/rotated key. */
export function openCredential(vaulted: Pick<VaultedCredential, "encryptedPayload">): RawCredentialInput {
  return JSON.parse(activeCipher.decrypt(vaulted.encryptedPayload)) as RawCredentialInput;
}

/** Re-encrypts a credential under the current active cipher/key without changing its secret material — used for scheduled key rotation. */
export function rotateCredential(vaulted: Pick<VaultedCredential, "encryptedPayload">): VaultedCredential {
  const raw = openCredential(vaulted);
  return sealCredential(raw);
}

/** True if two raw credentials carry the same secret material, without ever comparing/logging the plaintext directly — used to detect no-op credential updates. */
export function credentialsMatch(a: RawCredentialInput, b: RawCredentialInput): boolean {
  if (a.authMethod !== b.authMethod) return false;
  return fingerprint(secretMaterial(a)) === fingerprint(secretMaterial(b));
}
