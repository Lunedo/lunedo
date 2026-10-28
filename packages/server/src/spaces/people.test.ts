import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("people", () => {
  let test: TestServices;
  const { organization, member, space, join } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function emailOf(id: string) {
    const result = await test.database.execute<{ email: string }>(
      sql`select email from accounts where id = ${id}`,
    );
    return result.rows[0]?.email ?? "";
  }

  it("shows members of the own organizations with their address and people of shared spaces without it", async () => {
    const org = await organization();
    const other = await organization();
    const viewer = await member(org.id, "member", "Viewer");
    const colleague = await member(org.id, "member", "Colleague Alpha");
    const partner = await member(other.id, "member", "Partner Alpha");
    const stranger = await member(other.id, "member", "Stranger Alpha");
    const guest = await member(org.id, "guest", "Guest Alpha");
    await join(other.id, viewer, "collaborator");
    await space(other.id, partner, {
      grants: [{ principalKind: "account", principalId: viewer, role: "reader" }],
    });

    const found = await test.services.people.search(accountPrincipal(viewer), { limit: 50, search: "alpha" });
    const byName = new Map(found.items.map((person) => [person.name, person]));
    expect(byName.get("Colleague Alpha")?.email).toBe(await emailOf(colleague));
    expect(byName.get("Guest Alpha")?.email).toBe(await emailOf(guest));
    expect(byName.has("Partner Alpha")).toBe(true);
    expect(byName.get("Partner Alpha")?.email).toBeNull();
    expect(byName.has("Stranger Alpha")).toBe(false);

    const byAddress = await test.services.people.search(accountPrincipal(viewer), {
      limit: 50,
      search: (await emailOf(partner)).slice(0, 12),
    });
    expect(byAddress.items.map((person) => person.id)).not.toContain(partner);
    expect(await test.services.people.canSee(accountPrincipal(viewer), stranger)).toBe(false);

    const asGuest = await test.services.people.search(accountPrincipal(guest), {
      limit: 50,
      search: "alpha",
    });
    expect(asGuest.items.map((person) => person.name)).toEqual(["Guest Alpha"]);
  });

  it("finds given people with their picture, and only those the caller may see", async () => {
    const org = await organization();
    const other = await organization();
    const viewer = await member(org.id, "member", "Viewer");
    const colleague = await member(org.id, "member", "Colleague Beta");
    const stranger = await member(other.id, "member", "Stranger Beta");
    await test.database.execute(
      sql`update accounts set picture_ref = 'p1' where id in (${colleague}, ${stranger})`,
    );

    const found = await test.services.people.search(
      accountPrincipal(viewer),
      { limit: 50 },
      { ids: [colleague, stranger] },
    );
    expect(found.items.map((person) => [person.id, person.pictureRef])).toEqual([[colleague, "p1"]]);
  });
});
