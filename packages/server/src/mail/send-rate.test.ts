import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDatabase, type Database } from "../database/database.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { MailSendRate } from "./send-rate.js";

const databaseUrl = inject("databaseUrl");

function sender() {
  return `wiki-${randomBytes(4).toString("hex")}@example.org`;
}

describe.skipIf(!databaseUrl)("MailSendRate", () => {
  let pools: DatabasePool[];
  let database: Database;
  let otherNode: Database;

  beforeAll(async () => {
    pools = [0, 1].map(() =>
      createDatabasePool({ connectionString: databaseUrl, applicationName: "lunedo-test" }),
    );
    database = createDatabase(pools[0] as DatabasePool);
    otherNode = createDatabase(pools[1] as DatabasePool);
  });

  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.end()));
  });

  it("allows the configured number of mails per minute and then names the wait", async () => {
    const rate = new MailSendRate(database);
    const address = sender();
    for (let index = 0; index < 3; index++) expect(await rate.claim(address, 3)).toEqual({ claimed: true });
    const refused = await rate.claim(address, 3);
    expect(refused.claimed).toBe(false);
    if (refused.claimed) return;
    expect(refused.waitMs).toBeGreaterThan(55_000);
    expect(refused.waitMs).toBeLessThanOrEqual(60_000);
  });

  it("counts each sender on its own, regardless of the case of the address", async () => {
    const rate = new MailSendRate(database);
    const address = sender();
    expect(await rate.claim(address.toUpperCase(), 1)).toEqual({ claimed: true });
    expect((await rate.claim(address, 1)).claimed).toBe(false);
    expect(await rate.claim(sender(), 1)).toEqual({ claimed: true });
  });

  it("never lets several workers on several nodes send more than the limit together", async () => {
    const address = sender();
    const nodes = [new MailSendRate(database), new MailSendRate(otherNode)];
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, index) => (nodes[index % 2] as MailSendRate).claim(address, 7)),
    );
    expect(results.filter((result) => result.claimed)).toHaveLength(7);
  });

  it("frees a slot once the oldest mail was sent a minute ago", async () => {
    const rate = new MailSendRate(database);
    const address = sender();
    expect(await rate.claim(address, 1)).toEqual({ claimed: true });
    expect((await rate.claim(address, 1)).claimed).toBe(false);
    await pools[0]?.query(
      "update mail_sends set sent_at = sent_at - interval '61 seconds' where sender = $1",
      [address],
    );
    expect(await rate.claim(address, 1)).toEqual({ claimed: true });
  });
});
