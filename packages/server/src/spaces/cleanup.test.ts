import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("clean-up of protected spaces", () => {
  let test: TestServices;
  const { organization, member } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function orphanedAt(spaceId: string): Promise<Date | string | null> {
    const result = await test.database.execute<{ orphaned_at: Date | string | null }>(
      sql`select orphaned_at from spaces where id = ${spaceId}`,
    );
    return result.rows[0]?.orphaned_at ?? null;
  }

  it("forgets an old empty period once someone is active again, so it never shortens the next one", async () => {
    const org = await organization();
    const lead = await member(org.id);
    const helper = await member(org.id);
    const council = await test.services.spaces.create(
      accountPrincipal(lead),
      org.id,
      {
        name: `Council ${randomUUID().slice(0, 6)}`,
        key: `C${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`,
        visibility: "private",
        confidential: true,
        grants: [],
      },
      test.services.spacePermissions.holders,
    );
    await test.database.execute(
      sql`update spaces set orphaned_at = now() - interval '90 days' where id = ${council.id}`,
    );
    await test.services.spacePermissions.apply(accountPrincipal(lead), council.id, {
      action: "grant",
      principalKind: "account",
      principalId: helper,
      role: "editor",
    });
    expect(await orphanedAt(council.id)).toBeNull();

    await test.services.memberships.deactivate(accountPrincipal(org.owner), lead);
    expect(await orphanedAt(council.id)).toBeNull();
    await test.services.memberships.deactivate(accountPrincipal(org.owner), helper);
    const marked = await orphanedAt(council.id);
    expect(marked).not.toBeNull();
    expect(Date.now() - new Date(marked ?? 0).getTime()).toBeLessThan(60_000);
    expect((await test.services.spaceCleanup.list(org.id)).items).toEqual([]);
  });

  it("keeps a personal space with an active group member out of the clean-up and marks it once nobody is left", async () => {
    const org = await organization();
    const owner = await member(org.id);
    const colleague = await member(org.id);
    const personal = await test.services.personalSpaces.ensure(accountPrincipal(owner), "Mine");
    const group = await test.services.groups.create(accountPrincipal(org.owner), org.id, {
      name: `Team ${randomUUID().slice(0, 6)}`,
    });
    await test.services.groups.addMember(accountPrincipal(org.owner), group.id, colleague);
    await test.services.spacePermissions.apply(accountPrincipal(owner), personal.id, {
      action: "grant",
      principalKind: "group",
      principalId: group.id,
      role: "reader",
    });
    await test.services.memberships.deactivate(accountPrincipal(org.owner), owner);
    expect(await orphanedAt(personal.id)).toBeNull();
    await test.services.memberships.deactivate(accountPrincipal(org.owner), colleague);
    expect(await orphanedAt(personal.id)).not.toBeNull();
  });

  it("clears the empty period when someone of the space is reactivated", async () => {
    const org = await organization();
    const lead = await member(org.id);
    const council = await test.services.spaces.create(
      accountPrincipal(lead),
      org.id,
      {
        name: `Council ${randomUUID().slice(0, 6)}`,
        key: `C${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`,
        visibility: "private",
        confidential: true,
        grants: [],
      },
      test.services.spacePermissions.holders,
    );
    await test.services.memberships.deactivate(accountPrincipal(org.owner), lead);
    expect(await orphanedAt(council.id)).not.toBeNull();
    await test.services.administration.reactivate(accountPrincipal(org.owner), lead);
    expect(await orphanedAt(council.id)).toBeNull();
  });
});
