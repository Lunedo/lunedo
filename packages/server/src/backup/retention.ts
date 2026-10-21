import type { BackupClass, BackupName } from "./naming.js";

export interface RetentionPolicy {
  daily: number;
  weekly: number;
  monthly: number;
  beforeUpdate: number;
}

const KEPT_BY_COUNT: readonly Exclude<BackupClass, "manual">[] = [
  "daily",
  "weekly",
  "monthly",
  "beforeUpdate",
];

export function expiredBackups(backups: readonly BackupName[], policy: RetentionPolicy): BackupName[] {
  const expired: BackupName[] = [];
  for (const backupClass of KEPT_BY_COUNT) {
    const ofClass = backups
      .filter((backup) => backup.backupClass === backupClass)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.name.localeCompare(a.name));
    expired.push(...ofClass.slice(Math.max(0, policy[backupClass])));
  }
  return expired;
}
