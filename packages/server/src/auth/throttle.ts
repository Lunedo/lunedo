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

const LOCKOUT_MEMORY_MINUTES = 24 * 60;
const MINUTE = 60_000;

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

export function accountSubject(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex");
}

export const CLIENT_ATTEMPTS_PER_MINUTE = 300;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  windowStart?: string;
}

export class RateLimiter {
  readonly #database: Database;

  constructor(options: { database: Database }) {
    this.#database = options.database;
  }

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const window = sql`make_interval(secs => ${windowSeconds})`;
    const expired = sql`${rateLimits.windowStart} <= now() - ${window}`;
    const result = await this.#database.execute<{
      count: number;
      retry_after: string;
      window_start: string;
    }>(sql`
      insert into ${rateLimits} (key, window_start, count) values (${key}, now(), 1)
      on conflict (key) do update set
        window_start = case when ${expired} then now() else ${rateLimits.windowStart} end,
        count = case when ${expired} then 1 else ${rateLimits.count} + 1 end
      returning count, ceil(extract(epoch from (window_start + ${window} - now()))) as retry_after,
        window_start::text as window_start`);
    const row = result.rows[0];
    const count = Number(row?.count ?? 0);
    return {
      allowed: count <= limit,
      retryAfterSeconds: Math.max(1, Number(row?.retry_after ?? 1)),
      ...(row?.window_start ? { windowStart: row.window_start } : {}),
    };
  }

  async peek(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const window = sql`make_interval(secs => ${windowSeconds})`;
    const result = await this.#database.execute<{ count: number; retry_after: string }>(sql`
      select count, ceil(extract(epoch from (window_start + ${window} - now()))) as retry_after
      from ${rateLimits} where key = ${key} and window_start > now() - ${window}`);
    const row = result.rows[0];
    return {
      allowed: Number(row?.count ?? 0) < limit,
      retryAfterSeconds: Math.max(1, Number(row?.retry_after ?? 1)),
    };
  }

  async refund(key: string, windowStart?: string): Promise<void> {
    const sameWindow = windowStart ? sql`and ${rateLimits.windowStart} = ${windowStart}::timestamptz` : sql``;
    await this.#database.execute(
      sql`update ${rateLimits} set count = greatest(${rateLimits.count} - 1, 0) where key = ${key} ${sameWindow}`,
    );
  }

  async cleanup(): Promise<number> {
    const deleted = await this.#database
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, sql`now() - interval '1 day'`));
    return deleted.rowCount ?? 0;
  }
}

export interface ThrottleSubjects {
  email?: string;
  clientIp?: string;
}

export interface Lockout {
  subject: "account" | "clientIp";
  failures: number;
  lockedUntil: Date;
}

type SubjectKey = { subject: Lockout["subject"]; key: string };

export class FailureReservation {
  readonly #release: (() => Promise<void>) | null;
  #failed = false;
  #settled = false;

  constructor(release: (() => Promise<void>) | null) {
    this.#release = release;
  }

  markFailed(): void {
    this.#failed = true;
  }

  async settle(): Promise<void> {
    if (this.#settled) return;
    this.#settled = true;
    if (!this.#failed) await this.#release?.();
  }
}

export type BlockedAttempt =
  | { kind: "rateLimited"; retryAfterSeconds: number }
  | { kind: "locked"; lockout: { subject: Lockout["subject"]; lockedUntil: Date } };

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

  async reserve(
    subjects: ThrottleSubjects,
  ): Promise<{ rate: RateLimitResult; reservation: FailureReservation }> {
    const limits = {
      account: await this.#settings.get(accountAttemptLimitSetting, {}),
      clientIp: await this.#settings.get(clientAttemptLimitSetting, {}),
    };
    let retryAfterSeconds = 0;
    let reserved: { key: string; windowStart: string | undefined } | null = null;
    const block = (result: RateLimitResult) => {
      if (!result.allowed) retryAfterSeconds = Math.max(retryAfterSeconds, result.retryAfterSeconds);
    };
    for (const { subject, key } of this.#keys(subjects)) {
      if (subject === "account") {
        block(await this.#rateLimiter.consume(`signIn:${key}`, limits.account, 60));
        continue;
      }
      block(await this.#rateLimiter.consume(`signIn:${key}`, CLIENT_ATTEMPTS_PER_MINUTE, 60));
      const failedKey = `signIn:failed:${key}`;
      const place = await this.#rateLimiter.consume(failedKey, limits.clientIp, 60);
      reserved = { key: failedKey, windowStart: place.windowStart };
      block(place);
    }
    const release = reserved ? () => this.#rateLimiter.refund(reserved.key, reserved.windowStart) : null;
    const reservation = new FailureReservation(release);
    if (retryAfterSeconds > 0) await reservation.settle();
    return { rate: { allowed: retryAfterSeconds === 0, retryAfterSeconds }, reservation };
  }

  async attempting<T>(
    subjects: ThrottleSubjects,
    refuse: (blocked: BlockedAttempt) => Promise<Error>,
    run: (reservation: FailureReservation) => Promise<T>,
  ): Promise<T> {
    const { rate, reservation } = await this.reserve(subjects);
    if (!rate.allowed) {
      throw await refuse({ kind: "rateLimited", retryAfterSeconds: rate.retryAfterSeconds });
    }
    try {
      const lockout = await this.lockout(subjects);
      if (lockout) throw await refuse({ kind: "locked", lockout });
      return await run(reservation);
    } finally {
      await reservation.settle();
    }
  }

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

  async recordFailure(
    subjects: ThrottleSubjects,
    reservation: FailureReservation,
    executor: Executor = this.#database,
  ): Promise<Lockout[]> {
    reservation.markFailed();
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

  async recordSuccess(email: string, executor: Executor = this.#database): Promise<void> {
    await executor.delete(signInFailures).where(eq(signInFailures.key, `account:${accountSubject(email)}`));
  }

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
