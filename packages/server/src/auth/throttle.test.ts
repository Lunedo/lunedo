import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDatabase, type Database } from "../database/database.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { createLogger } from "../logging/logger.js";
import { SettingsService } from "../settings/service.js";
import {
  accountSubject,
  CLIENT_ATTEMPTS_PER_MINUTE,
  clientSubject,
  FailureReservation,
  RateLimiter,
  SignInThrottle,
} from "./throttle.js";

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

const none = () => new FailureReservation(null);
const refuse = async (blocked: { kind: string }) => new Error(blocked.kind);

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
      await Promise.all(Array.from({ length: 10 }, () => throttle.recordFailure({ email }, none())))
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
    for (let i = 0; i < 4; i++) await throttle.recordFailure({ email }, none());
    await pool.query(
      "update sign_in_failures set first_failure_at = now() - interval '16 minutes' where key = $1",
      [`account:${accountSubject(email)}`],
    );
    expect(await throttle.recordFailure({ email }, none())).toEqual([]);
    for (let i = 0; i < 3; i++) await throttle.recordFailure({ email }, none());
    await throttle.recordSuccess(email);
    expect(await throttle.recordFailure({ email }, none())).toEqual([]);
    expect(await throttle.lockout({ email })).toBeNull();
  });

  it("counts only failed sign-ins per client, so one address can sign in many people", async () => {
    const clientIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    for (let person = 0; person < 100; person++) {
      const { rate, reservation } = await throttle.reserve({
        email: `${randomUUID()}@example.org`,
        clientIp,
      });
      expect(rate.allowed).toBe(true);
      await reservation.settle();
    }
    for (let failure = 0; failure < 30; failure++) {
      const { reservation } = await throttle.reserve({ clientIp });
      await throttle.recordFailure({ clientIp }, reservation);
      await reservation.settle();
    }
    const refused = await throttle.reserve({ email: `${randomUUID()}@example.org`, clientIp });
    expect(refused.rate.allowed).toBe(false);
    expect(refused.rate.retryAfterSeconds).toBeGreaterThan(0);
    const other = await throttle.reserve({
      email: `${randomUUID()}@example.org`,
      clientIp: "203.0.113.250",
    });
    expect(other.rate.allowed).toBe(true);
  });

  it("lets no more wrong attempts of one client run than the failure limit, however many arrive at once", async () => {
    const clientIp = `198.18.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`;
    let ran = 0;
    const outcomes = await Promise.allSettled(
      Array.from({ length: 120 }, () =>
        throttle.attempting({ clientIp }, refuse, async (reservation) => {
          ran++;
          await throttle.recordFailure({ clientIp }, reservation);
          throw new Error("wrong");
        }),
      ),
    );
    expect(ran).toBe(30);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected" && outcome.reason.message === "rateLimited"),
    ).toHaveLength(90);
    const next = await throttle.reserve({ clientIp });
    expect(next.rate.allowed).toBe(false);
  });

  it("does not block correct attempts of one client that arrive at once, round after round", async () => {
    const clientIp = `198.19.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`;
    for (let round = 0; round < 4; round++) {
      const outcomes = await Promise.all(
        Array.from({ length: 30 }, () => throttle.attempting({ clientIp }, refuse, async () => "signed in")),
      );
      expect(outcomes.every((outcome) => outcome === "signed in")).toBe(true);
    }
    const peeked = await rateLimiter.peek(`signIn:failed:client:${clientSubject(clientIp)}`, 30, 60);
    expect(peeked.allowed).toBe(true);
    expect((await throttle.reserve({ clientIp })).rate.allowed).toBe(true);
  });

  it("gives the place back when an attempt ends without a counted failure", async () => {
    const clientIp = `198.20.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`;
    for (let attempt = 0; attempt < 40; attempt++) {
      await expect(
        throttle.attempting({ clientIp }, refuse, async () => {
          throw new Error("expired link");
        }),
      ).rejects.toThrow("expired link");
    }
    expect((await throttle.reserve({ clientIp })).rate.allowed).toBe(true);
  });

  it("does not count a refused attempt towards the failure limit", async () => {
    const email = `${randomUUID()}@example.org`;
    const clientIp = `198.21.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`;
    for (let attempt = 0; attempt < 10; attempt++) await throttle.reserve({ email, clientIp });
    for (let attempt = 0; attempt < 50; attempt++) {
      expect((await throttle.reserve({ email, clientIp })).rate.allowed).toBe(false);
    }
    const peeked = await rateLimiter.peek(`signIn:failed:client:${clientSubject(clientIp)}`, 30, 60);
    expect(peeked.allowed).toBe(true);
  });

  it("still counts every attempt per account", async () => {
    const email = `${randomUUID()}@example.org`;
    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await throttle.reserve({ email, clientIp: `203.0.113.${attempt + 1}` })).rate.allowed).toBe(
        true,
      );
    }
    expect((await throttle.reserve({ email, clientIp: "203.0.113.99" })).rate.allowed).toBe(false);
  });

  it("lets at most the ceiling of attempts through when one client keeps sending", async () => {
    const clientIp = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
    let allowed = 0;
    for (let attempt = 0; attempt < CLIENT_ATTEMPTS_PER_MINUTE + 20; attempt++) {
      const { rate, reservation } = await throttle.reserve({
        email: `${randomUUID()}@example.org`,
        clientIp,
      });
      if (rate.allowed) allowed++;
      await reservation.settle();
    }
    expect(allowed).toBe(CLIENT_ATTEMPTS_PER_MINUTE);
  });

  it("gives back a counted request", async () => {
    const key = `test:${randomUUID()}`;
    await rateLimiter.consume(key, 1, 60);
    expect(await rateLimiter.peek(key, 1, 60)).toMatchObject({ allowed: false });
    await rateLimiter.refund(key);
    expect(await rateLimiter.peek(key, 1, 60)).toMatchObject({ allowed: true });
    await rateLimiter.refund(key);
    expect((await rateLimiter.consume(key, 1, 60)).allowed).toBe(true);
  });

  it("does not give back a place that belongs to a window that has passed", async () => {
    const key = `test:${randomUUID()}`;
    const first = await rateLimiter.consume(key, 5, 60);
    await pool.query("update rate_limits set window_start = now() - interval '61 seconds' where key = $1", [
      key,
    ]);
    await rateLimiter.consume(key, 5, 60);
    await rateLimiter.refund(key, first.windowStart);
    expect((await pool.query("select count from rate_limits where key = $1", [key])).rows[0].count).toBe(1);
  });

  it("only reads a counter when peeking", async () => {
    const key = `test:${randomUUID()}`;
    expect(await rateLimiter.peek(key, 1, 60)).toMatchObject({ allowed: true });
    expect(await rateLimiter.peek(key, 1, 60)).toMatchObject({ allowed: true });
    await rateLimiter.consume(key, 1, 60);
    expect(await rateLimiter.peek(key, 1, 60)).toMatchObject({ allowed: false });
    expect(await rateLimiter.peek(key, 2, 60)).toMatchObject({ allowed: true });
  });

  it("removes old entries without an active lockout", async () => {
    const key = `test:${randomUUID()}`;
    await rateLimiter.consume(key, 1, 60);
    await pool.query("update rate_limits set window_start = now() - interval '2 days' where key = $1", [key]);
    await rateLimiter.cleanup();
    expect((await pool.query("select 1 from rate_limits where key = $1", [key])).rows).toEqual([]);
  });
});
