import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("space audience", () => {
  let test: TestServices;
  const { organization, member, group, space, deactivate } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function page(creator: string, spaceId: string, title: string) {
    return test.services.tree.create(accountPrincipal(creator), spaceId, {
      kind: "page",
      title,
      mode: "live",
      placement: { parentId: null },
    });
  }

  it("includes everyone who may see something in the space and nobody else", async () => {
    const org = await organization();
    const reader = await member(org.id);
    const grouped = await member(org.id);
    const shared = await member(org.id);
    const sharedByGroup = await member(org.id);
    const linked = await member(org.id);
    const outsider = await member(org.id);
    const deactivated = await member(org.id);
    const readers = await group(org.id, [grouped]);
    const sharers = await group(org.id, [sharedByGroup]);
    const project = await space(org.id, org.owner, {
      grants: [
        { principalKind: "account", principalId: reader, role: "reader" },
        { principalKind: "account", principalId: deactivated, role: "reader" },
        { principalKind: "group", principalId: readers, role: "reader" },
      ],
    });
    const plan = await page(org.owner, project.id, "Plan");
    await test.services.pageAccess.change(accountPrincipal(org.owner), plan.id, [
      { action: "share", holderKind: "account", holderId: shared, role: "reader" },
      { action: "share", holderKind: "group", holderId: sharers, role: "reader" },
    ]);
    const budget = await page(org.owner, project.id, "Budget");
    const { token } = await test.services.shareLinks.create(accountPrincipal(org.owner), budget.id, {
      scope: "organization",
    });
    await test.services.shareLinks.open(token, accountPrincipal(linked), { clientIp: "192.0.2.10" });
    await deactivate(deactivated);
    const open = await space(org.id, org.owner, { visibility: "organization" });

    const everyone = [reader, grouped, shared, sharedByGroup, linked, outsider, deactivated];
    expect(await test.services.authorization.spaceAudience(everyone, project.id)).toEqual(
      new Set([reader, grouped, shared, sharedByGroup, linked]),
    );
    expect(await test.services.authorization.spaceAudience(everyone, open.id)).toEqual(
      new Set([reader, grouped, shared, sharedByGroup, linked, outsider]),
    );
  });
});
