import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import type { GiveAccessDraft } from "./give-access-drafts.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("give access drafts", () => {
  let test: TestServices;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function setup() {
    const org = await organization();
    const adminId = await member(org.id, "member", "Admin");
    const otherId = await member(org.id, "member", "Other admin");
    const first = await space(org.id, adminId, {
      grants: [{ principalKind: "account", principalId: otherId, role: "admin" }],
    });
    const second = await space(org.id, adminId);
    const draft: GiveAccessDraft = {
      step: 1,
      holder: { kind: "account", id: otherId, name: "Other admin" },
      level: "editor",
      where: "space",
      page: null,
    };
    return { admin: accountPrincipal(adminId), other: accountPrincipal(otherId), first, second, draft };
  }

  it("keeps one draft per person and space until it is discarded", async () => {
    const { admin, other, first, second, draft } = await setup();
    const drafts = test.services.giveAccessDrafts;
    expect(await drafts.get(admin, first.id)).toBeNull();
    await drafts.save(admin, first.id, draft);
    await drafts.save(admin, first.id, { ...draft, step: 2, where: "page" });
    expect(await drafts.get(admin, first.id)).toMatchObject({ step: 2, where: "page" });
    expect(await drafts.get(admin, second.id)).toBeNull();
    expect(await drafts.get(other, first.id)).toBeNull();
    await drafts.discard(admin, first.id);
    expect(await drafts.get(admin, first.id)).toBeNull();
  });

  it("refuses drafts that do not match the assistant", async () => {
    const { admin, first, draft } = await setup();
    await expect(
      test.services.giveAccessDrafts.save(admin, first.id, { ...draft, step: 7 }),
    ).rejects.toThrow();
    await expect(
      test.services.giveAccessDrafts.save(admin, first.id, { ...draft, extra: true } as GiveAccessDraft),
    ).rejects.toThrow();
  });

  it("disappears with the space", async () => {
    const { admin, first, draft } = await setup();
    await test.services.giveAccessDrafts.save(admin, first.id, draft);
    await test.pool.query("delete from spaces where id = $1", [first.id]);
    const rows = await test.pool.query("select 1 from give_access_drafts where space_id = $1", [first.id]);
    expect(rows.rows).toEqual([]);
  });
});
