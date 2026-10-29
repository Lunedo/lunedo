import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { instanceUrlSchema } from "../accounts/instance-settings.js";
import type { LogLevel } from "../logging/logger.js";
import { resourcePath } from "../resources.js";

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

import { lunedoVersion } from "../operations/version.js";
import { type ConfigSettingName, configSettings, type InstallMethod } from "./definitions.js";
import { Secret } from "./secret.js";

export type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  override name = "ConfigError";
}

export function changelogFileOf(configured: string | undefined): string {
  return configured?.trim() || resourcePath("..", "..", "CHANGELOG.md");
}

export interface ServerConfig {
  host: string;
  ports: { api: number; collab: number; worker: number };
  collabUpstream: string;
  redisUrl: Secret | undefined;
  logLevel: LogLevel;
  database: { url: Secret; poolSize: number };
  paths: {
    files: string;
    secrets: string;
    webRoot: string | undefined;
    imports: string;
    backups: string;
    work: string;
  };
  backupBeforeUpdate: boolean;
  fileStorage: FileStorageConfig;
  filesUrl: string | undefined;
  keys: {
    provider: "env" | "file";
    /** Set for the env provider. */
    masterKeys: Secret | undefined;
    /** Used by the file provider. */
    masterKeysPath: string;
    backupKeys: Secret | undefined;
  };
  metricsToken: Secret | undefined;
  render: { url: string; token: Secret } | undefined;
  shutdownTimeoutSeconds: number;
  trustedProxies: string[];
  outboundAllowedNetworks: string[];
  passwordHashConcurrency: number;
  jobConcurrency: Readonly<Record<string, number>>;
  insecureIdentityProviders: boolean;
  setup: ConfiguredSetup | undefined;
  setupCode: Secret | undefined;
  instanceUrl: string | undefined;
  version: string;
  updates: {
    check: boolean;
    url: string;
    installMethod: InstallMethod | undefined;
    installDir: string | undefined;
    changelogFile: string;
  };
}

export type FileStorageConfig =
  | { kind: "local" }
  | {
      kind: "s3";
      bucket: string;
      endpoint: string | undefined;
      region: string;
      accessKeyId: Secret | undefined;
      secretAccessKey: Secret | undefined;
      forcePathStyle: boolean;
      prefix: string;
    };

export interface ConfiguredSmtp {
  host: string;
  port: number;
  security: "tls" | "starttls" | "none";
  username: string | null;
  password: Secret | null;
  from: string;
}

export interface ConfiguredSetup {
  instanceUrl: string;
  instanceName: string | undefined;
  owner: { email: string; name: string; password: Secret };
  organization: { name: string; language: "en" | "de" | undefined; timeZone: string | undefined };
  smtp: ConfiguredSmtp | undefined;
}

const settingNames = new Set<string>(configSettings.map((setting) => setting.name));
const secretNames = new Set<string>(configSettings.filter((s) => s.secret).map((s) => s.name));

function readConfigFile(file: string): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    throw new ConfigError(
      `LUNEDO_CONFIG_FILE: cannot read ${file} (${(error as NodeJS.ErrnoException).code})`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ConfigError(`LUNEDO_CONFIG_FILE: ${file} is not valid JSON`);
  }
  const parsed = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).safeParse(json);
  if (!parsed.success) {
    throw new ConfigError("LUNEDO_CONFIG_FILE: must be a JSON object of strings, numbers and booleans");
  }
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    const base = key.endsWith("_FILE") && secretNames.has(key.slice(0, -5)) ? key.slice(0, -5) : key;
    if (!settingNames.has(base) || key === "LUNEDO_CONFIG_FILE") {
      throw new ConfigError(`LUNEDO_CONFIG_FILE: unknown setting ${key}`);
    }
    values[key] = String(value);
  }
  return values;
}

function readSecretFile(name: string, file: string): string {
  try {
    return readFileSync(file, "utf8").replace(/\r?\n$/, "");
  } catch (error) {
    throw new ConfigError(`${name}_FILE: cannot read ${file} (${(error as NodeJS.ErrnoException).code})`);
  }
}

/** Merges environment variables over the optional configuration file. */
function collectRawValues(env: Env): Record<string, string | undefined> {
  const configFile = env.LUNEDO_CONFIG_FILE?.trim();
  const fromFile = configFile ? readConfigFile(configFile) : {};
  const value = (key: string) => {
    const fromEnv = env[key];
    return fromEnv !== undefined && fromEnv !== "" ? fromEnv : fromFile[key];
  };

  const raw: Record<string, string | undefined> = { LUNEDO_CONFIG_FILE: configFile };
  for (const setting of configSettings) {
    if (setting.name === "LUNEDO_CONFIG_FILE") continue;
    const direct = value(setting.name);
    const file = setting.secret ? value(`${setting.name}_FILE`) : undefined;
    if (direct !== undefined && file !== undefined) {
      throw new ConfigError(`${setting.name}: set either ${setting.name} or ${setting.name}_FILE, not both`);
    }
    raw[setting.name] = file !== undefined ? readSecretFile(setting.name, file) : direct;
  }
  return raw;
}

