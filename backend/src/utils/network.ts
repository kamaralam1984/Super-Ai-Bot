import net from "node:net";
import https from "node:https";
import dns from "node:dns/promises";

/** Attempts a raw TCP connection; used to detect whether a local service (Postgres/Redis) is listening. */
export function isPortOpen(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

/** Fetches this host's public-facing IP via a well-known echo service. Returns null if offline/unreachable. */
export function getPublicIp(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.request({ host: "api.ipify.org", path: "/", method: "GET", timeout: 4000 }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        const ip = body.trim();
        resolve(/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null);
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
    req.end();
  });
}

export interface InternetCheckResult {
  online: boolean;
  detail: string;
}

/** DNS resolution + HTTPS reachability against a well-known, high-availability host. */
export async function checkInternetConnectivity(): Promise<InternetCheckResult> {
  try {
    await dns.lookup("registry.npmjs.org");
  } catch {
    return { online: false, detail: "DNS resolution failed — no network route or DNS misconfigured" };
  }

  return new Promise((resolve) => {
    const req = https.request(
      { host: "registry.npmjs.org", method: "HEAD", path: "/", timeout: 4000 },
      (res) => {
        resolve({ online: (res.statusCode ?? 0) < 500, detail: `HTTPS reachable (status ${res.statusCode})` });
        res.resume();
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ online: false, detail: "HTTPS request timed out after 4s" });
    });
    req.on("error", (err) => {
      resolve({ online: false, detail: `HTTPS request failed: ${err.message}` });
    });
    req.end();
  });
}
