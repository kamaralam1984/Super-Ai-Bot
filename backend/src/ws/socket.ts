import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { bootConfig } from "../config/env";
import { logEvent } from "../utils/logger";

let io: SocketIOServer | null = null;

/**
 * Initializes the WebSocket server used by the Progress Engine (Step 8+9) to push
 * real-time installation events to the wizard UI. Kept separate from HTTP routing
 * so the progress engine can emit events from any service without importing Express.
 */
export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    // Must match vite.config.ts's dev server.port (3041), same reasoning as
    // app.ts's HTTP cors() call — this one is normally masked by the Vite
    // dev proxy (browser talks same-origin to :3041, Vite proxies the
    // WebSocket upgrade server-side, where CORS never applies), so a stale
    // value here silently does nothing in the common case, but would
    // reject a client connecting directly to this port.
    cors: { origin: bootConfig.NODE_ENV === "development" ? "http://localhost:3041" : true },
  });

  io.on("connection", (socket) => {
    logEvent({ component: "websocket", message: `Client connected: ${socket.id}` });

    // A long-running progress stream (install, then scan+training —
    // several minutes end to end) outlives a single WebSocket connection:
    // a ping-timeout, a laptop going to sleep, a Wi-Fi blip, etc. all
    // trigger socket.io-client's default auto-reconnect, which always
    // gets a *new* socket.id — and therefore a new default "own room" —
    // even though it's still logically the same browser tab watching the
    // same install. installOrchestrator.service.ts (and the scan/training
    // routes) target a caller-supplied room name with `io.to(room)`
    // rather than relying on that implicit own-id room, specifically so
    // the frontend can keep re-joining the *same* named room after every
    // reconnect (see frontend/src/lib/socket.ts's subscribeProgressRoom)
    // and never silently stop receiving events mid-install.
    socket.on("progress:subscribe", (room: unknown) => {
      if (typeof room === "string" && room.length > 0 && room.length < 100) {
        socket.join(room);
      }
    });

    socket.on("disconnect", () => {
      logEvent({ component: "websocket", message: `Client disconnected: ${socket.id}` });
    });
  });

  return io;
}

/** Accessor used by services (SystemCheck, Installer, etc.) to emit progress events. */
export function getSocketServer(): SocketIOServer {
  if (!io) {
    throw new Error("Socket server not initialized — call initSocketServer(httpServer) first");
  }
  return io;
}
