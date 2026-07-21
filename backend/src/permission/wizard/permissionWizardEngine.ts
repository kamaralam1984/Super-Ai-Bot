// Permission Wizard Engine — pure logic for the setup wizard the
// administrator uses to authorize chatbot access. Builds the current state
// (every applicable catalog scope + whether it's currently granted) and
// diffs a submitted selection against the current active grants to produce
// the minimal set of grant/revoke operations, so the record service never
// has to guess what changed or blindly overwrite history.

import { listDataScopeDefinitions } from "../catalog/dataScopeCatalog";
import type { DataScope, PermissionGrantRecord, WizardDiff, WizardScopeOption, WizardState } from "../types";

/** `connectorId: null` builds the wizard for the installation's own crawled knowledge base; a connector id builds it for that Phase 5 connector, showing only scopes whose catalog entry applies to that target. */
export function buildWizardState(installationId: string, connectorId: string | null, activeGrants: PermissionGrantRecord[]): WizardState {
  const target = connectorId ? "connector" : "site";
  const options: WizardScopeOption[] = listDataScopeDefinitions()
    .filter((def) => def.appliesTo.includes(target))
    .map((def) => {
      const grant = activeGrants.find((g) => g.status === "ACTIVE" && g.dataScope === def.scope && g.connectorId === connectorId);
      return { ...def, granted: !!grant, grantId: grant?.id };
    });
  return { installationId, connectorId, options };
}

/** Pure diff: which scopes need a new grant, which need their existing grant revoked, and which are already correct and should be left untouched (preserving their original grantedAt/grantedBy history). */
export function diffWizardSubmission(currentActiveScopes: DataScope[], submittedScopes: DataScope[]): WizardDiff {
  const currentSet = new Set(currentActiveScopes);
  const submittedSet = new Set(submittedScopes);
  return {
    toGrant: submittedScopes.filter((s) => !currentSet.has(s)),
    toRevoke: currentActiveScopes.filter((s) => !submittedSet.has(s)),
    unchanged: currentActiveScopes.filter((s) => submittedSet.has(s)),
  };
}
