import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

/** Singleton socket connection, proxied to the backend by Vite in dev (see vite.config.ts). */
export function getSocket(): Socket {
  if (!socket) {
    socket = io({ autoConnect: true });
  }
  return socket;
}

/**
 * Keeps `room` joined on the *server's* Socket.IO room of that name across
 * every reconnect, not just the first connect. A plain `socket.id` looked
 * fine for this as long as install/scan/training finished in a few
 * seconds — once the auto pipeline (installOrchestrator.service.ts) grew
 * to include a real scan + real training run (several minutes), a single
 * ping-timeout or backgrounded-tab reconnect partway through was enough
 * to silently strand the UI on stale progress forever: the browser gets a
 * brand-new `socket.id` on reconnect, so the server's `io.to(oldId)`
 * emits from that point on reach nobody, even though the pipeline itself
 * keeps running to completion server-side. Subscribing to a room name the
 * *caller* generates (independent of `socket.id`) and re-emitting the
 * subscribe on every "connect" — not just the first — fixes that: same
 * room, no matter how many times the transport drops and reconnects.
 * Verified against a real ~4-minute install of a live site that hit this
 * exact failure before the fix.
 */
export function subscribeProgressRoom(room: string): () => void {
  const s = getSocket();
  const join = () => s.emit("progress:subscribe", room);
  if (s.connected) join();
  s.on("connect", join);
  return () => {
    s.off("connect", join);
  };
}
