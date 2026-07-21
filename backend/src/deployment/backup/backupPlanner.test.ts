import { describe, it, expect } from "vitest";
import { buildBackupFileName, selectBackupsToPrune, type PrunableBackup } from "./backupPlanner";

describe("buildBackupFileName", () => {
  it("produces a filesystem-safe, sortable name from a label and timestamp", () => {
    const name = buildBackupFileName("Pre-Update Safety Net!", new Date("2026-07-20T03:00:00.000Z"));
    expect(name).toBe("kvl-backup-2026-07-20T03-00-00-000Z-pre-update-safety-net.tar.gz");
  });

  it("defaults to 'manual' when no label is given", () => {
    const name = buildBackupFileName(null, new Date("2026-01-01T00:00:00.000Z"));
    expect(name).toContain("-manual.tar.gz");
  });

  it("falls back to 'manual' when the label is entirely non-alphanumeric", () => {
    const name = buildBackupFileName("!!!", new Date("2026-01-01T00:00:00.000Z"));
    expect(name).toContain("-manual.tar.gz");
  });
});

describe("selectBackupsToPrune", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = new Date("2026-07-20T00:00:00.000Z");

  function backup(id: string, daysAgo: number, status: PrunableBackup["status"] = "COMPLETED"): PrunableBackup {
    return { id, createdAt: new Date(now.getTime() - daysAgo * day), status };
  }

  it("prunes completed backups older than the retention window", () => {
    const backups = [backup("recent", 1), backup("old", 20)];
    const pruned = selectBackupsToPrune(backups, 14, now);
    expect(pruned.map((b) => b.id)).toEqual(["old"]);
  });

  it("never prunes the single most recent completed backup, even if it's older than the retention window", () => {
    const backups = [backup("only-one", 100)];
    expect(selectBackupsToPrune(backups, 14, now)).toEqual([]);
  });

  it("keeps the most recent backup safe even when every backup is old", () => {
    const backups = [backup("oldest", 100), backup("newer", 50), backup("newest", 30)];
    const pruned = selectBackupsToPrune(backups, 14, now);
    expect(pruned.map((b) => b.id).sort()).toEqual(["newer", "oldest"]);
  });

  it("ignores FAILED and IN_PROGRESS backups entirely", () => {
    const backups = [backup("failed-old", 30, "FAILED"), backup("stuck", 30, "IN_PROGRESS"), backup("completed-recent", 1)];
    expect(selectBackupsToPrune(backups, 14, now)).toEqual([]);
  });

  it("returns nothing to prune when there are 0 or 1 backups total", () => {
    expect(selectBackupsToPrune([], 14, now)).toEqual([]);
    expect(selectBackupsToPrune([backup("only", 100)], 14, now)).toEqual([]);
  });
});
