import { useEffect, useState } from "react";
import { api, type AdminInstallation } from "../lib/api";

type SessionState = "checking" | "authenticated" | "anonymous";

/**
 * Same shape as useAdminSession.ts, calling api.tenant.* instead of
 * api.admin.* — kept as a separate hook (not a parameterized version of
 * useAdminSession) since the two check entirely different cookies and
 * must never be conflated.
 */
export function useTenantSession() {
  const [state, setState] = useState<SessionState>("checking");
  const [installation, setInstallation] = useState<AdminInstallation | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.tenant
      .session()
      .then(async ({ authenticated }) => {
        if (cancelled) return;
        if (!authenticated) {
          setState("anonymous");
          return;
        }
        setState("authenticated");
        try {
          const inst = await api.tenant.installation();
          if (!cancelled) setInstallation(inst);
        } catch {
          if (!cancelled) setInstallation(null);
        }
      })
      .catch(() => {
        if (!cancelled) setState("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout(): Promise<void> {
    await api.tenant.logout().catch(() => undefined);
    setState("anonymous");
    setInstallation(null);
  }

  return { state, installation, logout };
}
