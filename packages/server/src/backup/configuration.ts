import path from "node:path";
import { eq, sql } from "drizzle-orm";
import type { Encryption } from "../crypto/envelope.js";
import type { Database, Executor } from "../database/database.js";
import { instanceSecrets } from "../mail/schema.js";
import type { OutboundPolicy } from "../outbound/guarded-request.js";
import type { BackupScope } from "./archive.js";
import type { RetentionPolicy } from "./retention.js";
import { type BackupTarget, LocalBackupTarget, S3BackupTarget } from "./targets.js";

export const BACKUP_S3_SECRET = "backup.s3SecretAccessKey";

export function backupS3SecretContext(): string {
  return `instance_secrets.value:${BACKUP_S3_SECRET}`;
}

export interface BackupSettings {
  enabled: boolean;
  dailyTime: string;
  weeklyDay: number | null;
  monthlyDay: number | null;
  retention: RetentionPolicy;
  scope: BackupScope;
  beforeUpdate: boolean;
  missingDays: number;
  autoTestRestore: boolean;
}

export type TargetSettings =
  | { kind: "local"; path: string }
  | {
      kind: "s3";
      endpoint: string | null;
      region: string;
      bucket: string;
      prefix: string;
      forcePathStyle: boolean;
      accessKeyId: string;
    };

export interface BackupConfiguration {
  settings: BackupSettings;
  target: TargetSettings | null;
  keyConfirmed: { at: Date; by: string | null } | null;
}

export const DEFAULT_SETTINGS: BackupSettings = {
  enabled: false,
  dailyTime: "02:00",
  weeklyDay: null,
  monthlyDay: null,
  retention: { daily: 7, weekly: 4, monthly: 6, beforeUpdate: 3 },
  scope: "all",
  beforeUpdate: true,
  missingDays: 2,
  autoTestRestore: true,
};

type Row = {
  enabled: boolean;
  daily_time: string;
  weekly_day: number | null;
  monthly_day: number | null;
  keep_daily: number;
  keep_weekly: number;
  keep_monthly: number;
  keep_before_update: number;
  scope: BackupScope;
  before_update: boolean;
  missing_days: number;
  auto_test_restore: boolean;
  target_kind: "local" | "s3" | null;
  target_path: string | null;
  s3_endpoint: string | null;
  s3_region: string | null;
  s3_bucket: string | null;
  s3_prefix: string;
  s3_force_path_style: boolean;
  s3_access_key_id: string | null;
  key_confirmed_at: Date | string | null;
  key_confirmed_by: string | null;
};

function targetOf(row: Row): TargetSettings | null {
  if (row.target_kind === "local" && row.target_path) return { kind: "local", path: row.target_path };
  if (row.target_kind === "s3" && row.s3_bucket && row.s3_region && row.s3_access_key_id) {
    return {
      kind: "s3",
      endpoint: row.s3_endpoint,
      region: row.s3_region,
      bucket: row.s3_bucket,
      prefix: row.s3_prefix,
      forcePathStyle: row.s3_force_path_style,
      accessKeyId: row.s3_access_key_id,
    };
  }
  return null;
}

function isMissingTable(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth++) {
    if ((current as { code?: string }).code === "42P01") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function readBackupConfiguration(
  executor: Pick<Executor, "execute">,
): Promise<BackupConfiguration> {
  let row: Row | undefined;
  try {
    row = (await executor.execute<Row>(sql`select * from backup_configuration where singleton`)).rows[0];
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  if (!row) return { settings: DEFAULT_SETTINGS, target: null, keyConfirmed: null };
  return {
    settings: {
      enabled: row.enabled,
      dailyTime: row.daily_time,
      weeklyDay: row.weekly_day,
      monthlyDay: row.monthly_day,
      retention: {
        daily: row.keep_daily,
        weekly: row.keep_weekly,
        monthly: row.keep_monthly,
        beforeUpdate: row.keep_before_update,
      },
      scope: row.scope,
      beforeUpdate: row.before_update,
      missingDays: row.missing_days,
      autoTestRestore: row.auto_test_restore,
    },
    target: targetOf(row),
    keyConfirmed: row.key_confirmed_at
      ? { at: new Date(row.key_confirmed_at), by: row.key_confirmed_by }
      : null,
  };
}

export async function readS3Secret(
  executor: Pick<Database, "select">,
  encryption: Encryption,
): Promise<string | null> {
  const [row] = await executor
    .select({ value: instanceSecrets.value })
    .from(instanceSecrets)
    .where(eq(instanceSecrets.name, BACKUP_S3_SECRET));
  return row ? encryption.decryptString(row.value, backupS3SecretContext()) : null;
}

export class MissingTargetSecretError extends Error {
  override name = "MissingTargetSecretError";

  constructor() {
    super("The secret key of the S3 backup target is missing. Enter it again in the backup settings.");
  }
}

export function openTarget(
  target: TargetSettings,
  options: { secret: string | null; policy: OutboundPolicy },
): BackupTarget {
  if (target.kind === "local") return new LocalBackupTarget(target.path);
  if (!options.secret) throw new MissingTargetSecretError();
  return new S3BackupTarget(
    {
      endpoint: target.endpoint,
      region: target.region,
      bucket: target.bucket,
      prefix: target.prefix,
      forcePathStyle: target.forcePathStyle,
      accessKeyId: target.accessKeyId,
      secretAccessKey: options.secret,
    },
    options.policy,
  );
}

export function closeTarget(target: BackupTarget): void {
  if (target instanceof S3BackupTarget) target.destroy();
}

export type LocalPathProblem = "relative" | "reserved";

export function localPathProblem(candidate: string, reserved: readonly string[]): LocalPathProblem | null {
  if (!path.isAbsolute(candidate)) return "relative";
  const normalized = path.resolve(candidate);
  if (normalized === path.parse(normalized).root) return "reserved";
  for (const dir of reserved) {
    const relative = path.relative(path.resolve(dir), normalized);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return "reserved";
  }
  return null;
}
