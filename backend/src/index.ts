import http from "node:http";
import { createApp } from "./app";
import { initSocketServer } from "./ws/socket";
import { registerChatSocketHandlers } from "./chat/ws/chatSocket";
import { registerAllScanSchedules } from "./monitor/monitorOrchestrator.service";
import { registerBackupSchedule } from "./deployment/backup/backupScheduler.service";
import { bootConfig } from "./config/env";
import { logEvent } from "./utils/logger";
import { formatError } from "./utils/formatError";

const app = createApp();
const httpServer = http.createServer(app);
const io = initSocketServer(httpServer);
registerChatSocketHandlers(io);

httpServer.listen(bootConfig.INSTALLER_PORT, () => {
  logEvent({
    component: "server",
    message: `KVL Super AI Chatbot installer server listening on http://localhost:${bootConfig.INSTALLER_PORT}`,
    status: "success",
  });
});

// Restores every enabled ScanSchedule into the in-process cron runtime —
// only meaningful once the installer has actually run (DATABASE_URL set);
// a fresh, not-yet-installed instance simply has none to restore.
if (process.env.DATABASE_URL) {
  registerAllScanSchedules(process.env.DATABASE_URL).catch((err) => {
    logEvent({ component: "server", message: "Failed to restore scheduled scans at boot", status: "error", error: formatError(err) });
  });
  registerBackupSchedule();
}

process.on("unhandledRejection", (reason) => {
  logEvent({ component: "process", message: "Unhandled promise rejection", status: "error", error: String(reason) });
});

process.on("uncaughtException", (err) => {
  logEvent({ component: "process", message: "Uncaught exception", status: "error", error: err.message });
  process.exit(1);
});
