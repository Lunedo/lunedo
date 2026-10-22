import { SYSTEM } from "@lunedo/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { completeConfiguredSetup, configuredSetupEnv, firstOrganizationId } from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl } from "../testing/auth-app.js";
import { WindowLimiter } from "./tls-ask.controller.js";

describe("WindowLimiter", () => {
  it("allows a number of requests per client and window", () => {
    let now = 0;
    const limiter = new WindowLimiter({ limit: 2, windowMs: 1000, now: () => now });
    expect([limiter.allow("a"), limiter.allow("a"), limiter.allow("a"), limiter.allow("b")]).toEqual([
      true,
      true,
      false,
      true,
    ]);
    now = 1000;
    expect(limiter.allow("a")).toBe(true);
  });

  it("forgets the oldest client instead of refusing new ones when it tracks too many", () => {
    const limiter = new WindowLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    for (let index = 0; index < 10_000; index += 1) limiter.allow(`client-${index}`);
    expect(limiter.allow("newcomer")).toBe(true);
    expect(limiter.allow("client-9999")).toBe(false);
    expect(limiter.allow("client-0")).toBe(true);
  });
});

describe.skipIf(!databaseBaseUrl)("the TLS ask endpoint", () => {
  let test: AuthTestApp;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.services.portals.allowDomain(SYSTEM, {
      domain: "help.example.org",
      organizationId: await firstOrganizationId(test),
    });
  });

  afterAll(async () => {
    await test?.close();
  });

  const ask = (domain: string, host = "127.0.0.1:3000", ip = "10.0.0.1") =>
    test.app.inject({
      method: "GET",
      url: `/tls/ask?domain=${encodeURIComponent(domain)}`,
      headers: { host },
      remoteAddress: ip,
    });

  it("answers yes only for domains an administrator allowed, and nothing else", async () => {
    const allowed = await ask("Help.Example.org.");
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).toBe("");
    for (const domain of ["other.example.org", "lunedo.test", "", "not a domain", "help.example.org/x"]) {
      const response = await ask(domain);
      expect(response.statusCode, domain).toBe(404);
      expect(response.body).toBe("");
    }
    expect((await test.app.inject({ method: "GET", url: "/tls/ask" })).statusCode).toBe(404);
  });

  it("answers on every host without reading the database for each request", async () => {
    await ask("help.example.org");
    const execute = vi.spyOn(test.runtime.database, "execute");
    expect((await ask("help.example.org", "help.example.org")).statusCode).toBe(200);
    expect((await ask("unknown.example.org", "unknown.example.org")).statusCode).toBe(404);
    expect(execute).not.toHaveBeenCalled();
    execute.mockRestore();
  });

  it("limits the requests of one client", async () => {
    let last = 0;
    for (let index = 0; index < 121; index += 1)
      last = (await ask("help.example.org", undefined, "10.0.0.99")).statusCode;
    expect(last).toBe(429);
    expect((await ask("help.example.org", undefined, "10.0.0.98")).statusCode).toBe(200);
  });

  it("does not limit the checks of a trusted proxy itself", async () => {
    let last = 0;
    for (let index = 0; index < 130; index += 1)
      last = (await ask("help.example.org", undefined, "127.0.0.1")).statusCode;
    expect(last).toBe(200);
    const forwarded = () =>
      test.app.inject({
        method: "GET",
        url: "/tls/ask?domain=help.example.org",
        headers: { "x-forwarded-for": "203.0.113.9" },
        remoteAddress: "127.0.0.1",
      });
    for (let index = 0; index < 120; index += 1) await forwarded();
    expect((await forwarded()).statusCode).toBe(429);
  });
});
