import { randomBytes } from "node:crypto";

export const backupClasses = ["daily", "weekly", "monthly", "manual", "beforeUpdate"] as const;
export type BackupClass = (typeof backupClasses)[number];

const SLUGS: Record<BackupClass, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
  manual: "manual",
  beforeUpdate: "before-update",
};
const CLASSES = new Map(
  Object.entries(SLUGS).map(([backupClass, slug]) => [slug, backupClass as BackupClass]),
);

const NAME =
  /^lunedo-backup-(\d{8}T\d{6}Z)-(daily|weekly|monthly|manual|before-update)-([0-9a-f]{8})\.ldbak$/;
export const BACKUP_NAME_PATTERN = NAME;

export interface BackupName {
  name: string;
  backupClass: BackupClass;
  createdAt: Date;
}

function stamp(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

export function backupName(
  backupClass: BackupClass,
  createdAt: Date,
  suffix = randomBytes(4).toString("hex"),
) {
  return `lunedo-backup-${stamp(createdAt)}-${SLUGS[backupClass]}-${suffix}.ldbak`;
}

export function parseBackupName(name: string): BackupName | null {
  const match = NAME.exec(name);
  if (!match) return null;
  const [, time = "", slug = ""] = match;
  const createdAt = new Date(
    `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)}T${time.slice(9, 11)}:${time.slice(11, 13)}:${time.slice(13, 15)}Z`,
  );
  const backupClass = CLASSES.get(slug);
  if (Number.isNaN(createdAt.getTime()) || !backupClass) return null;
  return { name, backupClass, createdAt };
}

export function isBackupName(name: string): boolean {
  return parseBackupName(name) !== null;
}
