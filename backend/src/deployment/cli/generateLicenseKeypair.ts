// Vendor-side tool — generates a fresh Ed25519 keypair for License
// Management. Run this ONCE, offline, on a machine that will never run
// this product's server. Keep the private key completely secret (used
// only by signLicense.ts to issue license files); set LICENSE_PUBLIC_KEY
// in every deployed instance's .env to the printed public key so
// licenseValidator.ts verifies against it instead of the built-in
// out-of-the-box default (see licenseValidator.ts's own comment on why
// that default must never be treated as secret).
//
// Usage: node dist/deployment/cli/generateLicenseKeypair.js

import crypto from "node:crypto";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");

console.log("=== LICENSE_PUBLIC_KEY (set this in every deployed instance's .env) ===");
console.log(publicKey.export({ type: "spki", format: "pem" }).toString());
console.log("=== PRIVATE KEY (keep this OFFLINE and SECRET — only signLicense.js needs it) ===");
console.log(privateKey.export({ type: "pkcs8", format: "pem" }).toString());
