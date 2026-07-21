import { useOutletContext } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PermissionWizard } from "../PermissionWizard";
import type { AdminInstallation } from "../../lib/api";

export function PermissionsPage() {
  const { installation } = useOutletContext<{ installation: AdminInstallation | null }>();

  if (!installation) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading installation…
      </div>
    );
  }

  // PermissionWizard expects the Installation row's own `id` (a cuid,
  // the value every backend `installationId` query param/foreign key
  // actually means — see Installation.id vs the separate human-readable
  // `Installation.installationId` string field), not that human-readable
  // string.
  return <PermissionWizard installationId={installation.id} actor="dashboard-admin" />;
}
