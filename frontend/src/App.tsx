import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { InstallWizard } from "./pages/InstallWizard";
import { AdminLogin } from "./pages/AdminLogin";
import { Home } from "./pages/Home";
import { SignupWizard } from "./pages/SignupWizard";
import { TenantLogin } from "./pages/TenantLogin";
import { DashboardLayout } from "./pages/dashboard/DashboardLayout";
import { TenantDashboardLayout } from "./pages/dashboard/TenantDashboardLayout";
import { OverviewPage } from "./pages/dashboard/OverviewPage";
import { PermissionsPage } from "./pages/dashboard/PermissionsPage";
import { TrainingPage } from "./pages/dashboard/TrainingPage";
import { ConnectorsPage } from "./pages/dashboard/ConnectorsPage";
import { ChatPage } from "./pages/dashboard/ChatPage";
import { MonitoringPage } from "./pages/dashboard/MonitoringPage";
import { BackupsPage } from "./pages/dashboard/BackupsPage";
import { PluginsPage } from "./pages/dashboard/PluginsPage";
import { LicensePage } from "./pages/dashboard/LicensePage";
import { SettingsPage } from "./pages/dashboard/SettingsPage";

/**
 * The backend never gates its wizard-write endpoints on the frontend route —
 * they refuse on their own (see backend/src/middleware/rejectIfInstalled.ts).
 * This is purely UX: an already-installed instance's "/" should not even
 * present the platform installer wizard, so nobody clicks through a flow
 * that only ends in a 409 several steps in. `installed` starts `null`
 * (checking) rather than a boolean default, so a slow/failed health check
 * doesn't briefly render the wrong screen either way.
 *
 * - Not installed: this deployment has never been bootstrapped at all —
 *   "/" is the platform installer wizard, exactly as before (this path is
 *   what turns a brand-new checkout of this product into a running
 *   instance; it has nothing to do with any individual SaaS tenant).
 * - Installed: "/" is the public marketing homepage (Home.tsx), where an
 *   anonymous visitor signs up (/signup) or signs in (/tenant/login). The
 *   embeddable widget itself is never reached via this SPA's router at
 *   all — it's the backend's own GET /widget (widget.routes.ts), iframed
 *   directly by widget.js on a *client's* site, a completely separate
 *   path from anyone browsing to this platform's own homepage.
 */
function RootRoute() {
  const [installed, setInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/health")
      .then((res) => res.json())
      .then((data) => setInstalled(Boolean(data.installed)))
      .catch(() => setInstalled(false));
  }, []);

  if (installed === null) return null;
  return installed ? <Home /> : <InstallWizard />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRoute />} />

        {/* Platform super-admin — this deployment's own owner (KVL), unchanged. */}
        <Route path="/login" element={<AdminLogin />} />
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="training" element={<TrainingPage />} />
          <Route path="connectors" element={<ConnectorsPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="monitoring" element={<MonitoringPage />} />
          <Route path="backups" element={<BackupsPage />} />
          <Route path="plugins" element={<PluginsPage />} />
          <Route path="license" element={<LicensePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="permissions" element={<PermissionsPage />} />
        </Route>

        {/* SaaS tenants — self-registered businesses, each scoped to their
            own installation. The /app/* page components below are the
            *same* components /dashboard/* uses above (OverviewPage,
            TrainingPage, etc.) — every one of them reads `installation`
            purely from useOutletContext, so TenantDashboardLayout's
            identical <Outlet context={{ installation }} /> shape is all
            that's needed for them to work correctly for a tenant too. */}
        <Route path="/signup" element={<SignupWizard />} />
        <Route path="/tenant/login" element={<TenantLogin />} />
        <Route path="/app" element={<TenantDashboardLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="training" element={<TrainingPage />} />
          <Route path="connectors" element={<ConnectorsPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="monitoring" element={<MonitoringPage />} />
          <Route path="backups" element={<BackupsPage />} />
          <Route path="plugins" element={<PluginsPage />} />
          <Route path="license" element={<LicensePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="permissions" element={<PermissionsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
