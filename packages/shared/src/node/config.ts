import { type LogLevel, logLevels } from "./logger.js";

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  override name = "ConfigError";
}

export function readRequiredString(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`${name} is required`);
  return value;
}

export function readPort(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1 || port > 65535) {
    throw new ConfigError(`${name} must be a port number between 1 and 65535`);
  }
  return port;
}

export function readLogLevel(env: Env, name = "PAGEHALL_LOG_LEVEL"): LogLevel {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return "info";
  if (!(logLevels as readonly string[]).includes(raw)) {
    throw new ConfigError(`${name} must be one of ${logLevels.join(", ")}`);
  }
  return raw as LogLevel;
}

export interface ServiceConfig {
  host: string;
  port: number;
  logLevel: LogLevel;
  databaseUrl: string;
}

/** Settings every server process reads. Each role listens on its own port so that `all` can run them together. */
export function readServiceConfig(env: Env, portName: string, defaultPort: number): ServiceConfig {
  return {
    host: env.PAGEHALL_HOST?.trim() || "0.0.0.0",
    port: readPort(env, portName, defaultPort),
    logLevel: readLogLevel(env),
    databaseUrl: readRequiredString(env, "PAGEHALL_DATABASE_URL"),
  };
}
