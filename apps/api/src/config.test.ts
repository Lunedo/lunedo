import { ConfigError } from "@pagehall/shared/node";
import { describe, expect, it } from "vitest";
import { readApiConfig } from "./config.js";

const databaseUrl = "postgres://pagehall:pagehall@localhost:5432/pagehall";

describe("readApiConfig", () => {
  it("applies defaults", () => {
    expect(readApiConfig({ PAGEHALL_DATABASE_URL: databaseUrl })).toEqual({
      host: "0.0.0.0",
      port: 3000,
      logLevel: "info",
      databaseUrl,
      webRoot: undefined,
    });
  });

  it("reads all settings", () => {
    const config = readApiConfig({
      PAGEHALL_DATABASE_URL: databaseUrl,
      PAGEHALL_HOST: "127.0.0.1",
      PAGEHALL_API_PORT: "8080",
      PAGEHALL_LOG_LEVEL: "debug",
      PAGEHALL_WEB_ROOT: "/app/web",
    });
    expect(config).toMatchObject({ host: "127.0.0.1", port: 8080, logLevel: "debug", webRoot: "/app/web" });
  });

  it("requires a database URL", () => {
    expect(() => readApiConfig({})).toThrow(ConfigError);
  });
});
