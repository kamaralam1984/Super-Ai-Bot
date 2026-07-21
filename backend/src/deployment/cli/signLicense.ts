// Vendor-side tool — issues a signed license file. Run offline, on a
// machine holding the private key from generateLicenseKeypair.js (never
// on a deployed customer instance). Typical flow: the customer runs
// printMachineFingerprint.js and sends you the output; you pass it here
// as --machine-fingerprint so the issued file is bound to their specific
// machine (see licenseService.ts's activateLicense for why binding
// happens here, not server-side).
//
// Usage:
//   node dist/deployment/cli/signLicense.js \
//     --private-key ./license-private-key.pem \
//     --license-key KVL-XXXX-XXXX-XXXX \
//     --tier ENTERPRISE \
//     --customer-name "Acme Corp" \
//     --machine-fingerprint <fingerprint-from-customer> \
//     --expires-at 2027-01-01T00:00:00Z \
//     --max-activations 1 \
//     --out ./acme-corp-license.json
//
// Omit --machine-fingerprint for an unrestricted/trial license (activates
// on whichever machine runs it first, permanently binding to that one at
// activation time — see activateLicense). Omit --expires-at for a
// perpetual license.

import fs from "node:fs";
import { signPayload, type LicensePayload, type LicenseTier } from "../license/licenseValidator";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (key && value !== undefined) args[key] = value;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const required = ["private-key", "license-key", "tier", "customer-name"];
  for (const field of required) {
    if (!args[field]) throw new Error(`Missing required --${field}`);
  }
  if (!["STANDARD", "ENTERPRISE", "AGENCY"].includes(args.tier)) {
    throw new Error(`--tier must be one of STANDARD, ENTERPRISE, AGENCY (got "${args.tier}")`);
  }

  const privateKeyPem = fs.readFileSync(args["private-key"], "utf-8");
  const payload: LicensePayload = {
    licenseKey: args["license-key"],
    tier: args.tier as LicenseTier,
    issuedAt: new Date().toISOString(),
    expiresAt: args["expires-at"] ?? null,
    machineFingerprint: args["machine-fingerprint"] ?? null,
    customerName: args["customer-name"],
    maxActivations: args["max-activations"] ? Number(args["max-activations"]) : 1,
  };

  const signature = signPayload(payload, privateKeyPem);
  const file = JSON.stringify({ payload, signature }, null, 2);

  if (args.out) {
    fs.writeFileSync(args.out, file, { mode: 0o600 });
    console.log(`License written to ${args.out}`);
  } else {
    console.log(file);
  }
}

main();
