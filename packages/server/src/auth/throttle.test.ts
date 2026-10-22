import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDatabase, type Database } from "../database/database.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { createLogger } from "../logging/logger.js";
import { SettingsService } from "../settings/service.js";
import { accountSubject, clientSubject, RateLimiter, SignInThrottle } from "./throttle.js";

const databaseUrl = inject("databaseUrl");

describe("throttle subjects", () => {
  it("uses the IPv4 address and the /64 prefix of IPv6 addresses", () => {
    expect(clientSubject("203.0.113.7")).toBe("203.0.113.7");
    expect(clientSubject("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(clientSubject("2001:db8:1:2::10")).toBe("2001:db8:1:2::/64");
    expect(clientSubject("2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(clientSubject("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientSubject("::1")).toBe("0:0:0:0::/64");
  });

  it("hashes account addresses regardless of case and surrounding space", () => {
    expect(accountSubject(" Someone@Example.org ")).toBe(accountSubject("someone@example.org"));
    expect(accountSubject("someone@example.org")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe.skipIf(!databaseUrl)("RateLimiter and SignInThrottle", () => {
  let pool: DatabasePool;
  let database: Database;
  let rateLimiter: RateLimiter;
  let throttle: SignInThrottle;

  beforeAll(() => {
    pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "lunedo-test" });
    database = createDatabase(pool);
    rateLimiter = new RateLimiter({ database });
    const settings = new SettingsService({
      database,
      logger: createLogger({ service: "test", level: "silent" }),
    });
    throttle = new SignInThrottle({ database, settings, rateLimiter });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("counts every request exactly once under concurrency", async () => {
    const key = `test:${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 30 }, () => rateLimiter.consume(key, 20, 60)));
    expect(results.filter((result) => result.allowed)).toHaveLength(20);
    expect(results.filter((result) => !result.allowed).every((result) => result.retryAfterSeconds > 0)).toBe(
      true,
    );
  });

  it("starts a new window when the old one has passed", async () => {
    const key = `test:${randomUUID()}`;
    await rateLimiter.consume(key, 1, 60);
    expect((await rateLimiter.consume(key, 1, 60)).allowed).toBe(false);
    await pool.query("update rate_limits set window_start = now() - interval '61 seconds' where key = $1", [
      key,
    ]);
    expect((await rateLimiter.consume(key, 1, 60)).allowed).toBe(true);
  });

  it("locks exactly once per threshold under concurrent failures", async () => {
    const email = `${randomUUID()}@example.org`;
    const lockouts = (
      await Promise.all(Array.from({ length: 10 }, () => throttle.recordFailure({ email })))
    ).flat();
    expect(lockouts).toHaveLength(2);
    expect(lockouts.every((lockout) => lockout.subject === "account" && lockout.failures === 5)).toBe(true);
    const durations = lockouts
      .map((lockout) => lockout.lockedUntil.getTime() - Date.now())
      .sort((a, b) => a - b);
    expect(durations[0]).toBeLessThanOrEqual(60_000);
    expect(durations[1]).toBeGreaterThan(60_000);
    expect(await throttle.lockout({ email: email.toUpperCase() })).toMatchObject({ subject: "account" });
  });

  it("forgets failures outside the window and clears them after a success", async () => {
    const email = `${randomUUID()}@example.org`;
    for (let i = 0; i < 4; i++) await throttle.recordFailure({ email });
    await pool.query(
      "update sign_in_failures set first_failure_at = now() - interval '16 minutes' where key = $1",
      [`account:${accountSubject(email)}`],
    );
    expect(await throttle.recordFailure({ email })).toEqual([]);
    for (let i = 0; i < 3; i++) await throttle.recordFailure({ email });
    await throttle.recordSuccess(email);
    expect(await throttle.recordFailure({ email })).toEqual([]);
    expect(await throttle.lockout({ email })).toBeNull();
  });

  it("removes old entries without an active lockout", async () => {
    const key = `test:${randomUUID()}`;
    await rateLimiter.consume(key, 1, 60);
    await pool.query("update rate_limits set window_start = now() - interval '2 days' where key = $1", [key]);
    await rateLimiter.cleanup();
    expect((await pool.query("select 1 from rate_limits where key = $1", [key])).rows).toEqual([]);
  });
});
