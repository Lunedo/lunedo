import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { defaultPoolSize } from "../database/pool-size.js";
import { ConfigError, loadConfig } from "./load.js";

const databaseUrl = "postgres://lunedo:s3cret@localhost:5432/lunedo";
let dir: string | undefined;

function tempDir(): string {
  dir = mkdtempSync(path.join(tmpdir(), "lunedo-config-"));
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
    const config = loadConfig({ LUNEDO_DATABASE_URL: databaseUrl });
    expect(config.host).toBe("0.0.0.0");
    expect(config.ports).toEqual({ api: 3000, collab: 3001, worker: 3002 });
    expect(config.logLevel).toBe("info");
    expect(config.database.poolSize).toBe(defaultPoolSize(availableParallelism()));
    expect(config.database.url.reveal()).toBe(databaseUrl);
    expect(config.keys.provider).toBe("file");
    expect(config.keys.masterKeysPath).toBe(path.join("/var/lib/lunedo/secrets", "master-keys"));
    expect(config.metricsToken).toBeUndefined();
  });

  it("parses numbers and enums", () => {
    const config = loadConfig({
      LUNEDO_DATABASE_URL: databaseUrl,
      LUNEDO_API_PORT: "8080",
      LUNEDO_LOG_LEVEL: "debug",
      LUNEDO_DATABASE_POOL_SIZE: "25",
    });
    expect(config.ports.api).toBe(8080);
    expect(config.logLevel).toBe("debug");
    expect(config.database.poolSize).toBe(25);
  });

  it("splits the default pool among the API processes and keeps a pool size that is set", () => {
    const split = loadConfig({ LUNEDO_DATABASE_URL: databaseUrl, LUNEDO_API_PROCESSES: "4" });
    expect(split.apiProcesses).toBe(4);
    expect(split.database.apiPoolSize).toBe(Math.max(8, Math.ceil(split.database.poolSize / 4)));
    const set = loadConfig({
      LUNEDO_DATABASE_URL: databaseUrl,
      LUNEDO_API_PROCESSES: "4",
      LUNEDO_DATABASE_POOL_SIZE: "12",
    });
    expect(set.database.apiPoolSize).toBe(12);
    const single = loadConfig({ LUNEDO_DATABASE_URL: databaseUrl, LUNEDO_API_PROCESSES: "1" });
    expect(single.database.apiPoolSize).toBe(single.database.poolSize);
    expect(() => loadConfig({ LUNEDO_DATABASE_URL: databaseUrl, LUNEDO_API_PROCESSES: "0" })).toThrow(
      /LUNEDO_API_PROCESSES/,
    );
  });

  it("reads the jobs that a queue runs at once and leaves other queues to the CPU count", () => {
    expect(loadConfig({ LUNEDO_DATABASE_URL: databaseUrl }).jobConcurrency).toEqual({});
    expect(
      loadConfig({
        LUNEDO_DATABASE_URL: databaseUrl,
        LUNEDO_JOB_CONCURRENCY: " search.update-index=8, files.create-display-versions=2 ",
      }).jobConcurrency,
    ).toEqual({ "search.update-index": 8, "files.create-display-versions": 2 });
    for (const value of [
      "mail.deliver=4",
      "search.update-index=0",
      "search.update-index=65",
      "search.update-index",
    ]) {
      expectConfigError(
        () => loadConfig({ LUNEDO_DATABASE_URL: databaseUrl, LUNEDO_JOB_CONCURRENCY: value }),
        "LUNEDO_JOB_CONCURRENCY:",
      );
    }
  });

  it("names every invalid setting", () => {
    const load = () => loadConfig({ LUNEDO_API_PORT: "70000", LUNEDO_LOG_LEVEL: "verbose" });
    for (const problem of ["LUNEDO_DATABASE_URL: is required", "LUNEDO_API_PORT:", "LUNEDO_LOG_LEVEL:"]) {
      expectConfigError(load, problem);
    }
  });

  it("refuses an update check address with credentials or a query string", () => {
    const load = (url: string) => () =>
      loadConfig({ LUNEDO_DATABASE_URL: databaseUrl, LUNEDO_UPDATE_CHECK_URL: url });
    expectConfigError(load("https://user:secret@mirror.example.org/v.json"), /must not contain a user name/);
    expectConfigError(load("https://mirror.example.org/v.json?token=abc"), /must not contain a query string/);
    expect(load("https://mirror.example.org/lunedo/v.json")().updates.url).toBe(
      "https://mirror.example.org/lunedo/v.json",
    );
  });

  it("refuses a work directory that overlaps the backup directory or the file store", () => {
    const load = (work: string) => () =>
      loadConfig({ LUNEDO_DATABASE_URL: databaseUrl, LUNEDO_WORK_DIR: work });
    expectConfigError(
      load("/var/lib/lunedo/backups/work"),
      /LUNEDO_WORK_DIR: must not overlap with LUNEDO_BACKUP_DIR/,
    );
    expectConfigError(load("/var/lib/lunedo"), /must not overlap with LUNEDO_FILES_DIR/);
    expect(load("/var/lib/lunedo/work")().paths.work).toBe("/var/lib/lunedo/work");
  });

  it("never includes secret values in errors or output", () => {
    const leaking = "postgres-but-not-a-url s3cret";
    let message = "";
    try {
      loadConfig({ LUNEDO_DATABASE_URL: leaking });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("LUNEDO_DATABASE_URL: is invalid");
    expect(message).not.toContain("s3cret");

    const config = loadConfig({ LUNEDO_DATABASE_URL: databaseUrl, LUNEDO_METRICS_TOKEN: "token-value" });
    const printed = `${JSON.stringify(config)} ${inspect(config)} ${String(config.database.url)}`;
    expect(printed).not.toContain("s3cret");
    expect(printed).not.toContain("token-value");
  });

  it("reads secrets from files", () => {
    const secretFile = path.join(tempDir(), "database-url");
    writeFileSync(secretFile, `${databaseUrl}\n`);
    const config = loadConfig({ LUNEDO_DATABASE_URL_FILE: secretFile });
    expect(config.database.url.reveal()).toBe(databaseUrl);
  });

  it("reads the setup code from the environment or a file", () => {
    expect(loadConfig({ LUNEDO_DATABASE_URL: databaseUrl }).setupCode).toBeUndefined();
    const direct = loadConfig({ LUNEDO_DATABASE_URL: databaseUrl, LUNEDO_SETUP_CODE: "abcd-efgh-ijkl" });
    expect(direct.setupCode?.reveal()).toBe("abcd-efgh-ijkl");
    const secretFile = path.join(tempDir(), "setup-code");
    writeFileSync(secretFile, "a long configured setup code\n");
    const fromFile = loadConfig({ LUNEDO_DATABASE_URL: databaseUrl, LUNEDO_SETUP_CODE_FILE: secretFile });
    expect(fromFile.setupCode?.reveal()).toBe("a long configured setup code");
  });

  it("stops on a setup code that is too short or too long without showing it", () => {
    let message = "";
    try {
      loadConfig({ LUNEDO_DATABASE_URL: databaseUrl, LUNEDO_SETUP_CODE: "hidden-- -x" });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain(
      "LUNEDO_SETUP_CODE: must have at least 12 characters, not counting spaces and hyphens",
    );
    expect(message).not.toContain("hidden");
    expectConfigError(
      () => loadConfig({ LUNEDO_DATABASE_URL: databaseUrl, LUNEDO_SETUP_CODE: "ab cd ef gh ij k" }),
      "LUNEDO_SETUP_CODE: must have at least 12 characters",
    );
    const counted = loadConfig({ LUNEDO_DATABASE_URL: databaseUrl, LUNEDO_SETUP_CODE: "ssss-ssss-ssss" });
    expect(counted.setupCode?.reveal()).toBe("ssss-ssss-ssss");
    expectConfigError(
      () => loadConfig({ LUNEDO_DATABASE_URL: databaseUrl, LUNEDO_SETUP_CODE: "x".repeat(65) }),
      "LUNEDO_SETUP_CODE: must have at most 64 characters",
    );
  });

  it("rejects a secret given both directly and as a file", () => {
    const secretFile = path.join(tempDir(), "token");
    writeFileSync(secretFile, "a");
    expectConfigError(
      () =>
        loadConfig({
          LUNEDO_DATABASE_URL: databaseUrl,
          LUNEDO_METRICS_TOKEN: "b",
          LUNEDO_METRICS_TOKEN_FILE: secretFile,
        }),
      "LUNEDO_METRICS_TOKEN: set either",
    );
  });

  it("reports unreadable secret files by setting name", () => {
    expectConfigError(
      () => loadConfig({ LUNEDO_DATABASE_URL_FILE: path.join(tempDir(), "missing") }),
      "LUNEDO_DATABASE_URL_FILE: cannot read",
    );
  });

  it("reads the configuration file and lets the environment override it", () => {
    const file = path.join(tempDir(), "lunedo.json");
    writeFileSync(
      file,
      JSON.stringify({
        LUNEDO_DATABASE_URL: databaseUrl,
        LUNEDO_API_PORT: 4000,
        LUNEDO_HOST: "127.0.0.1",
      }),
    );
    const config = loadConfig({ LUNEDO_CONFIG_FILE: file, LUNEDO_HOST: "::" });
    expect(config.ports.api).toBe(4000);
    expect(config.host).toBe("::");
    expect(config.database.url.reveal()).toBe(databaseUrl);
  });

  it("rejects unknown keys and invalid JSON in the configuration file", () => {
    const file = path.join(tempDir(), "lunedo.json");
    writeFileSync(file, JSON.stringify({ LUNEDO_UNKNOWN: "x" }));
    expectConfigError(() => loadConfig({ LUNEDO_CONFIG_FILE: file }), "unknown setting LUNEDO_UNKNOWN");
    writeFileSync(file, "{ not json");
    expectConfigError(() => loadConfig({ LUNEDO_CONFIG_FILE: file }), "is not valid JSON");
  });

  it("selects the key provider", () => {
    expect(loadConfig({ LUNEDO_DATABASE_URL: databaseUrl, LUNEDO_MASTER_KEYS: "1:abc" }).keys.provider).toBe(
      "env",
    );
    expectConfigError(
      () => loadConfig({ LUNEDO_DATABASE_URL: databaseUrl, LUNEDO_KEY_PROVIDER: "env" }),
      "LUNEDO_MASTER_KEYS: is required when LUNEDO_KEY_PROVIDER is env",
    );
    expectConfigError(
      () =>
        loadConfig({
          LUNEDO_DATABASE_URL: databaseUrl,
          LUNEDO_KEY_PROVIDER: "file",
          LUNEDO_MASTER_KEYS: "1:abc",
        }),
      "only used by the env key provider",
    );
  });
});

