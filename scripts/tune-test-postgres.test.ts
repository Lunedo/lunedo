import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Queryable, tuneForTests } from "./tune-test-postgres.ts";

function fake(reported: Record<string, string>) {
  const sent: string[] = [];
  const client: Queryable = {
    async query(sql) {
      sent.push(sql);
      const name = /^SHOW (\w+)$/.exec(sql)?.[1];
      return { rows: name ? [{ [name]: reported[name] ?? "on" }] : [] };
    },
  };
  return { client, sent };
}

describe("tuneForTests", () => {
  it("turns off fsync, synchronous commit and full page writes, then reloads", async () => {
    const { client, sent } = fake({ fsync: "off", synchronous_commit: "off", full_page_writes: "off" });
    await tuneForTests(client);
    assert.deepEqual(sent.slice(0, 4), [
      "ALTER SYSTEM SET fsync = 'off'",
      "ALTER SYSTEM SET synchronous_commit = 'off'",
      "ALTER SYSTEM SET full_page_writes = 'off'",
      "SELECT pg_reload_conf()",
    ]);
  });

  it("fails when the server did not apply a setting", async () => {
    const { client } = fake({ fsync: "off", synchronous_commit: "off" });
    await assert.rejects(tuneForTests(client), /full_page_writes is 'on'/);
  });
});
