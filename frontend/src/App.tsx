import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { InstallWizard } from "./pages/InstallWizard";
import { AdminLogin } from "./pages/AdminLogin";
import { DashboardLayout } from "./pages/dashboard/DashboardLayout";
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
 * present the wizard, so nobody clicks through a flow that only ends in a
 * 409 several steps in. `installed` starts `null` (checking) rather than a
 * boolean default, so a slow/failed health check doesn't briefly render the
 * wrong screen either way.
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
  return installed ? <Navigate to="/login" replace /> : <InstallWizard />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRoute />} />
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
      </Routes>
    </BrowserRouter>
  );
}
