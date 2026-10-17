import { readFileSync } from "node:fs";

export interface RenderConfig {
  token: string;
  host: string;
  port: number;
  concurrency: number;
  maxWaiting: number;
  maxBytes: number;
  timeoutSeconds: number;
  executablePath: string | undefined;
  viewerDirectory: string;
  sandbox: boolean;
}

export const MIN_TOKEN_LENGTH = 32;

export class RenderConfigError extends Error {
  override name = "RenderConfigError";
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new RenderConfigError(`${name} must be a whole number from ${min} to ${max}`);
  }
  return parsed;
}

function token(env: NodeJS.ProcessEnv): string {
  const file = env.RENDER_TOKEN_FILE;
  const value = (file ? readFileSync(file, "utf8") : (env.RENDER_TOKEN ?? "")).trim();
  if (value.length < MIN_TOKEN_LENGTH) {
    throw new RenderConfigError(
      `RENDER_TOKEN must have at least ${MIN_TOKEN_LENGTH} characters; generate one with "openssl rand -hex 32"`,
    );
  }
  return value;
}

export function loadRenderConfig(env: NodeJS.ProcessEnv): RenderConfig {
  const concurrency = integer(env, "RENDER_CONCURRENCY", 2, 1, 16);
  return {
    token: token(env),
    host: env.RENDER_HOST || "0.0.0.0",
    port: integer(env, "RENDER_PORT", 3000, 1, 65535),
    concurrency,
    maxWaiting: integer(env, "RENDER_MAX_WAITING", concurrency * 10, 0, 1000),
    maxBytes: integer(env, "RENDER_MAX_MEGABYTES", 200, 1, 2048) * 1024 * 1024,
    timeoutSeconds: integer(env, "RENDER_TIMEOUT_SECONDS", 300, 5, 3600),
    executablePath: env.RENDER_BROWSER || undefined,
    viewerDirectory: env.RENDER_VIEWER_DIR || "/app/viewer",
    sandbox: env.RENDER_CHROMIUM_SANDBOX === "true",
  };
}
