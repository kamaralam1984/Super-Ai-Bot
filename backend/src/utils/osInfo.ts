import fs from "node:fs/promises";
import os from "node:os";

export interface OsInfo {
  name: string;
  version: string;
}

/** Parses /etc/os-release for a human-friendly distro name (Ubuntu/Debian, per this product's supported OS list). */
export async function getOsInfo(): Promise<OsInfo> {
  try {
    const content = await fs.readFile("/etc/os-release", "utf-8");
    const fields = Object.fromEntries(
      content
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => {
          const [key, ...rest] = line.split("=");
          return [key, rest.join("=").replace(/^"|"$/g, "")];
        })
    );
    return { name: fields.NAME ?? os.type(), version: fields.VERSION ?? os.release() };
  } catch {
    return { name: os.type(), version: os.release() };
  }
}
