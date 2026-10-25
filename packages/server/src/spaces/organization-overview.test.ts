import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("spaces of an organization for administrators", () => {
  let test: TestServices;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  it("lists the spaces with their admins, hides confidential names and leaves out personal spaces", async () => {
    const org = await organization();
    const owner = await member(org.id, "member", "Space owner");
    const viewer = await member(org.id, "member", "Viewer");
    const wiki = await space(org.id, owner, { name: "Alpha wiki" });
    const council = await test.services.spaces.create(
      accountPrincipal(owner),
      org.id,
      {
        name: "Board council",
        key: `C${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`,
        visibility: "private",
        confidential: true,
        grants: [],
      },
      test.services.spacePermissions.holders,
    );
    await test.services.personalSpaces.ensure(accountPrincipal(viewer), "Overview");

    const page = await test.services.spaces.organizationOverview(accountPrincipal(viewer), org.id);
    expect(page.items.map((row) => row.id).sort()).toEqual([wiki.id, council.id].sort());
    const wikiRow = page.items.find((row) => row.id === wiki.id);
    expect(wikiRow?.name).toBe("Alpha wiki");
    expect(wikiRow?.administrators.map((holder) => holder.name)).toEqual(["Space owner"]);
    expect(wikiRow?.canManage).toBe(false);
    expect(wikiRow?.canDelete).toBe(false);
    const councilRow = page.items.find((row) => row.id === council.id);
    expect(councilRow?.name).toBeNull();
    expect(councilRow?.administrators).toEqual([]);

    const asOwner = await test.services.spaces.organizationOverview(accountPrincipal(owner), org.id);
    expect(asOwner.items.find((row) => row.id === wiki.id)?.canManage).toBe(true);
  });

  it("filters by name, key, type and state without matching confidential names", async () => {
    const org = await organization();
    const owner = await member(org.id, "member", "Owner");
    const wiki = await space(org.id, owner, { name: "Handbook" });
    await test.services.spaces.create(
      accountPrincipal(owner),
      org.id,
      {
        name: "Secret handbook",
        key: `C${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`,
        visibility: "private",
        confidential: true,
        grants: [],
      },
      test.services.spacePermissions.holders,
    );
    const actor = accountPrincipal(owner);
    const found = await test.services.spaces.organizationOverview(actor, org.id, {
      limit: 25,
      search: "handbook",
    });
    expect(found.items.map((row) => row.id)).toEqual([wiki.id]);
    expect(
      (await test.services.spaces.organizationOverview(actor, org.id, { limit: 25 }, { state: "archived" }))
        .items,
    ).toEqual([]);
    expect(
      (
        await test.services.spaces.organizationOverview(
          actor,
          org.id,
          { limit: 25 },
          { type: "knowledgeBase" },
        )
      ).items,
    ).toEqual([]);
  });
});