function overlaps(first: string, second: string): boolean {
  const inside = (parent: string, child: string) => {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };
  return inside(first, second) || inside(second, first);
}

function checkWorkDir(values: Record<ConfigSettingName, unknown>, problems: string[]): void {
  const work = values.LUNEDO_WORK_DIR as string | undefined;
  if (!work) return;
  for (const name of [
    "LUNEDO_BACKUP_DIR",
    "LUNEDO_FILES_DIR",
    "LUNEDO_SECRETS_DIR",
    "LUNEDO_IMPORT_DIR",
  ] as const) {
    const other = values[name] as string | undefined;
    if (other && overlaps(work, other)) {
      problems.push(
        `LUNEDO_WORK_DIR: must not overlap with ${name} (${other}); choose a directory of its own`,
      );
    }
  }
}

/**
 * Reads and validates the configuration. Every problem is reported with the name of the
 * setting; secret values never appear in messages.
 */
export function loadConfig(env: Env): ServerConfig {
  const raw = collectRawValues(env);
  const values = {} as Record<ConfigSettingName, unknown>;
  const problems: string[] = [];

  for (const setting of configSettings) {
    const result = setting.schema.safeParse(raw[setting.name]);
    if (result.success) {
      values[setting.name] = result.data;
    } else {
      const message = setting.secret ? "is invalid" : (result.error.issues[0]?.message ?? "is invalid");
      problems.push(
        raw[setting.name] === undefined ? `${setting.name}: is required` : `${setting.name}: ${message}`,
      );
    }
  }

  const provider =
    (values.LUNEDO_KEY_PROVIDER as "env" | "file" | undefined) ??
    (values.LUNEDO_MASTER_KEYS ? "env" : "file");
  if (provider === "env" && !values.LUNEDO_MASTER_KEYS) {
    problems.push("LUNEDO_MASTER_KEYS: is required when LUNEDO_KEY_PROVIDER is env");
  }
  if (provider === "file" && values.LUNEDO_MASTER_KEYS) {
    problems.push("LUNEDO_MASTER_KEYS: is only used by the env key provider");
  }
  if (values.LUNEDO_FILE_STORAGE === "s3" && !values.LUNEDO_S3_BUCKET) {
    problems.push("LUNEDO_S3_BUCKET: is required when LUNEDO_FILE_STORAGE is s3");
  }
  if (Boolean(values.LUNEDO_RENDER_URL) !== Boolean(values.LUNEDO_RENDER_TOKEN)) {
    problems.push("LUNEDO_RENDER_URL and LUNEDO_RENDER_TOKEN: set both or neither");
  }
  if (Boolean(values.LUNEDO_S3_ACCESS_KEY_ID) !== Boolean(values.LUNEDO_S3_SECRET_ACCESS_KEY)) {
    problems.push("LUNEDO_S3_ACCESS_KEY_ID and LUNEDO_S3_SECRET_ACCESS_KEY: set both or neither");
  }
  checkWorkDir(values, problems);
  const setup = configuredSetup(values, problems);
  checkSetupCode(values.LUNEDO_SETUP_CODE as string | undefined, problems);
  if (problems.length > 0) {
    throw new ConfigError(`Invalid configuration:\n  ${problems.join("\n  ")}`);
  }

  const secret = (name: ConfigSettingName) => {
    const value = values[name] as string | undefined;
    return value === undefined ? undefined : new Secret(value);
  };
  const secretsDir = values.LUNEDO_SECRETS_DIR as string;

  return {
    host: values.LUNEDO_HOST as string,
    ports: {
      api: values.LUNEDO_API_PORT as number,
      collab: values.LUNEDO_COLLAB_PORT as number,
      worker: values.LUNEDO_WORKER_PORT as number,
    },
    collabUpstream: (
      (values.LUNEDO_COLLAB_UPSTREAM as string | undefined) ??
      `http://127.0.0.1:${values.LUNEDO_COLLAB_PORT as number}`
    ).replace(/\/$/, ""),
    redisUrl: secret("LUNEDO_REDIS_URL"),
    logLevel: values.LUNEDO_LOG_LEVEL as LogLevel,
    database: {
      url: secret("LUNEDO_DATABASE_URL") as Secret,
      poolSize: values.LUNEDO_DATABASE_POOL_SIZE as number,
    },
    fileStorage:
      values.LUNEDO_FILE_STORAGE === "s3"
        ? {
            kind: "s3" as const,
            bucket: values.LUNEDO_S3_BUCKET as string,
            endpoint: values.LUNEDO_S3_ENDPOINT as string | undefined,
            region: values.LUNEDO_S3_REGION as string,
            accessKeyId: secret("LUNEDO_S3_ACCESS_KEY_ID"),
            secretAccessKey: secret("LUNEDO_S3_SECRET_ACCESS_KEY"),
            forcePathStyle: values.LUNEDO_S3_FORCE_PATH_STYLE as boolean,
            prefix: values.LUNEDO_S3_PREFIX as string,
          }
        : { kind: "local" as const },
    filesUrl: (values.LUNEDO_FILES_URL as string | undefined)?.replace(/\/$/, ""),
    paths: {
      files: values.LUNEDO_FILES_DIR as string,
      imports: values.LUNEDO_IMPORT_DIR as string,
      backups: values.LUNEDO_BACKUP_DIR as string,
      work: values.LUNEDO_WORK_DIR as string,
      secrets: secretsDir,
      webRoot: values.LUNEDO_WEB_ROOT as string | undefined,
    },
    keys: {
      provider,
      masterKeys: secret("LUNEDO_MASTER_KEYS"),
      masterKeysPath:
        (values.LUNEDO_MASTER_KEYS_PATH as string | undefined) ?? path.join(secretsDir, "master-keys"),
      backupKeys: secret("LUNEDO_BACKUP_KEY"),
    },
    backupBeforeUpdate: values.LUNEDO_BACKUP_BEFORE_UPDATE as boolean,
    metricsToken: secret("LUNEDO_METRICS_TOKEN"),
    render: values.LUNEDO_RENDER_URL
      ? {
          url: (values.LUNEDO_RENDER_URL as string).replace(/\/$/, ""),
          token: secret("LUNEDO_RENDER_TOKEN") as Secret,
        }
      : undefined,
    shutdownTimeoutSeconds: values.LUNEDO_SHUTDOWN_TIMEOUT_SECONDS as number,
    trustedProxies: values.LUNEDO_TRUSTED_PROXIES as string[],
    outboundAllowedNetworks: values.LUNEDO_OUTBOUND_ALLOWED_NETWORKS as string[],
    passwordHashConcurrency: values.LUNEDO_PASSWORD_HASH_CONCURRENCY as number,
    jobConcurrency: values.LUNEDO_JOB_CONCURRENCY as Record<string, number>,
    insecureIdentityProviders: values.LUNEDO_INSECURE_IDENTITY_PROVIDERS as boolean,
    setup,
    setupCode: secret("LUNEDO_SETUP_CODE"),
    instanceUrl: instanceUrlSchema.safeParse(values.LUNEDO_INSTANCE_URL).data,
    version: lunedoVersion(env),
    updates: {
      check: values.LUNEDO_UPDATE_CHECK as boolean,
      url: values.LUNEDO_UPDATE_CHECK_URL as string,
      installMethod: values.LUNEDO_INSTALL_METHOD as InstallMethod | undefined,
      installDir: values.LUNEDO_INSTALL_DIR as string | undefined,
      changelogFile: changelogFileOf(values.LUNEDO_CHANGELOG_FILE as string | undefined),
    },
  };
}

