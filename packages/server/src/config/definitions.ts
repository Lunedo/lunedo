import { BlockList, isIP } from "node:net";
import { z } from "zod";
import { logLevels } from "../logging/logger.js";

export interface ConfigSetting {
  name: string;
  schema: z.ZodType;
  /** Secrets accept `<NAME>_FILE` and are wrapped in `Secret` after parsing. */
  secret: boolean;
  description: string;
  topic: string;
  format?: string;
  defaultText?: string;
}

interface SettingOptions {
  secret?: boolean;
  format?: string;
  defaultText?: string;
}

export const DEFAULT_UPDATE_CHECK_URL =
  "https://github.com/lunedo/lunedo/releases/latest/download/lunedo-versions.json";
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

type TopicSetting = Omit<ConfigSetting, "topic">;

function setting(
  name: string,
  schema: z.ZodType,
  description: string,
  options: SettingOptions = {},
): TopicSetting {
  return {
    name,
    schema,
    secret: options.secret ?? false,
    description,
    ...(options.format === undefined ? {} : { format: options.format }),
    ...(options.defaultText === undefined ? {} : { defaultText: options.defaultText }),
  };
}

function topic(title: string, settings: readonly TopicSetting[]): ConfigSetting[] {
  return settings.map((entry) => ({ ...entry, topic: title }));
}

const HTTP_ORIGIN = "An `http://` or `https://` address without a path.";
const ADDRESS_LIST = "Comma-separated IP addresses and CIDR ranges.";
const booleanText = z.enum(["true", "false"]);

const addressList = z
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
  );