describe("loadConfig for sign-in and setup", () => {
  const base = { LUNEDO_DATABASE_URL: databaseUrl };

  it("reads trusted proxies and rejects invalid entries", () => {
    expect(loadConfig(base).trustedProxies).toEqual([]);
    expect(
      loadConfig({ ...base, LUNEDO_TRUSTED_PROXIES: "10.0.0.0/8, 2001:db8::/32 ,192.0.2.1" }).trustedProxies,
    ).toEqual(["10.0.0.0/8", "2001:db8::/32", "192.0.2.1"]);
    for (const invalid of ["10.0.0.0/33", "proxy.example.org", "10.0.0.1/8/1", "::1/129"]) {
      expectConfigError(
        () => loadConfig({ ...base, LUNEDO_TRUSTED_PROXIES: invalid }),
        "LUNEDO_TRUSTED_PROXIES",
      );
    }
  });

  it("has no setup values unless they are configured", () => {
    expect(loadConfig(base).setup).toBeUndefined();
  });

  it("reads setup values, with SMTP defaults", () => {
    const config = loadConfig({
      ...base,
      LUNEDO_INSTANCE_URL: "https://wiki.example.org",
      LUNEDO_OWNER_EMAIL: "owner@example.org",
      LUNEDO_OWNER_NAME: "Owner",
      LUNEDO_OWNER_PASSWORD: "owner-password-value",
      LUNEDO_ORGANIZATION_NAME: "Docs team",
      LUNEDO_SMTP_HOST: "smtp.example.org",
      LUNEDO_SMTP_USERNAME: "wiki",
      LUNEDO_SMTP_PASSWORD: "smtp-password-value",
      LUNEDO_SMTP_FROM: "wiki@example.org",
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
      () => loadConfig({ ...base, LUNEDO_OWNER_EMAIL: "owner@example.org" }),
      /LUNEDO_INSTANCE_URL: is required for setup through configuration[\s\S]*LUNEDO_OWNER_PASSWORD: is required/,
    );
    expectConfigError(
      () =>
        loadConfig({
          ...base,
          LUNEDO_INSTANCE_URL: "https://wiki.example.org/path",
          LUNEDO_OWNER_EMAIL: "not an address",
          LUNEDO_OWNER_NAME: "Owner",
          LUNEDO_OWNER_PASSWORD: "secret-owner-password",
        }),
      /LUNEDO_INSTANCE_URL: must be an http or https origin[\s\S]*LUNEDO_OWNER_EMAIL: must be an e-mail address/,
    );
    expectConfigError(
      () =>
        loadConfig({
          ...base,
          LUNEDO_SMTP_HOST: "smtp.example.org",
          LUNEDO_SMTP_FROM: "wiki@example.org",
        }),
      "SMTP settings in the configuration require setup through configuration",
    );
  });

  it("takes the instance URL alone as the address without setup through configuration", () => {
    const config = loadConfig({ ...base, LUNEDO_INSTANCE_URL: "https://wiki.example.org" });
    expect(config.setup).toBeUndefined();
    expect(config.instanceUrl).toBe("https://wiki.example.org");
    expect(loadConfig(base).instanceUrl).toBeUndefined();
    expectConfigError(
      () => loadConfig({ ...base, LUNEDO_INSTANCE_URL: "https://wiki.example.org/path" }),
      "LUNEDO_INSTANCE_URL: must be an http or https origin",
    );
    expectConfigError(
      () =>
        loadConfig({
          ...base,
          LUNEDO_INSTANCE_URL: "https://wiki.example.org",
          LUNEDO_SMTP_HOST: "smtp.example.org",
          LUNEDO_SMTP_FROM: "wiki@example.org",
        }),
      "SMTP settings in the configuration require setup through configuration",
    );
  });

  it("reads and validates the first organization", () => {
    const setup = {
      ...base,
      LUNEDO_INSTANCE_URL: "https://wiki.example.org",
      LUNEDO_OWNER_EMAIL: "owner@example.org",
      LUNEDO_OWNER_NAME: "Owner",
      LUNEDO_OWNER_PASSWORD: "owner-password-value",
    };
    expectConfigError(
      () => loadConfig(setup),
      "LUNEDO_ORGANIZATION_NAME: is required for setup through configuration",
    );
    expect(
      loadConfig({
        ...setup,
        LUNEDO_ORGANIZATION_NAME: "Docs team",
        LUNEDO_ORGANIZATION_LANGUAGE: "de",
        LUNEDO_ORGANIZATION_TIME_ZONE: "Europe/Vienna",
      }).setup?.organization,
    ).toEqual({ name: "Docs team", language: "de", timeZone: "Europe/Vienna" });
    expectConfigError(
      () =>
        loadConfig({
          ...setup,
          LUNEDO_ORGANIZATION_NAME: "Docs",
          LUNEDO_ORGANIZATION_TIME_ZONE: "Mars/Olympus",
        }),
      "LUNEDO_ORGANIZATION_TIME_ZONE: must be an IANA time zone",
    );
  });

  it("rejects SMTP credentials without TLS and a password without a user name", () => {
    const setup = {
      ...base,
      LUNEDO_INSTANCE_URL: "https://wiki.example.org",
      LUNEDO_OWNER_EMAIL: "owner@example.org",
      LUNEDO_OWNER_NAME: "Owner",
      LUNEDO_OWNER_PASSWORD: "owner-password-value",
      LUNEDO_ORGANIZATION_NAME: "Docs team",
      LUNEDO_SMTP_HOST: "smtp.example.org",
      LUNEDO_SMTP_FROM: "wiki@example.org",
    };
    expectConfigError(
      () =>
        loadConfig({
          ...setup,
          LUNEDO_SMTP_SECURITY: "none",
          LUNEDO_SMTP_USERNAME: "wiki",
          LUNEDO_SMTP_PASSWORD: "x",
        }),
      "LUNEDO_SMTP_SECURITY: credentials require tls or starttls",
    );
    expectConfigError(
      () => loadConfig({ ...setup, LUNEDO_SMTP_PASSWORD: "x" }),
      "LUNEDO_SMTP_USERNAME: set together with LUNEDO_SMTP_PASSWORD",
    );
    expect(loadConfig({ ...setup, LUNEDO_SMTP_SECURITY: "tls" }).setup?.smtp?.port).toBe(465);
  });
});
