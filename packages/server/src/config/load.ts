import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { instanceUrlSchema } from "../accounts/instance-settings.js";
import type { LogLevel } from "../logging/logger.js";

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

import { type ConfigSettingName, configSettings } from "./definitions.js";
import { Secret } from "./secret.js";

export type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  override name = "ConfigError";
}

export interface ServerConfig {
  host: string;
  ports: { api: number; collab: number; worker: number };
  logLevel: LogLevel;
  database: { url: Secret; poolSize: number };
  paths: { files: string; secrets: string; webRoot: string | undefined };
  keys: {
    provider: "env" | "file";
    /** Set for the env provider. */
    masterKeys: Secret | undefined;
    /** Used by the file provider. */
    masterKeysPath: string;
    backupKeys: Secret | undefined;
  };
  metricsToken: Secret | undefined;
  shutdownTimeoutSeconds: number;
  trustedProxies: string[];
  passwordHashConcurrency: number;
  setup: ConfiguredSetup | undefined;
}

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
      `PAGEHALL_CONFIG_FILE: cannot read ${file} (${(error as NodeJS.ErrnoException).code})`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ConfigError(`PAGEHALL_CONFIG_FILE: ${file} is not valid JSON`);
  }
  const parsed = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).safeParse(json);
  if (!parsed.success) {
    throw new ConfigError("PAGEHALL_CONFIG_FILE: must be a JSON object of strings, numbers and booleans");
  }
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    const base = key.endsWith("_FILE") && secretNames.has(key.slice(0, -5)) ? key.slice(0, -5) : key;
    if (!settingNames.has(base) || key === "PAGEHALL_CONFIG_FILE") {
      throw new ConfigError(`PAGEHALL_CONFIG_FILE: unknown setting ${key}`);
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
  const configFile = env.PAGEHALL_CONFIG_FILE?.trim();
  const fromFile = configFile ? readConfigFile(configFile) : {};
  const value = (key: string) => {
    const fromEnv = env[key];
    return fromEnv !== undefined && fromEnv !== "" ? fromEnv : fromFile[key];
  };

  const raw: Record<string, string | undefined> = { PAGEHALL_CONFIG_FILE: configFile };
  for (const setting of configSettings) {
    if (setting.name === "PAGEHALL_CONFIG_FILE") continue;
    const direct = value(setting.name);
    const file = setting.secret ? value(`${setting.name}_FILE`) : undefined;
    if (direct !== undefined && file !== undefined) {
      throw new ConfigError(`${setting.name}: set either ${setting.name} or ${setting.name}_FILE, not both`);
    }
    raw[setting.name] = file !== undefined ? readSecretFile(setting.name, file) : direct;
  }
  return raw;
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
    (values.PAGEHALL_KEY_PROVIDER as "env" | "file" | undefined) ??
    (values.PAGEHALL_MASTER_KEYS ? "env" : "file");
  if (provider === "env" && !values.PAGEHALL_MASTER_KEYS) {
    problems.push("PAGEHALL_MASTER_KEYS: is required when PAGEHALL_KEY_PROVIDER is env");
  }
  if (provider === "file" && values.PAGEHALL_MASTER_KEYS) {
    problems.push("PAGEHALL_MASTER_KEYS: is only used by the env key provider");
  }
  const setup = configuredSetup(values, problems);
  if (problems.length > 0) {
    throw new ConfigError(`Invalid configuration:\n  ${problems.join("\n  ")}`);
  }

  const secret = (name: ConfigSettingName) => {
    const value = values[name] as string | undefined;
    return value === undefined ? undefined : new Secret(value);
  };
  const secretsDir = values.PAGEHALL_SECRETS_DIR as string;

  return {
    host: values.PAGEHALL_HOST as string,
    ports: {
      api: values.PAGEHALL_API_PORT as number,
      collab: values.PAGEHALL_COLLAB_PORT as number,
      worker: values.PAGEHALL_WORKER_PORT as number,
    },
    logLevel: values.PAGEHALL_LOG_LEVEL as LogLevel,
    database: {
      url: secret("PAGEHALL_DATABASE_URL") as Secret,
      poolSize: values.PAGEHALL_DATABASE_POOL_SIZE as number,
    },
    paths: {
      files: values.PAGEHALL_FILES_DIR as string,
      secrets: secretsDir,
      webRoot: values.PAGEHALL_WEB_ROOT as string | undefined,
    },
    keys: {
      provider,
      masterKeys: secret("PAGEHALL_MASTER_KEYS"),
      masterKeysPath:
        (values.PAGEHALL_MASTER_KEYS_PATH as string | undefined) ?? path.join(secretsDir, "master-keys"),
      backupKeys: secret("PAGEHALL_BACKUP_KEY"),
    },
    metricsToken: secret("PAGEHALL_METRICS_TOKEN"),
    shutdownTimeoutSeconds: values.PAGEHALL_SHUTDOWN_TIMEOUT_SECONDS as number,
    trustedProxies: values.PAGEHALL_TRUSTED_PROXIES as string[],
    passwordHashConcurrency: values.PAGEHALL_PASSWORD_HASH_CONCURRENCY as number,
    setup,
  };
}

