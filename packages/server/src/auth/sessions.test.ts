import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accounts } from "../accounts/schema.js";
import type { Database, Transaction } from "../database/database.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { sessions } from "./schema.js";
import { SessionService } from "./sessions.js";
import { sessionIdleTimeoutSetting } from "./settings.js";

const baseUrl = testDatabaseBaseUrl();
const MINUTE = 60_000;

describe.skipIf(!baseUrl)("resolving sessions", () => {
  let test: TestServices;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function signedIn(email: string) {
    const { services, database } = test;
    const account = await database.transaction((tx) =>
      services.accounts.createStandard(tx, {
        email,
        name: "Touch",
        password: "a long touch passphrase",
        homeOrganizationId: null,
      }),
    );
    const created = await database.transaction((tx) =>
      services.sessions.create(tx, {
        accountId: account.id,
        kind: "full",
        methods: ["password"],
        client: { ip: "127.0.0.1" },
      }),
    );
    const [row] = await database.select().from(sessions).where(eq(sessions.accountId, account.id));
    if (!row) throw new Error("session missing");
    return { account, token: created.token, sessionId: row.id, createdAt: row.lastUsedAt };
  }

  function serviceAt(at: () => Date, database: Database = test.database) {
    return new SessionService({ database, settings: test.settings, audit: test.services.audit, clock: at });
  }

  async function lastUsed(sessionId: string) {
    const [row] = await test.database
      .select({ lastUsedAt: sessions.lastUsedAt })
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    return row?.lastUsedAt ?? null;
  }

  it("records one use for requests of a session that arrive at the same moment", async () => {
    const { account, token } = await signedIn("touch@example.org");
    let recorded = 0;
    const counting = new Proxy(test.database, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return (run: (tx: Transaction) => Promise<unknown>) =>
            target.transaction((tx) =>
              run(
                new Proxy(tx, {
                  get(inner, name, innerReceiver) {
                    if (name === "update") {
                      return (table: Parameters<typeof inner.update>[0]) => {
                        if (table === accounts) recorded += 1;
                        return inner.update(table);
                      };
                    }
                    return Reflect.get(inner, name, innerReceiver);
                  },
                }),
              ),
            );
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const later = serviceAt(() => new Date(Date.now() + 5 * MINUTE), counting);
    const resolved = await Promise.all(Array.from({ length: 12 }, () => later.resolve(token)));
    expect(resolved.every((session) => session?.accountId === account.id)).toBe(true);
    expect(recorded).toBe(1);
    await later.resolve(token);
    expect(recorded).toBe(1);
  });

  it("writes the last use without waiting for the write-ahead log", async () => {
    const { token } = await signedIn("touch-wal@example.org");
    const seen: string[] = [];
    const observing = new Proxy(test.database, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return (run: (tx: Transaction) => Promise<unknown>) =>
            target.transaction(async (tx) => {
              const result = await run(tx);
              const setting = await tx.execute<{ value: string }>(
                sql`select current_setting('synchronous_commit') as value`,
              );
              seen.push(setting.rows[0]?.value ?? "");
              return result;
            });
        }
        return Reflect.get(target, property, receiver);
      },
    });
    await serviceAt(() => new Date(Date.now() + 5 * MINUTE), observing).resolve(token);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((value) => value === "off")).toBe(true);
    const [outside] = (
      await test.database.execute<{ value: string }>(
        sql`select current_setting('synchronous_commit') as value`,
      )
    ).rows;
    expect(outside?.value).toBe("on");
  });

  it("never deadlocks with a change that locks the account before it removes sessions", async () => {
    const { account, token } = await signedIn("touch-lock@example.org");
    const later = serviceAt(() => new Date(Date.now() + 5 * MINUTE));
    let resolving: Promise<unknown> = Promise.resolve();
    await test.database.transaction(async (tx) => {
      await tx.execute(sql`select id from accounts where id = ${account.id} for update`);
      resolving = later.resolve(token);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx.delete(sessions).where(eq(sessions.accountId, account.id));
    });
    await expect(resolving).resolves.not.toBeNull();
  });

  it("records the last use at most once a minute", async () => {
    const { token, sessionId, createdAt } = await signedIn("touch-minute@example.org");
    const start = createdAt.getTime();
    await serviceAt(() => new Date(start + 59_000)).resolve(token);
    expect((await lastUsed(sessionId))?.getTime()).toBe(start);
    await serviceAt(() => new Date(start + 61_000)).resolve(token);
    expect((await lastUsed(sessionId))?.getTime()).toBe(start + 61_000);
    await serviceAt(() => new Date(start + 90_000)).resolve(token);
    expect((await lastUsed(sessionId))?.getTime()).toBe(start + 61_000);
  });

  it("ends a session idle for longer than the idle timeout and never extends it", async () => {
    const { token, sessionId, createdAt } = await signedIn("touch-idle@example.org");
    const idle = (await test.settings.get(sessionIdleTimeoutSetting, {})) * MINUTE;
    const start = createdAt.getTime();
    expect(await serviceAt(() => new Date(start + idle - MINUTE)).resolve(token)).not.toBeNull();
    const touchedAt = start + idle - MINUTE;
    expect((await lastUsed(sessionId))?.getTime()).toBe(touchedAt);
    expect(await serviceAt(() => new Date(touchedAt + idle + 1)).resolve(token)).toBeNull();
    expect(await lastUsed(sessionId)).toBeNull();
    expect(await serviceAt(() => new Date(touchedAt + MINUTE)).resolve(token)).toBeNull();
  });
});
