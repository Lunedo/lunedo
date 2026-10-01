import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("cleanup of authentication data", () => {
  let test: TestServices;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function count(table: string): Promise<number> {
    const result = await test.pool.query<{ count: string }>(`select count(*) from ${table}`);
    return Number(result.rows[0]?.count);
  }

  it("removes expired sessions, challenges, tokens and setup sessions and keeps valid ones", async () => {
    const { services, database, pool } = test;
    const account = await database.transaction((tx) =>
      services.accounts.createStandard(tx, {
        email: "cleanup@example.org",
        name: "Cleanup",
        password: "a long cleanup passphrase",
      }),
    );
    for (let i = 0; i < 4; i++) {
      await database.transaction((tx) =>
        services.sessions.create(tx, {
          accountId: account.id,
          kind: "full",
          methods: ["password"],
          client: {},
        }),
      );
    }
    const sessionIds = (
      await pool.query<{ id: string }>("select id from sessions order by created_at")
    ).rows.map((row) => row.id);
    await pool.query("update sessions set last_used_at = now() - interval '8 days' where id = $1", [
      sessionIds[0],
    ]);
    await pool.query("update sessions set created_at = now() - interval '31 days' where id = $1", [
      sessionIds[1],
    ]);

    await services.challenges.create(database, { purpose: "passkeySignIn", challenge: "a", withToken: true });
    const expired = await services.challenges.create(database, {
      purpose: "passkeySignIn",
      challenge: "b",
      withToken: true,
    });
    await pool.query("update auth_challenges set expires_at = now() - interval '1 second' where id = $1", [
      expired.id,
    ]);

    await pool.query(
      `insert into account_tokens (id, account_id, purpose, token_hash, expires_at, used_at) values
        (gen_random_uuid(), $1, 'passwordReset', '\\x01', now() + interval '10 minutes', null),
        (gen_random_uuid(), $1, 'passwordReset', '\\x02', now() + interval '10 minutes', now()),
        (gen_random_uuid(), $1, 'emailChange', '\\x03', now() - interval '1 minute', null)`,
      [account.id],
    );
    await pool.query(
      `insert into setup_sessions (id, token_hash, expires_at) values
        (gen_random_uuid(), '\\x04', now() + interval '1 hour'),
        (gen_random_uuid(), '\\x05', now() - interval '1 second')`,
    );

    expect(await services.sessions.cleanup()).toBe(2);
    expect(await services.challenges.cleanup()).toBe(1);
    expect(await services.security.cleanup()).toBe(2);
    expect(await services.setup.cleanup()).toBe(1);
    expect(await count("sessions")).toBe(2);
    expect(await count("auth_challenges")).toBe(1);
    expect(await count("account_tokens")).toBe(1);
    expect(await count("setup_sessions")).toBe(1);
  });

  it("removes sessions of accounts that are no longer active", async () => {
    const { services, database, pool } = test;
    const account = await database.transaction((tx) =>
      services.accounts.createStandard(tx, {
        email: "gone@example.org",
        name: "Gone",
        password: "a long cleanup passphrase",
      }),
    );
    await database.transaction((tx) =>
      services.sessions.create(tx, {
        accountId: account.id,
        kind: "full",
        methods: ["password"],
        client: {},
      }),
    );
    await pool.query("update accounts set state = 'deactivated' where id = $1", [account.id]);
    await services.sessions.cleanup();
    expect((await pool.query("select 1 from sessions where account_id = $1", [account.id])).rows).toEqual([]);
  });
});