export const configSettings: readonly ConfigSetting[] = [
  ...topic("Database and processes", [
    setting(
      "LUNEDO_DATABASE_URL",
      nonEmpty.refine((value) => /^postgres(ql)?:\/\//.test(value), "must be a postgres:// URL"),
      "PostgreSQL connection URL.",
      {
        secret: true,
        format: "A `postgres://` URL, for example `postgres://user:password@host:5432/database`.",
      },
    ),
    setting(
      "LUNEDO_DATABASE_POOL_SIZE",
      positiveInt.default(10),
      "Maximum database connections per process.",
    ),
    setting("LUNEDO_HOST", nonEmpty.default("0.0.0.0"), "Address the HTTP servers listen on."),
    setting("LUNEDO_API_PORT", port.default(3000), "Port of the API."),
    setting("LUNEDO_COLLAB_PORT", port.default(3001), "Port of the collaboration server."),
    setting("LUNEDO_WORKER_PORT", port.default(3002), "Port of the worker's health and metrics endpoints."),
    setting(
      "LUNEDO_LOG_LEVEL",
      z.enum(logLevels).default("info"),
      "Minimum level of the messages Lunedo logs.",
    ),
    setting(
      "LUNEDO_SHUTDOWN_TIMEOUT_SECONDS",
      positiveInt.default(30),
      "Time in seconds that running requests and jobs get to finish on shutdown. Allow a stop grace period of at least this time plus 10 seconds in the container orchestrator.",
    ),
    setting("LUNEDO_WEB_ROOT", path.optional(), "Directory with the built web client, served by the API.", {
      defaultText: "`/app/web` in the image",
    }),
    setting(
      "LUNEDO_CONFIG_FILE",
      path.optional(),
      "Path of an optional JSON configuration file. Its keys are the names of these settings; environment variables take precedence over it.",
    ),
  ]),
  ...topic("Address and reverse proxy", [
    setting(
      "LUNEDO_INSTANCE_URL",
      nonEmpty.optional(),
      "Address of the instance, used for the setup link and for setup through configuration. When set, it is the address: Lunedo stores it at every start, and the setup assistant and the instance settings show it read-only.",
      {
        format:
          "An `http://` or `https://` address without a path or a trailing slash, for example `https://wiki.example.com`.",
      },
    ),
    setting(
      "LUNEDO_TRUSTED_PROXIES",
      addressList,
      "Reverse proxies whose forwarding headers are trusted. Only requests from them may set the client address, protocol and host through `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`. List the one address of your proxy, never a whole subnet.",
      { format: ADDRESS_LIST },
    ),
    setting(
      "LUNEDO_FILES_URL",
      nonEmpty
        .refine(
          (value) => /^https?:\/\/[^/]+\/?$/.test(value),
          "must be an http:// or https:// address without a path",
        )
        .optional(),
      "Separate origin, such as `https://files.wiki.example.com`, that serves attachment content and previews as an additional isolation layer. The reverse proxy must forward it to the API. Attachments are isolated without it as well.",
      { format: HTTP_ORIGIN },
    ),
  ]),
  ...topic("Collaboration", [
    setting(
      "LUNEDO_COLLAB_UPSTREAM",
      nonEmpty
        .refine(
          (value) => /^https?:\/\/[^/]+\/?$/.test(value),
          "must be an http:// or https:// address without a path",
        )
        .optional(),
      "Address of the collaboration server that the API forwards `/collab` to.",
      { format: HTTP_ORIGIN, defaultText: "`http://127.0.0.1:` and the collaboration port" },
    ),
    setting(
      "LUNEDO_REDIS_URL",
      nonEmpty
        .refine((value) => /^rediss?:\/\//.test(value), "must be a redis:// or rediss:// URL")
        .optional(),
      "Redis connection URL. Collaboration servers synchronize documents through it; it is needed only when more than one collaboration server runs, and then on every collaboration node. Any Redis-compatible server works, for example Valkey.",
      { secret: true, format: "A `redis://` or `rediss://` URL." },
    ),
  ]),
  ...topic("File storage and imports", [
    setting("LUNEDO_FILES_DIR", path.default("/var/lib/lunedo/files"), "Directory of the file store."),
    setting(
      "LUNEDO_FILE_STORAGE",
      z.enum(["local", "s3"]).default("local"),
      "Where attachments are stored: `local` in the file store directory, or `s3` in S3-compatible object storage. Attachments are encrypted in both cases.",
    ),
    setting(
      "LUNEDO_S3_BUCKET",
      nonEmpty.optional(),
      "Bucket for attachments; required when the file storage is `s3`.",
    ),
    setting(
      "LUNEDO_S3_ENDPOINT",
      nonEmpty
        .refine((value) => /^https?:\/\//.test(value), "must be an http:// or https:// address")
        .optional(),
      "Address of the S3-compatible service, for example `https://s3.example.com`. Leave it out for Amazon S3.",
      { format: "An `http://` or `https://` address." },
    ),
    setting("LUNEDO_S3_REGION", nonEmpty.default("us-east-1"), "Region of the bucket."),
    setting(
      "LUNEDO_S3_ACCESS_KEY_ID",
      nonEmpty.optional(),
      "Access key ID for the bucket. Without it, the usual AWS credential sources apply. Set it together with the secret access key.",
      { secret: true },
    ),
    setting("LUNEDO_S3_SECRET_ACCESS_KEY", nonEmpty.optional(), "Secret access key for the bucket.", {
      secret: true,
    }),
    setting(
      "LUNEDO_S3_FORCE_PATH_STYLE",
      booleanText.default("false").transform((value) => value === "true"),
      "`true` addresses the bucket in the path instead of the host name, as MinIO and some other services need.",
    ),
    setting(
      "LUNEDO_S3_PREFIX",
      z
        .string()
        .trim()
        .regex(/^([A-Za-z0-9._-]+\/)*$/, "must be empty or end with /")
        .default(""),
      "Prefix for all object names, for example `lunedo/`.",
      { format: "Empty, or names of letters, digits, `.`, `_` and `-`, each followed by `/`." },
    ),
    setting(
      "LUNEDO_IMPORT_DIR",
      path.default("/data/import"),
      "Import folder for large exports. Each organization has a subfolder named after its ID, shown with a copy button in the import wizard. Files placed directly inside it can be imported without uploading them. Symbolic links, further subfolders and files at the top level are ignored. Mount it read-only.",
    ),
  ]),
  ...topic("Keys and secrets", [
    setting(
      "LUNEDO_SECRETS_DIR",
      path.default("/var/lib/lunedo/secrets"),
      "Directory for secrets generated on first start: the master keys, the backup keys and the metrics token. Back it up separately from the backups.",
    ),
    setting("LUNEDO_KEY_PROVIDER", z.enum(["env", "file"]).optional(), "Source of the master keys.", {
      defaultText: "`env` when `LUNEDO_MASTER_KEYS` is set, `file` otherwise",
    }),
    setting(
      "LUNEDO_MASTER_KEYS",
      nonEmpty.optional(),
      "Master key ring for the `env` key provider: one `<version>:<base64 key>` entry per line, or separated by commas. Each key is 32 random bytes; the highest version encrypts new data.",
      { secret: true },
    ),
    setting("LUNEDO_MASTER_KEYS_PATH", path.optional(), "Master key ring file for the `file` key provider.", {
      defaultText: "`master-keys` in the secrets directory",
    }),
    setting(
      "LUNEDO_BACKUP_KEY",
      nonEmpty.optional(),
      "Key ring that encrypts backups, in the same format as the master keys.",
      { secret: true, defaultText: "generated in the secrets directory" },
    ),
    setting("LUNEDO_METRICS_TOKEN", nonEmpty.optional(), "Bearer token required by `/metrics`.", {
      secret: true,
      defaultText: "generated in the secrets directory",
    }),
  ]),
  ...topic("Backups", [
    setting(
      "LUNEDO_BACKUP_DIR",
      path.default("/var/lib/lunedo/backups"),
      "Default local backup target. Backups before updates go here while no target is set up in the backup settings.",
    ),
    setting(
      "LUNEDO_WORK_DIR",
      path.default("/var/lib/lunedo/work"),
      "Private directory (mode 0700) for temporary files of backups and test restores. A running backup stages its database dump here, encrypted under a key that exists only in memory; a test restore puts its copy of the file store here. It must not overlap with the backup directory, the file store, the secrets directory or the import folder, and no backup target may lie inside it. It needs free space for the database and, during a test restore, for the file store.",
    ),
    setting(
      "LUNEDO_BACKUP_BEFORE_UPDATE",
      booleanText.default("true").transform((value) => value === "true"),
      "`false` starts without a backup when migrations are pending, for installations with their own backup strategy. The backup settings and the status show that it is off.",
    ),
  ]),
  ...topic("Updates", [
    setting(
      "LUNEDO_UPDATE_CHECK",
      booleanText.default("true").transform((value) => value === "true"),
      "`false` turns the update check off completely: Lunedo then makes no request for it, and the instance setting cannot turn it on.",
    ),
    setting(
      "LUNEDO_UPDATE_CHECK_URL",
      nonEmpty
        .refine((value) => /^https?:\/\/[^\s]+$/.test(value), "must be an http:// or https:// address")
        .refine((value) => {
          try {
            const url = new URL(value);
            return url.username === "" && url.password === "";
          } catch {
            return false;
          }
        }, "must not contain a user name or password; the version file is public and needs no credentials")
        .refine((value) => {
          try {
            const url = new URL(value);
            return url.search === "" && url.hash === "";
          } catch {
            return false;
          }
        }, "must not contain a query string or fragment, such as a token; the version file is public")
        .default(DEFAULT_UPDATE_CHECK_URL),
      "Address of the version file the update check downloads, for example a mirror inside the company network. A private address must be listed in `LUNEDO_OUTBOUND_ALLOWED_NETWORKS`; a public one must use HTTPS.",
      {
        format: "An `http://` or `https://` address without a user name, password, query string or fragment.",
      },
    ),
    setting("LUNEDO_CHANGELOG_FILE", path.optional(), "Path of the changelog shown under What's new.", {
      defaultText: "`/app/CHANGELOG.md` in the image, `CHANGELOG.md` of the source tree otherwise",
    }),
    setting(
      "LUNEDO_INSTALL_METHOD",
      z.enum(installMethods).optional(),
      "How the instance was installed: `script` for the setup script, `compose` for a Compose file of your own, `other` for anything else. The setup script sets it; the admin area shows the update commands for it.",
    ),
    setting(
      "LUNEDO_INSTALL_DIR",
      path.optional(),
      "Directory on the host that holds the installation, shown in the update commands. The setup script sets it.",
    ),
  ]),
  ...topic("Outgoing connections", [
    setting(
      "LUNEDO_OUTBOUND_ALLOWED_NETWORKS",
      addressList,
      "Private networks that Lunedo may reach for chat channels, Confluence imports, the S3 backup target, the S3 restore in the setup assistant and the update check, for example a Matrix server or a MinIO in the local network. Requests to private, loopback and link-local addresses are refused otherwise, also after redirects and when a host name resolves to such an address. Addresses in these ranges may also use `http://`; public addresses need `https://`.",
      { format: ADDRESS_LIST },
    ),
  ]),
  ...topic("Rendering", [
    setting(
      "LUNEDO_RENDER_URL",
      nonEmpty
        .refine(
          (value) => /^https?:\/\/[^/?#]+\/?$/.test(value),
          "must be an http:// or https:// address without a path",
        )
        .optional(),
      "Address of the optional render container that creates PDF files on the server, for example `http://lunedo-render:3000`. Set it together with `LUNEDO_RENDER_TOKEN`.",
      { format: HTTP_ORIGIN },
    ),
    setting(
      "LUNEDO_RENDER_TOKEN",
      z.string().trim().min(32, "must have at least 32 characters").optional(),
      "Token the worker sends to the render container. Must be the same as `RENDER_TOKEN` of the container.",
      { secret: true },
    ),
  ]),
  ...topic("Sign-in", [
    setting(
      "LUNEDO_PASSWORD_HASH_CONCURRENCY",
      positiveInt.max(64).default(4),
      "Password hashes computed at once per process. Each needs about 19 MiB of memory; further sign-ins wait, and beyond a queue of 25 per slot they are rejected with `503`.",
    ),
    setting(
      "LUNEDO_INSECURE_IDENTITY_PROVIDERS",
      booleanText.default("false").transform((value) => value === "true"),
      "`true` allows identity providers reached without HTTPS, such as a local Keycloak. Only for development and tests; never set it in production.",
    ),
  ]),
  ...topic("Setup through configuration", [
    setting(
      "LUNEDO_SETUP_CODE",
      nonEmpty.optional(),
      "Setup code for the setup assistant. When set, Lunedo uses it instead of a generated code and does not print it. Ignored once setup is complete.",
      {
        secret: true,
        format: "At least 12 characters not counting spaces and hyphens, at most 64.",
        defaultText: "generated",
      },
    ),
    setting(
      "LUNEDO_INSTANCE_NAME",
      nonEmpty.optional(),
      "Name of the instance for setup through configuration.",
      {
        defaultText: "`Lunedo`",
      },
    ),
    setting(
      "LUNEDO_OWNER_EMAIL",
      nonEmpty.optional(),
      "E-mail address of the owner account for setup through configuration.",
      { format: "An e-mail address." },
    ),
    setting(
      "LUNEDO_OWNER_NAME",
      nonEmpty.optional(),
      "Name of the owner account for setup through configuration.",
    ),
    setting(
      "LUNEDO_OWNER_PASSWORD",
      nonEmpty.optional(),
      "Password of the owner account for setup through configuration.",
      { secret: true },
    ),
    setting(
      "LUNEDO_ORGANIZATION_NAME",
      nonEmpty.optional(),
      "Name of the first organization for setup through configuration.",
    ),
    setting(
      "LUNEDO_ORGANIZATION_LANGUAGE",
      z.enum(["en", "de"]).optional(),
      "Language of the first organization for setup through configuration.",
      { defaultText: "the language of the instance" },
    ),
    setting(
      "LUNEDO_ORGANIZATION_TIME_ZONE",
      nonEmpty.optional(),
      "Time zone of the first organization for setup through configuration.",
      {
        format: "An IANA time zone, for example `Europe/Vienna`.",
        defaultText: "the time zone of the instance",
      },
    ),
    setting(
      "LUNEDO_SMTP_HOST",
      nonEmpty.optional(),
      "SMTP server for outgoing e-mail, for setup through configuration.",
    ),
    setting("LUNEDO_SMTP_PORT", port.optional(), "SMTP port for setup through configuration.", {
      defaultText: "`587`, `465` with `tls`",
    }),
    setting(
      "LUNEDO_SMTP_SECURITY",
      z.enum(["tls", "starttls", "none"]).optional(),
      "SMTP connection security for setup through configuration. `none` cannot be combined with credentials.",
      { defaultText: "`starttls`" },
    ),
    setting(
      "LUNEDO_SMTP_USERNAME",
      nonEmpty.optional(),
      "SMTP user name for setup through configuration. Set it together with the password.",
    ),
    setting("LUNEDO_SMTP_PASSWORD", nonEmpty.optional(), "SMTP password for setup through configuration.", {
      secret: true,
    }),
    setting("LUNEDO_SMTP_FROM", nonEmpty.optional(), "Sender address for setup through configuration.", {
      format: "An e-mail address.",
    }),
  ]),
];

export type ConfigSettingName = string;
