import { createHash } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import { and, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import type { Database, Executor } from "../database/database.js";
import type { SettingsService } from "../settings/service.js";
import { rateLimits, signInFailures } from "./schema.js";
import {
  accountAttemptLimitSetting,
  accountLockoutFailuresSetting,
  clientAttemptLimitSetting,
  clientLockoutFailuresSetting,
  lockoutDurationSetting,
  lockoutMaxDurationSetting,
  lockoutWindowSetting,
} from "./settings.js";

/** Lockouts in a row stop doubling after a day without one. */
const LOCKOUT_MEMORY_MINUTES = 24 * 60;
const MINUTE = 60_000;

/**
 * The part of a client address that identifies one client: the address for IPv4 and the /64
 * prefix for IPv6, because a single IPv6 client usually controls a whole /64.
 */
export function clientSubject(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];
  if (isIPv4(ip)) return ip;
  if (!isIPv6(ip)) return ip;
  const [head = "", tail = ""] = ip.split("%")[0]?.split("::") ?? [];
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = ip.includes("::")
    ? [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups]
    : headGroups;
  return `${groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(":")}::/64`;
}

/** Account addresses are hashed, so that addresses of unknown accounts are not stored. */
export function accountSubject(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex");
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Fixed-window request counters in PostgreSQL, so that all nodes share them. */
export class RateLimiter {
  readonly #database: Database;

  constructor(options: { database: Database }) {
    this.#database = options.database;
  }

  /** Counts one request for `key` and tells whether it is within `limit` per window. */
  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const window = sql`make_interval(secs => ${windowSeconds})`;
    const expired = sql`${rateLimits.windowStart} <= now() - ${window}`;
    const result = await this.#database.execute<{ count: number; retry_after: string }>(sql`
      insert into ${rateLimits} (key, window_start, count) values (${key}, now(), 1)
      on conflict (key) do update set
        window_start = case when ${expired} then now() else ${rateLimits.windowStart} end,
        count = case when ${expired} then 1 else ${rateLimits.count} + 1 end
      returning count, ceil(extract(epoch from (window_start + ${window} - now()))) as retry_after`);
    const row = result.rows[0];
    const count = Number(row?.count ?? 0);
    return { allowed: count <= limit, retryAfterSeconds: Math.max(1, Number(row?.retry_after ?? 1)) };
  }

  /** Removes counters whose window ended more than a day ago. */
  async cleanup(): Promise<number> {
    const deleted = await this.#database
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, sql`now() - interval '1 day'`));
    return deleted.rowCount ?? 0;
  }
}

export interface ThrottleSubjects {
  /** The address entered for sign-in, or the address of the account. */
  email?: string;
  clientIp?: string;
}

export interface Lockout {
  subject: "account" | "clientIp";
  failures: number;
  lockedUntil: Date;
}

type SubjectKey = { subject: Lockout["subject"]; key: string };

/**
 * Protects sign-in against brute force (ADR 0011): attempts are rate-limited per account address
 * and per client IP, and repeated failures lock the address or the client temporarily, with a
 * duration that doubles with each lockout in a row. Unknown addresses are counted like known
 * ones, so that a lockout does not reveal whether an account exists.
 */
export class SignInThrottle {
  readonly #database: Database;
  readonly #settings: SettingsService;
  readonly #rateLimiter: RateLimiter;

  constructor(options: { database: Database; settings: SettingsService; rateLimiter: RateLimiter }) {
    this.#database = options.database;
    this.#settings = options.settings;
    this.#rateLimiter = options.rateLimiter;
  }

  #keys(subjects: ThrottleSubjects): SubjectKey[] {
    const keys: SubjectKey[] = [];
    if (subjects.email !== undefined)
      keys.push({ subject: "account", key: `account:${accountSubject(subjects.email)}` });
    if (subjects.clientIp !== undefined)
      keys.push({ subject: "clientIp", key: `client:${clientSubject(subjects.clientIp)}` });
    return keys;
  }

  /** Counts an attempt. Returns the seconds to wait when the rate limit is exceeded. */
  async attempt(subjects: ThrottleSubjects): Promise<RateLimitResult> {
    const limits = {
      account: await this.#settings.get(accountAttemptLimitSetting, {}),
      clientIp: await this.#settings.get(clientAttemptLimitSetting, {}),
    };
    let retryAfterSeconds = 0;
    for (const { subject, key } of this.#keys(subjects)) {
      const result = await this.#rateLimiter.consume(`signIn:${key}`, limits[subject], 60);
      if (!result.allowed) retryAfterSeconds = Math.max(retryAfterSeconds, result.retryAfterSeconds);
    }
    return { allowed: retryAfterSeconds === 0, retryAfterSeconds };
  }

  /** The lockout that applies to these subjects, if any. */
  async lockout(
    subjects: ThrottleSubjects,
  ): Promise<{ subject: Lockout["subject"]; lockedUntil: Date } | null> {
    const keys = this.#keys(subjects);
    if (keys.length === 0) return null;
    const rows = await this.#database
      .select({ key: signInFailures.key, lockedUntil: signInFailures.lockedUntil })
      .from(signInFailures)
      .where(
        and(
          inArray(
            signInFailures.key,
            keys.map((entry) => entry.key),
          ),
          gt(signInFailures.lockedUntil, sql`now()`),
        ),
      );
    const row = rows[0];
    if (!row?.lockedUntil) return null;
    const subject = keys.find((entry) => entry.key === row.key)?.subject ?? "account";
    return { subject, lockedUntil: row.lockedUntil };
  }

  /** Counts a failed attempt and returns the lockouts it caused. */
  async recordFailure(subjects: ThrottleSubjects, executor: Executor = this.#database): Promise<Lockout[]> {
    const thresholds = {
      account: await this.#settings.get(accountLockoutFailuresSetting, {}),
      clientIp: await this.#settings.get(clientLockoutFailuresSetting, {}),
    };
    const windowMinutes = await this.#settings.get(lockoutWindowSetting, {});
    const baseMinutes = await this.#settings.get(lockoutDurationSetting, {});
    const maxMinutes = await this.#settings.get(lockoutMaxDurationSetting, {});
    const lockouts: Lockout[] = [];

    for (const { subject, key } of this.#keys(subjects)) {
      const threshold = thresholds[subject];
      const lockout = await executor.transaction(async (tx) => {
        await tx.insert(signInFailures).values({ key }).onConflictDoNothing();
        const [row] = await tx
          .select({
            failures: signInFailures.failures,
            firstFailureAt: signInFailures.firstFailureAt,
            lockouts: signInFailures.lockouts,
            lastLockoutAt: signInFailures.lastLockoutAt,
            now: sql<Date>`now()`.mapWith((value: string | Date) => new Date(value)),
          })
          .from(signInFailures)
          .where(eq(signInFailures.key, key))
          .for("update");
        if (!row) throw new Error("The sign-in failure row is missing");
        const now = row.now.getTime();
        const inWindow =
          row.firstFailureAt !== null && row.firstFailureAt.getTime() > now - windowMinutes * MINUTE;
        const failures = inWindow ? row.failures + 1 : 1;
        const remembered =
          row.lastLockoutAt !== null && row.lastLockoutAt.getTime() > now - LOCKOUT_MEMORY_MINUTES * MINUTE;
        const previousLockouts = remembered ? row.lockouts : 0;
        if (failures < threshold) {
          await tx
            .update(signInFailures)
            .set({
              failures,
              firstFailureAt: inWindow ? row.firstFailureAt : row.now,
              lockouts: previousLockouts,
              updatedAt: row.now,
            })
            .where(eq(signInFailures.key, key));
          return null;
        }
        const minutes = Math.min(maxMinutes, baseMinutes * 2 ** Math.min(previousLockouts, 20));
        const lockedUntil = new Date(now + minutes * MINUTE);
        await tx
          .update(signInFailures)
          .set({
            failures: 0,
            firstFailureAt: null,
            lockouts: previousLockouts + 1,
            lastLockoutAt: row.now,
            lockedUntil,
            updatedAt: row.now,
          })
          .where(eq(signInFailures.key, key));
        return { subject, failures, lockedUntil };
      });
      if (lockout) lockouts.push(lockout);
    }
    return lockouts;
  }

  /** A successful sign-in clears the failures of the account address; client failures remain. */
  async recordSuccess(email: string, executor: Executor = this.#database): Promise<void> {
    await executor.delete(signInFailures).where(eq(signInFailures.key, `account:${accountSubject(email)}`));
  }

  /** Removes entries without failures or lockouts in the last day. */
  async cleanup(): Promise<number> {
    const deleted = await this.#database
      .delete(signInFailures)
      .where(
        and(
          lt(signInFailures.updatedAt, sql`now() - interval '1 day'`),
          or(sql`${signInFailures.lockedUntil} is null`, lt(signInFailures.lockedUntil, sql`now()`)),
        ),
      );
    return deleted.rowCount ?? 0;
  }
}
