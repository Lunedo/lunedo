import { describe, expect, it } from "vitest";
import { ConfigError, readLogLevel, readPort, readRequiredString, readServiceConfig } from "./config.js";

describe("readRequiredString", () => {
  it("returns the trimmed value", () => {
    expect(readRequiredString({ NAME: " value " }, "NAME")).toBe("value");
  });

  it("rejects missing and empty values", () => {
    expect(() => readRequiredString({}, "NAME")).toThrow(ConfigError);
    expect(() => readRequiredString({ NAME: "  " }, "NAME")).toThrow("NAME is required");
  });
});

describe("readPort", () => {
  it("uses the fallback when unset", () => {
    expect(readPort({}, "PORT", 3000)).toBe(3000);
  });

  it("parses valid ports", () => {
    expect(readPort({ PORT: "8080" }, "PORT", 3000)).toBe(8080);
  });

  it.each(["0", "65536", "80a", "-1", "3.5"])("rejects %s", (value) => {
    expect(() => readPort({ PORT: value }, "PORT", 3000)).toThrow(ConfigError);
  });
});

describe("readLogLevel", () => {
  it("defaults to info", () => {
    expect(readLogLevel({})).toBe("info");
  });

  it("accepts known levels case-insensitively", () => {
    expect(readLogLevel({ PAGEHALL_LOG_LEVEL: "DEBUG" })).toBe("debug");
  });

  it("rejects unknown levels", () => {
    expect(() => readLogLevel({ PAGEHALL_LOG_LEVEL: "verbose" })).toThrow(ConfigError);
  });
});

describe("readServiceConfig", () => {
  const databaseUrl = "postgres://pagehall:pagehall@localhost:5432/pagehall";

  it("applies defaults", () => {
    expect(readServiceConfig({ PAGEHALL_DATABASE_URL: databaseUrl }, "PAGEHALL_WORKER_PORT", 3002)).toEqual({
      host: "0.0.0.0",
      port: 3002,
      logLevel: "info",
      databaseUrl,
    });
  });

  it("reads the role's port", () => {
    const env = { PAGEHALL_DATABASE_URL: databaseUrl, PAGEHALL_COLLAB_PORT: "4001", PAGEHALL_HOST: "::" };
    expect(readServiceConfig(env, "PAGEHALL_COLLAB_PORT", 3001)).toMatchObject({ host: "::", port: 4001 });
  });

  it("requires a database URL", () => {
    expect(() => readServiceConfig({}, "PAGEHALL_COLLAB_PORT", 3001)).toThrow(ConfigError);
  });
});
