import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { SYSTEM } from "./principal.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("instance address", () => {
  let test: TestServices;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  it("lets the system adopt a new address, as a restore does, and records who changed it", async () => {
    await expect(test.services.instanceAddress.change(SYSTEM, "https://wiki.example.org/")).resolves.toEqual({
      url: "https://wiki.example.org",
      endedSessions: 0,
    });
    expect(await test.services.instanceAddress.get()).toEqual({
      url: "https://wiki.example.org",
      source: "setting",
    });
    const events = await test.database.execute<{ actor_type: string; fields: { url: string } }>(sql`
      select actor_type, fields from audit_events where name = 'instance.addressChanged'`);
    expect(events.rows).toEqual([
      { actor_type: "system", fields: expect.objectContaining({ url: "https://wiki.example.org" }) },
    ]);
  });
});
