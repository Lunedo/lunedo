import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SYSTEM } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("member and group lists", () => {
  let test: TestServices;
  const { organization, member, group, deactivate } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  it("names the groups, the second factor and the last activity of each member", async () => {
    const org = await organization();
    const ada = await member(org.id, "member", "Ada");
    const bob = await member(org.id, "member", "Bob");
    await group(org.id, [ada]);
    const editors = await test.services.groups.create(SYSTEM, org.id, { name: "Editors" });
    await test.services.groups.addMember(SYSTEM, editors.id, ada);
    await test.database.execute(
      sql`insert into webauthn_credentials
          (id, account_id, credential_id, public_key, sign_count, device_type, backed_up, name)
        values (gen_random_uuid(), ${ada}, ${`cred-${ada}`}, '\\x00', 0, 'singleDevice', false, 'Key')`,
    );
    const active = new Date("2026-10-24T08:15:00.000Z");
    await test.database.execute(sql`update accounts set last_active_at = ${active} where id = ${ada}`);

    const members = (await test.services.memberships.list(org.id)).items;
    const first = members.find((entry) => entry.accountId === ada);
    const second = members.find((entry) => entry.accountId === bob);
    expect(first?.groups.map((entry) => entry.name)).toContain("Editors");
    expect(first?.groups).toHaveLength(2);
    expect(first?.twoFactorActive).toBe(true);
    expect(first?.lastActiveAt?.toISOString()).toBe(active.toISOString());
    expect(second?.groups).toEqual([]);
    expect(second?.twoFactorActive).toBe(false);
    expect(second?.lastActiveAt).toBeNull();
  });

  it("counts only active accounts in a group", async () => {
    const org = await organization();
    const ada = await member(org.id, "member", "Ada");
    const bob = await member(org.id, "member", "Bob");
    const id = await group(org.id, [ada, bob]);
    await deactivate(bob);
    const listed = (await test.services.groups.list(org.id)).items.find((entry) => entry.id === id);
    expect(listed?.memberCount).toBe(1);
  });
});
