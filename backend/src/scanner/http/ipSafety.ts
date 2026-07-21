import net from "node:net";

/**
 * IPv4 ranges that must never be reachable from the scanner: RFC1918
 * private space, loopback, link-local (including the 169.254.169.254 cloud
 * metadata endpoint), CGNAT, documentation/test ranges, multicast, and
 * reserved space. Every one of these is a real SSRF target if a crawled
 * "website URL" — or a redirect it issues — resolves here.
 */
const IPV4_BLOCKED_RANGES: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isIpv4InRange(ip: string, range: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
}

export function isPrivateOrReservedIPv4(ip: string): boolean {
  return IPV4_BLOCKED_RANGES.some(([range, prefix]) => isIpv4InRange(ip, range, prefix));
}

export function isPrivateOrReservedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true; // loopback / unspecified
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true; // link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true; // unique local fc00::/7

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrReservedIPv4(mapped[1]);
  return false;
}

/** Fails closed: an address of an unrecognized family is treated as unsafe. */
export function isUnsafeAddress(address: string, family: number): boolean {
  if (family === 4 || net.isIPv4(address)) return isPrivateOrReservedIPv4(address);
  if (family === 6 || net.isIPv6(address)) return isPrivateOrReservedIPv6(address);
  return true;
}