const SETUP_SETTINGS = [
  "PAGEHALL_INSTANCE_URL",
  "PAGEHALL_INSTANCE_NAME",
  "PAGEHALL_OWNER_EMAIL",
  "PAGEHALL_OWNER_NAME",
  "PAGEHALL_OWNER_PASSWORD",
  "PAGEHALL_ORGANIZATION_NAME",
  "PAGEHALL_ORGANIZATION_LANGUAGE",
  "PAGEHALL_ORGANIZATION_TIME_ZONE",
] as const;

const SMTP_SETTINGS = [
  "PAGEHALL_SMTP_HOST",
  "PAGEHALL_SMTP_PORT",
  "PAGEHALL_SMTP_SECURITY",
  "PAGEHALL_SMTP_USERNAME",
  "PAGEHALL_SMTP_PASSWORD",
  "PAGEHALL_SMTP_FROM",
] as const;

function configuredSetup(
  values: Record<ConfigSettingName, unknown>,
  problems: string[],
): ConfiguredSetup | undefined {
  const given = (names: readonly ConfigSettingName[]) => names.filter((name) => values[name] !== undefined);
  if (given([...SETUP_SETTINGS, ...SMTP_SETTINGS]).length === 0) return undefined;
  if (given(SETUP_SETTINGS).length === 0) {
    problems.push(
      "PAGEHALL_SMTP_HOST: SMTP settings in the configuration require setup through configuration",
    );
  }
  for (const name of [
    "PAGEHALL_INSTANCE_URL",
    "PAGEHALL_OWNER_EMAIL",
    "PAGEHALL_OWNER_NAME",
    "PAGEHALL_OWNER_PASSWORD",
    "PAGEHALL_ORGANIZATION_NAME",
  ] as const) {
    if (values[name] === undefined) problems.push(`${name}: is required for setup through configuration`);
  }
  const url = instanceUrlSchema.safeParse(values.PAGEHALL_INSTANCE_URL);
  if (values.PAGEHALL_INSTANCE_URL !== undefined && !url.success) {
    problems.push(`PAGEHALL_INSTANCE_URL: ${url.error.issues[0]?.message ?? "is invalid"}`);
  }
  const timeZone = values.PAGEHALL_ORGANIZATION_TIME_ZONE as string | undefined;
  if (timeZone !== undefined && !isTimeZone(timeZone)) {
    problems.push("PAGEHALL_ORGANIZATION_TIME_ZONE: must be an IANA time zone");
  }
  if (
    values.PAGEHALL_OWNER_EMAIL !== undefined &&
    !z.email().safeParse(values.PAGEHALL_OWNER_EMAIL).success
  ) {
    problems.push("PAGEHALL_OWNER_EMAIL: must be an e-mail address");
  }

  let smtp: ConfiguredSmtp | undefined;
  if (given(SMTP_SETTINGS).length > 0) {
    for (const name of ["PAGEHALL_SMTP_HOST", "PAGEHALL_SMTP_FROM"] as const) {
      if (values[name] === undefined) problems.push(`${name}: is required when SMTP is configured`);
    }
    if (values.PAGEHALL_SMTP_FROM !== undefined && !z.email().safeParse(values.PAGEHALL_SMTP_FROM).success) {
      problems.push("PAGEHALL_SMTP_FROM: must be an e-mail address");
    }
    const security = (values.PAGEHALL_SMTP_SECURITY as ConfiguredSmtp["security"] | undefined) ?? "starttls";
    const username = (values.PAGEHALL_SMTP_USERNAME as string | undefined) ?? null;
    const password = values.PAGEHALL_SMTP_PASSWORD as string | undefined;
    if ((password !== undefined) !== (username !== null)) {
      problems.push("PAGEHALL_SMTP_USERNAME: set together with PAGEHALL_SMTP_PASSWORD");
    }
    if (security === "none" && username !== null) {
      problems.push("PAGEHALL_SMTP_SECURITY: credentials require tls or starttls");
    }
    smtp = {
      host: values.PAGEHALL_SMTP_HOST as string,
      port: (values.PAGEHALL_SMTP_PORT as number | undefined) ?? (security === "tls" ? 465 : 587),
      security,
      username,
      password: password === undefined ? null : new Secret(password),
      from: values.PAGEHALL_SMTP_FROM as string,
    };
  }

  return {
    instanceUrl: url.success ? url.data : "",
    instanceName: values.PAGEHALL_INSTANCE_NAME as string | undefined,
    owner: {
      email: values.PAGEHALL_OWNER_EMAIL as string,
      name: values.PAGEHALL_OWNER_NAME as string,
      password: new Secret((values.PAGEHALL_OWNER_PASSWORD as string | undefined) ?? ""),
    },
    organization: {
      name: values.PAGEHALL_ORGANIZATION_NAME as string,
      language: values.PAGEHALL_ORGANIZATION_LANGUAGE as "en" | "de" | undefined,
      timeZone: values.PAGEHALL_ORGANIZATION_TIME_ZONE as string | undefined,
    },
    smtp,
  };
}
