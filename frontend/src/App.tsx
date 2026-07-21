import { BrowserRouter, Routes, Route } from "react-router-dom";
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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<InstallWizard />} />
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