const SETUP_CODE_MIN_LENGTH = 12;
const SETUP_CODE_MAX_LENGTH = 64;

function checkSetupCode(code: string | undefined, problems: string[]): void {
  if (code === undefined) return;
  if (code.replace(/[\s-]/g, "").length < SETUP_CODE_MIN_LENGTH) {
    problems.push(
      `LUNEDO_SETUP_CODE: must have at least ${SETUP_CODE_MIN_LENGTH} characters, not counting spaces and hyphens`,
    );
  }
  if (code.length > SETUP_CODE_MAX_LENGTH) {
    problems.push(`LUNEDO_SETUP_CODE: must have at most ${SETUP_CODE_MAX_LENGTH} characters`);
  }
}

const SETUP_SETTINGS = [
  "LUNEDO_INSTANCE_NAME",
  "LUNEDO_OWNER_EMAIL",
  "LUNEDO_OWNER_NAME",
  "LUNEDO_OWNER_PASSWORD",
  "LUNEDO_ORGANIZATION_NAME",
  "LUNEDO_ORGANIZATION_LANGUAGE",
  "LUNEDO_ORGANIZATION_TIME_ZONE",
] as const;

const SMTP_SETTINGS = [
  "LUNEDO_SMTP_HOST",
  "LUNEDO_SMTP_PORT",
  "LUNEDO_SMTP_SECURITY",
  "LUNEDO_SMTP_USERNAME",
  "LUNEDO_SMTP_PASSWORD",
  "LUNEDO_SMTP_FROM",
] as const;

