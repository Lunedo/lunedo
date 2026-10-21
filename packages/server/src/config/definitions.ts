import { BlockList, isIP } from "node:net";
import { z } from "zod";
import { logLevels } from "../logging/logger.js";

export interface ConfigSetting {
  name: string;
  schema: z.ZodType;
  /** Secrets accept `<NAME>_FILE` and are wrapped in `Secret` after parsing. */
  secret: boolean;
  description: string;
}

export const DEFAULT_UPDATE_CHECK_URL =
  "https://github.com/pagehall/pagehall/releases/latest/download/pagehall-versions.json";
export const installMethods = ["script", "compose", "other"] as const;
export type InstallMethod = (typeof installMethods)[number];

const port = z.coerce.number().int().min(1).max(65535);
const positiveInt = z.coerce.number().int().positive();
const nonEmpty = z.string().trim().min(1);
const path = z.string().trim().min(1);

export function isAddressOrRange(value: string): boolean {
  const [address = "", prefix, ...rest] = value.split("/");
  const family = isIP(address);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  if (!/^[0-9]+$/.test(prefix)) return false;
  try {
    new BlockList().addSubnet(address, Number(prefix), family === 4 ? "ipv4" : "ipv6");
    return true;
  } catch {
    return false;
  }
}

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
  setting(
    "PAGEHALL_COLLAB_UPSTREAM",
    nonEmpty
      .refine(
        (value) => /^https?:\/\/[^/]+\/?$/.test(value),
        "must be an http:// or https:// address without a path",
      )
      .optional(),
    "Address of the collaboration server that the API forwards /collab to. Defaults to the local collaboration port.",
  ),
  setting(
    "PAGEHALL_REDIS_URL",
    nonEmpty.refine((value) => /^rediss?:\/\//.test(value), "must be a redis:// or rediss:// URL").optional(),
    "Redis connection URL. Collaboration servers synchronize documents through it when more than one runs.",
    true,
  ),
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
    "PAGEHALL_IMPORT_DIR",
    path.default("/data/import"),
    "Import folder: exports placed in an organization's subfolder, named after its slug, can be imported without uploading them. Only regular files directly inside that subfolder are read.",
  ),
  setting(
    "PAGEHALL_FILE_STORAGE",
    z.enum(["local", "s3"]).default("local"),
    "Where attachments are stored: local in the file store directory, or s3 in S3-compatible object storage.",
  ),
  setting("PAGEHALL_S3_BUCKET", nonEmpty.optional(), "Bucket for attachments when the file storage is s3."),
  setting(
    "PAGEHALL_S3_ENDPOINT",
    nonEmpty
      .refine((value) => /^https?:\/\//.test(value), "must be an http:// or https:// address")
      .optional(),
    "Address of the S3-compatible service. Leave it out for Amazon S3.",
  ),
  setting("PAGEHALL_S3_REGION", nonEmpty.default("us-east-1"), "Region of the bucket."),
  setting("PAGEHALL_S3_ACCESS_KEY_ID", nonEmpty.optional(), "Access key ID for the bucket.", true),
  setting("PAGEHALL_S3_SECRET_ACCESS_KEY", nonEmpty.optional(), "Secret access key for the bucket.", true),
  setting(
    "PAGEHALL_S3_FORCE_PATH_STYLE",
    z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    "Addresses the bucket in the path instead of the host name, as MinIO and some other services need.",
  ),
  setting(
    "PAGEHALL_S3_PREFIX",
    z
      .string()
      .trim()
      .regex(/^([A-Za-z0-9._-]+\/)*$/, "must be empty or end with /")
      .default(""),
    "Prefix for all object names, for example pagehall/.",
  ),
  setting(
    "PAGEHALL_FILES_URL",
    nonEmpty
      .refine(
        (value) => /^https?:\/\/[^/]+\/?$/.test(value),
        "must be an http:// or https:// address without a path",
      )
      .optional(),
    "Separate origin that serves attachments, as an additional isolation layer. It must forward to the API.",
  ),
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
  setting(
    "PAGEHALL_BACKUP_DIR",
    path.default("/var/lib/pagehall/backups"),
    "Default local backup target, used for backups before updates while no target is set up. Backups to S3 stage the database dump here.",
  ),
  setting(
    "PAGEHALL_BACKUP_BEFORE_UPDATE",
    z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    "Set to false to start without a backup when migrations are pending, for installations with their own backup strategy.",
  ),
  setting("PAGEHALL_METRICS_TOKEN", nonEmpty.optional(), "Bearer token required by /metrics.", true),
  setting(
    "PAGEHALL_RENDER_URL",
    nonEmpty
      .refine(
        (value) => /^https?:\/\/[^/?#]+\/?$/.test(value),
        "must be an http:// or https:// address without a path",
      )
      .optional(),
    "Address of the optional render container that creates PDF files on the server, for example http://pagehall-render:3000.",
  ),
  setting(
    "PAGEHALL_RENDER_TOKEN",
    z.string().trim().min(32, "must have at least 32 characters").optional(),
    "Token the worker sends to the render container. Must match RENDER_TOKEN of the container.",
    true,
  ),
  setting("PAGEHALL_WEB_ROOT", path.optional(), "Directory with the built web client, served by the API."),
  setting(
    "PAGEHALL_TRUSTED_PROXIES",
    z
      .string()
      .trim()
      .optional()
      .transform((value) =>
        value
          ? value
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean)
          : [],
      )
      .refine(
        (entries) => entries.every(isAddressOrRange),
        "must be a comma-separated list of IP addresses and CIDR ranges",
      ),
    "Proxies whose forwarding headers are trusted for the client address and protocol.",
  ),
  setting(
    "PAGEHALL_OUTBOUND_ALLOWED_NETWORKS",
    z
      .string()
      .trim()
      .optional()
      .transform((value) =>
        value
          ? value
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean)
          : [],
      )
      .refine(
        (entries) => entries.every(isAddressOrRange),
        "must be a comma-separated list of IP addresses and CIDR ranges",
      ),
    "Private networks that chat channels, Confluence imports and the S3 backup target may reach. Requests to private, loopback and link-local addresses are refused otherwise.",
  ),
  setting(
    "PAGEHALL_PASSWORD_HASH_CONCURRENCY",
    positiveInt.max(64).default(4),
    "Password hashes computed at once per process; each needs about 19 MiB of memory.",
  ),
  setting(
    "PAGEHALL_INSECURE_IDENTITY_PROVIDERS",
    z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    "Allows identity providers without HTTPS. Only for development and tests.",
  ),
  setting(
    "PAGEHALL_SETUP_CODE",
    nonEmpty.optional(),
    "Setup code for the setup assistant, used instead of a generated one.",
    true,
  ),
  setting(
    "PAGEHALL_INSTANCE_URL",
    nonEmpty.optional(),
    "Address of the instance, used for the setup link and for setup through configuration.",
  ),
  setting("PAGEHALL_INSTANCE_NAME", nonEmpty.optional(), "Instance name for setup through configuration."),
  setting(
    "PAGEHALL_OWNER_EMAIL",
    nonEmpty.optional(),
    "E-mail address of the owner for setup through configuration.",
  ),
  setting("PAGEHALL_OWNER_NAME", nonEmpty.optional(), "Name of the owner for setup through configuration."),
  setting(
    "PAGEHALL_OWNER_PASSWORD",
    nonEmpty.optional(),
    "Password of the owner for setup through configuration.",
    true,
  ),
  setting(
    "PAGEHALL_ORGANIZATION_NAME",
    nonEmpty.optional(),
    "Name of the first organization for setup through configuration.",
  ),
  setting(
    "PAGEHALL_ORGANIZATION_LANGUAGE",
    z.enum(["en", "de"]).optional(),
    "Language of the first organization for setup through configuration.",
  ),
  setting(
    "PAGEHALL_ORGANIZATION_TIME_ZONE",
    nonEmpty.optional(),
    "Time zone of the first organization for setup through configuration.",
  ),
  setting("PAGEHALL_SMTP_HOST", nonEmpty.optional(), "SMTP server for setup through configuration."),
  setting("PAGEHALL_SMTP_PORT", port.optional(), "SMTP port for setup through configuration."),
  setting(
    "PAGEHALL_SMTP_SECURITY",
    z.enum(["tls", "starttls", "none"]).optional(),
    "SMTP connection security.",
  ),
  setting("PAGEHALL_SMTP_USERNAME", nonEmpty.optional(), "SMTP user name for setup through configuration."),
  setting(
    "PAGEHALL_SMTP_PASSWORD",
    nonEmpty.optional(),
    "SMTP password for setup through configuration.",
    true,
  ),
  setting("PAGEHALL_SMTP_FROM", nonEmpty.optional(), "Sender address for setup through configuration."),
  setting(
    "PAGEHALL_UPDATE_CHECK",
    z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    "Set to false to turn the update check off completely. Pagehall then makes no request for it, and the instance setting cannot turn it on.",
  ),
  setting(
    "PAGEHALL_UPDATE_CHECK_URL",
    nonEmpty
      .refine((value) => /^https?:\/\/[^\s]+$/.test(value), "must be an http:// or https:// address")
      .default(DEFAULT_UPDATE_CHECK_URL),
    "Address of the version file the update check downloads, for example a mirror inside the company network.",
  ),
  setting(
    "PAGEHALL_CHANGELOG_FILE",
    path.optional(),
    "Path of the changelog shown under What's new. The image sets it; it defaults to CHANGELOG.md of the source tree.",
  ),
  setting(
    "PAGEHALL_INSTALL_METHOD",
    z.enum(installMethods).optional(),
    "How the instance was installed: script for the setup script, compose for a Compose file of your own, other for anything else. The setup script sets it; the admin area shows the update commands for it.",
  ),
  setting(
    "PAGEHALL_INSTALL_DIR",
    path.optional(),
    "Directory on the host that holds the installation, shown in the update commands. The setup script sets it.",
  ),
  setting(
    "PAGEHALL_SHUTDOWN_TIMEOUT_SECONDS",
    positiveInt.default(30),
    "Time running requests and jobs get to finish on shutdown.",
  ),
] as const satisfies readonly ConfigSetting[];

export type ConfigSettingName = (typeof configSettings)[number]["name"];
