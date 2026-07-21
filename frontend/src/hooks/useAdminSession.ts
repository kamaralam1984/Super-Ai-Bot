import { useEffect, useState } from "react";
import { api, type AdminInstallation } from "../lib/api";

type SessionState = "checking" | "authenticated" | "anonymous";

/**
 * Checks the admin session cookie once on mount (a real network round
 * trip to GET /api/admin/session — there's nothing meaningful to check
 * client-side, since the cookie itself is HttpOnly and unreadable from
 * JS) and, once authenticated, loads the single installation this
 * dashboard manages. Every dashboard page shares this one hook instance
 * via DashboardLayout rather than each re-fetching independently.
 */
export function useAdminSession() {
  const [state, setState] = useState<SessionState>("checking");
  const [installation, setInstallation] = useState<AdminInstallation | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.admin
      .session()
      .then(async ({ authenticated }) => {
        if (cancelled) return;
        if (!authenticated) {
          setState("anonymous");
          return;
        }
        setState("authenticated");
        try {
          const inst = await api.admin.installation();
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
    await api.admin.logout().catch(() => undefined);
    setState("anonymous");
    setInstallation(null);
  }

  return { state, installation, logout };
}