function checkInstanceUrl(values: Record<ConfigSettingName, unknown>, problems: string[]): void {
  const url = instanceUrlSchema.safeParse(values.LUNEDO_INSTANCE_URL);
  if (values.LUNEDO_INSTANCE_URL !== undefined && !url.success) {
    problems.push(`LUNEDO_INSTANCE_URL: ${url.error.issues[0]?.message ?? "is invalid"}`);
  }
}

function configuredSetup(
  values: Record<ConfigSettingName, unknown>,
  problems: string[],
): ConfiguredSetup | undefined {
  const given = (names: readonly ConfigSettingName[]) => names.filter((name) => values[name] !== undefined);
  if (given([...SETUP_SETTINGS, ...SMTP_SETTINGS]).length === 0) {
    checkInstanceUrl(values, problems);
    return undefined;
  }
  if (given(SETUP_SETTINGS).length === 0) {
    problems.push("LUNEDO_SMTP_HOST: SMTP settings in the configuration require setup through configuration");
  }
  for (const name of [
    "LUNEDO_INSTANCE_URL",
    "LUNEDO_OWNER_EMAIL",
    "LUNEDO_OWNER_NAME",
    "LUNEDO_OWNER_PASSWORD",
    "LUNEDO_ORGANIZATION_NAME",
  ] as const) {
    if (values[name] === undefined) problems.push(`${name}: is required for setup through configuration`);
  }
  const url = instanceUrlSchema.safeParse(values.LUNEDO_INSTANCE_URL);
  checkInstanceUrl(values, problems);
  const timeZone = values.LUNEDO_ORGANIZATION_TIME_ZONE as string | undefined;
  if (timeZone !== undefined && !isTimeZone(timeZone)) {
    problems.push("LUNEDO_ORGANIZATION_TIME_ZONE: must be an IANA time zone");
  }
  if (values.LUNEDO_OWNER_EMAIL !== undefined && !z.email().safeParse(values.LUNEDO_OWNER_EMAIL).success) {
    problems.push("LUNEDO_OWNER_EMAIL: must be an e-mail address");
  }

  let smtp: ConfiguredSmtp | undefined;
  if (given(SMTP_SETTINGS).length > 0) {
    for (const name of ["LUNEDO_SMTP_HOST", "LUNEDO_SMTP_FROM"] as const) {
      if (values[name] === undefined) problems.push(`${name}: is required when SMTP is configured`);
    }
    if (values.LUNEDO_SMTP_FROM !== undefined && !z.email().safeParse(values.LUNEDO_SMTP_FROM).success) {
      problems.push("LUNEDO_SMTP_FROM: must be an e-mail address");
    }
    const security = (values.LUNEDO_SMTP_SECURITY as ConfiguredSmtp["security"] | undefined) ?? "starttls";
    const username = (values.LUNEDO_SMTP_USERNAME as string | undefined) ?? null;
    const password = values.LUNEDO_SMTP_PASSWORD as string | undefined;
    if ((password !== undefined) !== (username !== null)) {
      problems.push("LUNEDO_SMTP_USERNAME: set together with LUNEDO_SMTP_PASSWORD");
    }
    if (security === "none" && username !== null) {
      problems.push("LUNEDO_SMTP_SECURITY: credentials require tls or starttls");
    }
    smtp = {
      host: values.LUNEDO_SMTP_HOST as string,
      port: (values.LUNEDO_SMTP_PORT as number | undefined) ?? (security === "tls" ? 465 : 587),
      security,
      username,
      password: password === undefined ? null : new Secret(password),
      from: values.LUNEDO_SMTP_FROM as string,
    };
  }

  return {
    instanceUrl: url.success ? url.data : "",
    instanceName: values.LUNEDO_INSTANCE_NAME as string | undefined,
    owner: {
      email: values.LUNEDO_OWNER_EMAIL as string,
      name: values.LUNEDO_OWNER_NAME as string,
      password: new Secret((values.LUNEDO_OWNER_PASSWORD as string | undefined) ?? ""),
    },
    organization: {
      name: values.LUNEDO_ORGANIZATION_NAME as string,
      language: values.LUNEDO_ORGANIZATION_LANGUAGE as "en" | "de" | undefined,
      timeZone: values.LUNEDO_ORGANIZATION_TIME_ZONE as string | undefined,
    },
    smtp,
  };
}
