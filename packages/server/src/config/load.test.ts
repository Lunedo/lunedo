import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./load.js";

const databaseUrl = "postgres://pagehall:s3cret@localhost:5432/pagehall";
let dir: string | undefined;

function tempDir(): string {
  dir = mkdtempSync(path.join(tmpdir(), "pagehall-config-"));
  return dir;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function expectConfigError(fn: () => unknown, message: string | RegExp) {
  expect(fn).toThrow(ConfigError);
  expect(fn).toThrow(message);
}

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig({ PAGEHALL_DATABASE_URL: databaseUrl });
    expect(config.host).toBe("0.0.0.0");
    expect(config.ports).toEqual({ api: 3000, collab: 3001, worker: 3002 });
    expect(config.logLevel).toBe("info");
    expect(config.database.poolSize).toBe(10);
    expect(config.database.url.reveal()).toBe(databaseUrl);
    expect(config.keys.provider).toBe("file");
    expect(config.keys.masterKeysPath).toBe(path.join("/var/lib/pagehall/secrets", "master-keys"));
    expect(config.metricsToken).toBeUndefined();
  });

  it("parses numbers and enums", () => {
    const config = loadConfig({
      PAGEHALL_DATABASE_URL: databaseUrl,
      PAGEHALL_API_PORT: "8080",
      PAGEHALL_LOG_LEVEL: "debug",
      PAGEHALL_DATABASE_POOL_SIZE: "25",
    });
    expect(config.ports.api).toBe(8080);
    expect(config.logLevel).toBe("debug");
    expect(config.database.poolSize).toBe(25);
  });

  it("names every invalid setting", () => {
    const load = () => loadConfig({ PAGEHALL_API_PORT: "70000", PAGEHALL_LOG_LEVEL: "verbose" });
    for (const problem of [
      "PAGEHALL_DATABASE_URL: is required",
      "PAGEHALL_API_PORT:",
      "PAGEHALL_LOG_LEVEL:",
    ]) {
      expectConfigError(load, problem);
    }
  });

  it("never includes secret values in errors or output", () => {
    const leaking = "postgres-but-not-a-url s3cret";
    let message = "";
    try {
      loadConfig({ PAGEHALL_DATABASE_URL: leaking });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("PAGEHALL_DATABASE_URL: is invalid");
    expect(message).not.toContain("s3cret");

    const config = loadConfig({ PAGEHALL_DATABASE_URL: databaseUrl, PAGEHALL_METRICS_TOKEN: "token-value" });
    const printed = `${JSON.stringify(config)} ${inspect(config)} ${String(config.database.url)}`;
    expect(printed).not.toContain("s3cret");
    expect(printed).not.toContain("token-value");
  });

  it("reads secrets from files", () => {
    const secretFile = path.join(tempDir(), "database-url");
    writeFileSync(secretFile, `${databaseUrl}\n`);
    const config = loadConfig({ PAGEHALL_DATABASE_URL_FILE: secretFile });
    expect(config.database.url.reveal()).toBe(databaseUrl);
  });

  it("rejects a secret given both directly and as a file", () => {
    const secretFile = path.join(tempDir(), "token");
    writeFileSync(secretFile, "a");
    expectConfigError(
      () =>
        loadConfig({
          PAGEHALL_DATABASE_URL: databaseUrl,
          PAGEHALL_METRICS_TOKEN: "b",
          PAGEHALL_METRICS_TOKEN_FILE: secretFile,
        }),
      "PAGEHALL_METRICS_TOKEN: set either",
    );
  });

  it("reports unreadable secret files by setting name", () => {
    expectConfigError(
      () => loadConfig({ PAGEHALL_DATABASE_URL_FILE: path.join(tempDir(), "missing") }),
      "PAGEHALL_DATABASE_URL_FILE: cannot read",
    );
  });

  it("reads the configuration file and lets the environment override it", () => {
    const file = path.join(tempDir(), "pagehall.json");
    writeFileSync(
      file,
      JSON.stringify({
        PAGEHALL_DATABASE_URL: databaseUrl,
        PAGEHALL_API_PORT: 4000,
        PAGEHALL_HOST: "127.0.0.1",
      }),
    );
    const config = loadConfig({ PAGEHALL_CONFIG_FILE: file, PAGEHALL_HOST: "::" });
    expect(config.ports.api).toBe(4000);
    expect(config.host).toBe("::");
    expect(config.database.url.reveal()).toBe(databaseUrl);
  });

  it("rejects unknown keys and invalid JSON in the configuration file", () => {
    const file = path.join(tempDir(), "pagehall.json");
    writeFileSync(file, JSON.stringify({ PAGEHALL_UNKNOWN: "x" }));
    expectConfigError(() => loadConfig({ PAGEHALL_CONFIG_FILE: file }), "unknown setting PAGEHALL_UNKNOWN");
    writeFileSync(file, "{ not json");
    expectConfigError(() => loadConfig({ PAGEHALL_CONFIG_FILE: file }), "is not valid JSON");
  });

  it("selects the key provider", () => {
    expect(
      loadConfig({ PAGEHALL_DATABASE_URL: databaseUrl, PAGEHALL_MASTER_KEYS: "1:abc" }).keys.provider,
    ).toBe("env");
    expectConfigError(
      () => loadConfig({ PAGEHALL_DATABASE_URL: databaseUrl, PAGEHALL_KEY_PROVIDER: "env" }),
      "PAGEHALL_MASTER_KEYS: is required when PAGEHALL_KEY_PROVIDER is env",
    );
    expectConfigError(
      () =>
        loadConfig({
          PAGEHALL_DATABASE_URL: databaseUrl,
          PAGEHALL_KEY_PROVIDER: "file",
          PAGEHALL_MASTER_KEYS: "1:abc",
        }),
      "only used by the env key provider",
    );
  });
});
