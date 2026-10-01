import { z } from "zod";
import { logLevels } from "../logging/logger.js";

export interface ConfigSetting {
  name: string;
  schema: z.ZodType;
  /** Secrets accept `<NAME>_FILE` and are wrapped in `Secret` after parsing. */
  secret: boolean;
  description: string;
}

const port = z.coerce.number().int().min(1).max(65535);
const positiveInt = z.coerce.number().int().positive();
const nonEmpty = z.string().trim().min(1);
const path = z.string().trim().min(1);

function setting(name: string, schema: z.ZodType, description: string, secret = false): ConfigSetting {
  return { name, schema, secret, description };
}

/** Every setting Pagehall reads. `docs/configuration.md` documents each of them; a test enforces this. */
export const configSettings = [
  setting("PAGEHALL_CONFIG_FILE", path.optional(), "Path of an optional JSON configuration file."),
  setting("PAGEHALL_HOST", nonEmpty.default("0.0.0.0"), "Address the HTTP servers listen on."),
  setting("PAGEHALL_API_PORT", port.default(3000), "Port of the API."),
  setting("PAGEHALL_COLLAB_PORT", port.default(3001), "Port of the collaboration server."),
  setting("PAGEHALL_WORKER_PORT", port.default(3002), "Port of the worker's health and metrics endpoints."),
  setting("PAGEHALL_LOG_LEVEL", z.enum(logLevels).default("info"), "Minimum log level."),
  setting(
    "PAGEHALL_DATABASE_URL",
    nonEmpty.refine((value) => /^postgres(ql)?:\/\//.test(value), "must be a postgres:// URL"),
    "PostgreSQL connection URL.",
    true,
  ),
  setting("PAGEHALL_DATABASE_POOL_SIZE", positiveInt.default(10), "Maximum connections per process."),
  setting("PAGEHALL_FILES_DIR", path.default("/var/lib/pagehall/files"), "Directory of the file store."),
  setting(
    "PAGEHALL_SECRETS_DIR",
    path.default("/var/lib/pagehall/secrets"),
    "Directory for secrets generated on first start.",
  ),
  setting(
    "PAGEHALL_KEY_PROVIDER",
    z.enum(["env", "file"]).optional(),
    "Source of the master keys. Defaults to env when PAGEHALL_MASTER_KEYS is set, file otherwise.",
  ),
  setting("PAGEHALL_MASTER_KEYS", nonEmpty.optional(), "Master key ring for the env key provider.", true),
  setting(
    "PAGEHALL_MASTER_KEYS_PATH",
    path.optional(),
    "Master key ring file for the file key provider. Defaults to master-keys in the secrets directory.",
  ),
  setting("PAGEHALL_BACKUP_KEY", nonEmpty.optional(), "Key ring that encrypts backups.", true),
  setting("PAGEHALL_METRICS_TOKEN", nonEmpty.optional(), "Bearer token required by /metrics.", true),
  setting("PAGEHALL_WEB_ROOT", path.optional(), "Directory with the built web client, served by the API."),
  setting(
    "PAGEHALL_SHUTDOWN_TIMEOUT_SECONDS",
    positiveInt.default(30),
    "Time running requests and jobs get to finish on shutdown.",
  ),
] as const satisfies readonly ConfigSetting[];

export type ConfigSettingName = (typeof configSettings)[number]["name"];
