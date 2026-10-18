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

function sandbox(env: NodeJS.ProcessEnv): boolean {
  const value = env.RENDER_CHROMIUM_SANDBOX;
  if (value === undefined || value === "" || value === "true") return true;
  if (value === "false") return false;
  throw new RenderConfigError("RENDER_CHROMIUM_SANDBOX must be true or false");
}

export function sandboxWarning(config: Pick<RenderConfig, "sandbox">): string | null {
  return config.sandbox
    ? null
    : "Chromium runs without its sandbox because RENDER_CHROMIUM_SANDBOX is false. A flaw in Chromium could then run code with the rights of this container. Allow user namespaces as described in the rendering documentation and remove the setting.";
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
    sandbox: sandbox(env),
  };
}
