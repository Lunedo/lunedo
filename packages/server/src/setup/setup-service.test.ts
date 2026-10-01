import { afterEach, describe, expect, it } from "vitest";
import { RateLimitedError } from "../auth/errors.js";
import { Secret } from "../config/secret.js";
import { createLogger } from "../logging/logger.js";
import { StartupError } from "../runtime/startup-error.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { applyConfiguredSetup } from "./configured.js";
import { SetupNotFoundError, SetupStepError } from "./setup-service.js";

const baseUrl = testDatabaseBaseUrl();

function capturingLogger() {
  const lines: string[] = [];
  const logger = createLogger({
    service: "test",
    level: "info",
    destination: { write: (line: string) => lines.push(line) },
  });
  return { lines, logger, code: () => /Setup code: ([0-9A-Z-]+)\./.exec(lines.at(-1) ?? "")?.[1] ?? "" };
}

const configured = {
  instanceUrl: "https://wiki.example.org",
  instanceName: "Docs",
  owner: { email: "owner@example.org", name: "Owner", password: new Secret("a configured passphrase") },
  smtp: undefined,
};

describe.skipIf(!baseUrl)("SetupService", () => {
  let test: TestServices | undefined;

  afterEach(async () => {
    await test?.close();
    test = undefined;
  });

  async function services() {
    test = await createTestServices(baseUrl ?? "");
    return test;
  }

  it("issues a new code on every start and accepts each code once", async () => {
    const {
      services: { setup },
    } = await services();
    const log = capturingLogger();
    await setup.issueCode(log.logger);
    const first = log.code();
    await setup.issueCode(log.logger);
    const second = log.code();
    expect(second).not.toBe(first);
    expect(JSON.parse(log.lines[0] ?? "{}")).toMatchObject({ level: "warn" });

    await expect(setup.exchangeCode(first, "203.0.113.1")).rejects.toThrow(SetupStepError);
    const token = await setup.exchangeCode(second.toLowerCase().replaceAll("-", ""), "203.0.113.1");
    expect(await setup.validSession(token)).toBe(true);
    expect(await setup.validSession("x".repeat(43))).toBe(false);
    await test?.pool.query("update setup_sessions set created_at = now() - interval '25 hours'");
    expect(await setup.validSession(token)).toBe(false);
    await expect(setup.exchangeCode(second, "203.0.113.1")).rejects.toThrow(SetupStepError);
  });

  it("limits code exchanges per client", async () => {
    const {
      services: { setup },
    } = await services();
    const log = capturingLogger();
    await setup.issueCode(log.logger);
    for (let attempt = 0; attempt < 10; attempt++) {
      await expect(setup.exchangeCode("WRONG-CODE", "203.0.113.2")).rejects.toThrow(SetupStepError);
    }
    await expect(setup.exchangeCode(log.code(), "203.0.113.2")).rejects.toThrow(RateLimitedError);
    expect(await setup.exchangeCode(log.code(), "203.0.113.3")).toMatch(/^[\w-]{43}$/);
  });

  it("does not let a client over its limit block the exchange for others", async () => {
    const {
      services: { setup },
    } = await services();
    const log = capturingLogger();
    await setup.issueCode(log.logger);
    for (let attempt = 0; attempt < 60; attempt++) {
      await expect(setup.exchangeCode("WRONG-CODE", "203.0.113.20")).rejects.toThrow();
    }
    expect(await setup.exchangeCode(log.code(), "198.51.100.20")).toMatch(/^[\w-]{43}$/);
  });

  it("applies the configuration once when several nodes start at the same time", async () => {
    const { services: accountServices, settings, pool } = await services();
    const logger = createLogger({ service: "test", level: "silent" });
    const apply = () =>
      applyConfiguredSetup({
        setup: configured,
        service: accountServices.setup,
        accounts: accountServices.accounts,
        settings,
        mail: accountServices.mail,
        logger,
      });
    const results = await Promise.all([apply(), apply(), apply()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await pool.query("select email from accounts")).rows).toEqual([{ email: "owner@example.org" }]);
    expect(await accountServices.setup.isComplete()).toBe(true);
    expect(await apply()).toBe(false);

    const log = capturingLogger();
    await accountServices.setup.issueCode(log.logger);
    expect(log.lines).toEqual([]);
    await expect(accountServices.setup.exchangeCode("ANY", "203.0.113.4")).rejects.toThrow(
      SetupNotFoundError,
    );
    const completed = await pool.query(
      "select setup_completed_through, owner_account_id is not null as owner from instance",
    );
    expect(completed.rows).toEqual([{ setup_completed_through: "configuration", owner: true }]);
    expect((await accountServices.audit.verify()).every((result) => result.broken === null)).toBe(true);
  });

  it("refuses to start with an owner password that does not meet the policy", async () => {
    const { services: accountServices, settings, pool } = await services();
    await expect(
      applyConfiguredSetup({
        setup: { ...configured, owner: { ...configured.owner, password: new Secret("password1234") } },
        service: accountServices.setup,
        accounts: accountServices.accounts,
        settings,
        mail: accountServices.mail,
        logger: createLogger({ service: "test", level: "silent" }),
      }),
    ).rejects.toThrow(StartupError);
    expect((await pool.query("select 1 from accounts")).rows).toEqual([]);
    expect(await accountServices.setup.isComplete()).toBe(false);
  });
});
