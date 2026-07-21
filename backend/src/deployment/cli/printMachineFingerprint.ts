// Customer-side tool — prints this machine's fingerprint, to send to the
// vendor when requesting a license (see signLicense.js's header comment
// for the full flow). Run inside the backend container:
//   docker compose exec backend node dist/deployment/cli/printMachineFingerprint.js

import { computeMachineFingerprint } from "../license/machineFingerprint";

console.log(computeMachineFingerprint());
