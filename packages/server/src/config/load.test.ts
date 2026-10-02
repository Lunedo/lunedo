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

  it("reads the setup code from the environment or a file", () => {
    expect(loadConfig({ PAGEHALL_DATABASE_URL: databaseUrl }).setupCode).toBeUndefined();
    const direct = loadConfig({ PAGEHALL_DATABASE_URL: databaseUrl, PAGEHALL_SETUP_CODE: "abcd-efgh-ijkl" });
    expect(direct.setupCode?.reveal()).toBe("abcd-efgh-ijkl");
    const secretFile = path.join(tempDir(), "setup-code");
    writeFileSync(secretFile, "a long configured setup code\n");
    const fromFile = loadConfig({ PAGEHALL_DATABASE_URL: databaseUrl, PAGEHALL_SETUP_CODE_FILE: secretFile });
    expect(fromFile.setupCode?.reveal()).toBe("a long configured setup code");
  });

  it("stops on a setup code that is too short or too long without showing it", () => {
    let message = "";
    try {
      loadConfig({ PAGEHALL_DATABASE_URL: databaseUrl, PAGEHALL_SETUP_CODE: "hidden-- -x" });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain(
      "PAGEHALL_SETUP_CODE: must have at least 12 characters, not counting spaces and hyphens",
    );
    expect(message).not.toContain("hidden");
    expectConfigError(
      () => loadConfig({ PAGEHALL_DATABASE_URL: databaseUrl, PAGEHALL_SETUP_CODE: "ab cd ef gh ij k" }),
      "PAGEHALL_SETUP_CODE: must have at least 12 characters",
    );
    const counted = loadConfig({ PAGEHALL_DATABASE_URL: databaseUrl, PAGEHALL_SETUP_CODE: "ssss-ssss-ssss" });
    expect(counted.setupCode?.reveal()).toBe("ssss-ssss-ssss");
    expectConfigError(
      () => loadConfig({ PAGEHALL_DATABASE_URL: databaseUrl, PAGEHALL_SETUP_CODE: "x".repeat(65) }),
      "PAGEHALL_SETUP_CODE: must have at most 64 characters",
    );
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

describe("loadConfig for sign-in and setup", () => {
  const base = { PAGEHALL_DATABASE_URL: databaseUrl };

  it("reads trusted proxies and rejects invalid entries", () => {
    expect(loadConfig(base).trustedProxies).toEqual([]);
    expect(
      loadConfig({ ...base, PAGEHALL_TRUSTED_PROXIES: "10.0.0.0/8, 2001:db8::/32 ,192.0.2.1" })
        .trustedProxies,
    ).toEqual(["10.0.0.0/8", "2001:db8::/32", "192.0.2.1"]);
    for (const invalid of ["10.0.0.0/33", "proxy.example.org", "10.0.0.1/8/1", "::1/129"]) {
      expectConfigError(
        () => loadConfig({ ...base, PAGEHALL_TRUSTED_PROXIES: invalid }),
        "PAGEHALL_TRUSTED_PROXIES",
      );
    }
  });

  it("has no setup values unless they are configured", () => {
    expect(loadConfig(base).setup).toBeUndefined();
  });

  it("reads setup values, with SMTP defaults", () => {
    const config = loadConfig({
      ...base,
      PAGEHALL_INSTANCE_URL: "https://wiki.example.org",
      PAGEHALL_OWNER_EMAIL: "owner@example.org",
      PAGEHALL_OWNER_NAME: "Owner",
      PAGEHALL_OWNER_PASSWORD: "owner-password-value",
      PAGEHALL_ORGANIZATION_NAME: "Docs team",
      PAGEHALL_SMTP_HOST: "smtp.example.org",
      PAGEHALL_SMTP_USERNAME: "wiki",
      PAGEHALL_SMTP_PASSWORD: "smtp-password-value",
      PAGEHALL_SMTP_FROM: "wiki@example.org",
    });
    expect(config.setup).toMatchObject({
      instanceUrl: "https://wiki.example.org",
      instanceName: undefined,
      owner: { email: "owner@example.org", name: "Owner" },
      smtp: {
        host: "smtp.example.org",
        port: 587,
        security: "starttls",
        username: "wiki",
        from: "wiki@example.org",
      },
    });
    expect(config.setup?.owner.password.reveal()).toBe("owner-password-value");
    const printed = `${JSON.stringify(config)} ${inspect(config)}`;
    expect(printed).not.toContain("owner-password-value");
    expect(printed).not.toContain("smtp-password-value");
  });

  it("requires the instance URL and the owner together and validates them", () => {
    expectConfigError(
      () => loadConfig({ ...base, PAGEHALL_OWNER_EMAIL: "owner@example.org" }),
      /PAGEHALL_INSTANCE_URL: is required for setup through configuration[\s\S]*PAGEHALL_OWNER_PASSWORD: is required/,
    );
    expectConfigError(
      () =>
        loadConfig({
          ...base,
          PAGEHALL_INSTANCE_URL: "https://wiki.example.org/path",
          PAGEHALL_OWNER_EMAIL: "not an address",
          PAGEHALL_OWNER_NAME: "Owner",
          PAGEHALL_OWNER_PASSWORD: "secret-owner-password",
        }),
      /PAGEHALL_INSTANCE_URL: must be an http or https origin[\s\S]*PAGEHALL_OWNER_EMAIL: must be an e-mail address/,
    );
    expectConfigError(
      () =>
        loadConfig({
          ...base,
          PAGEHALL_SMTP_HOST: "smtp.example.org",
          PAGEHALL_SMTP_FROM: "wiki@example.org",
        }),
      "SMTP settings in the configuration require setup through configuration",
    );
  });

  it("takes the instance URL alone as the address without setup through configuration", () => {
    const config = loadConfig({ ...base, PAGEHALL_INSTANCE_URL: "https://wiki.example.org" });
    expect(config.setup).toBeUndefined();
    expect(config.instanceUrl).toBe("https://wiki.example.org");
    expect(loadConfig(base).instanceUrl).toBeUndefined();
    expectConfigError(
      () => loadConfig({ ...base, PAGEHALL_INSTANCE_URL: "https://wiki.example.org/path" }),
      "PAGEHALL_INSTANCE_URL: must be an http or https origin",
    );
    expectConfigError(
      () =>
        loadConfig({
          ...base,
          PAGEHALL_INSTANCE_URL: "https://wiki.example.org",
          PAGEHALL_SMTP_HOST: "smtp.example.org",
          PAGEHALL_SMTP_FROM: "wiki@example.org",
        }),
      "SMTP settings in the configuration require setup through configuration",
    );
  });

  it("reads and validates the first organization", () => {
    const setup = {
      ...base,
      PAGEHALL_INSTANCE_URL: "https://wiki.example.org",
      PAGEHALL_OWNER_EMAIL: "owner@example.org",
      PAGEHALL_OWNER_NAME: "Owner",
      PAGEHALL_OWNER_PASSWORD: "owner-password-value",
    };
    expectConfigError(
      () => loadConfig(setup),
      "PAGEHALL_ORGANIZATION_NAME: is required for setup through configuration",
    );
    expect(
      loadConfig({
        ...setup,
        PAGEHALL_ORGANIZATION_NAME: "Docs team",
        PAGEHALL_ORGANIZATION_LANGUAGE: "de",
        PAGEHALL_ORGANIZATION_TIME_ZONE: "Europe/Vienna",
      }).setup?.organization,
    ).toEqual({ name: "Docs team", language: "de", timeZone: "Europe/Vienna" });
    expectConfigError(
      () =>
        loadConfig({
          ...setup,
          PAGEHALL_ORGANIZATION_NAME: "Docs",
          PAGEHALL_ORGANIZATION_TIME_ZONE: "Mars/Olympus",
        }),
      "PAGEHALL_ORGANIZATION_TIME_ZONE: must be an IANA time zone",
    );
  });

  it("rejects SMTP credentials without TLS and a password without a user name", () => {
    const setup = {
      ...base,
      PAGEHALL_INSTANCE_URL: "https://wiki.example.org",
      PAGEHALL_OWNER_EMAIL: "owner@example.org",
      PAGEHALL_OWNER_NAME: "Owner",
      PAGEHALL_OWNER_PASSWORD: "owner-password-value",
      PAGEHALL_ORGANIZATION_NAME: "Docs team",
      PAGEHALL_SMTP_HOST: "smtp.example.org",
      PAGEHALL_SMTP_FROM: "wiki@example.org",
    };
    expectConfigError(
      () =>
        loadConfig({
          ...setup,
          PAGEHALL_SMTP_SECURITY: "none",
          PAGEHALL_SMTP_USERNAME: "wiki",
          PAGEHALL_SMTP_PASSWORD: "x",
        }),
      "PAGEHALL_SMTP_SECURITY: credentials require tls or starttls",
    );
    expectConfigError(
      () => loadConfig({ ...setup, PAGEHALL_SMTP_PASSWORD: "x" }),
      "PAGEHALL_SMTP_USERNAME: set together with PAGEHALL_SMTP_PASSWORD",
    );
    expect(loadConfig({ ...setup, PAGEHALL_SMTP_SECURITY: "tls" }).setup?.smtp?.port).toBe(465);
  });
});
