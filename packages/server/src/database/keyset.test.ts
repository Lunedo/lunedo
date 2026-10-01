import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { SYSTEM } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import type { Page, PageRequest } from "./keyset.js";

const baseUrl = testDatabaseBaseUrl();

async function pageThrough<T>(
  load: (page: PageRequest) => Promise<Page<T>>,
  id: (item: T) => string,
): Promise<string[]> {
  const seen: string[] = [];
  let page: PageRequest = { limit: 2 };
  for (let round = 0; round < 100; round += 1) {
    const result = await load(page);
    expect(result.items.length).toBeLessThanOrEqual(2);
    seen.push(...result.items.map(id));
    if (!result.next) return seen;
    page = { limit: 2, after: result.next };
  }
  throw new Error("Paging did not end");
}

describe.skipIf(!baseUrl)("keyset pagination", () => {
  let test: TestServices;
  let organizationId: string;
  let owner: string;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
    await test.pool.query(
      "insert into setting_values (id, level, scope_id, key, value) values (gen_random_uuid(), 'instance', '00000000-0000-0000-0000-000000000000', 'mail.smtp', $1)",
      [
        JSON.stringify({
          host: "smtp.example.org",
          port: 25,
          security: "none",
          username: null,
          from: "wiki@example.org",
        }),
      ],
    );
    owner = await standard(null, "Owner");
    organizationId = (
      await test.services.organizations.createAsActor(SYSTEM, { name: "Paging", ownerAccountId: owner })
    ).id;
    for (const name of ["anna", "Bert", "bert", "Cleo", "Émile", "zoe", "Zoe"])
      await standard(organizationId, name);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function standard(home: string | null, name: string): Promise<string> {
    const account = await test.database.transaction((tx) =>
      test.services.accounts.createStandard(tx, {
        email: `${randomUUID()}@example.org`,
        name,
        password: "a long test passphrase",
        homeOrganizationId: home,
      }),
    );
    return account.id;
  }

  async function expectComplete<T>(
    load: (page: PageRequest) => Promise<Page<T>>,
    id: (item: T) => string,
    expected: number,
  ) {
    const all = (await load({ limit: 1000 })).items.map(id);
    expect(all).toHaveLength(expected);
    expect(await pageThrough(load, id)).toEqual(all);
  }

  it("pages accounts, organizations and members without gaps or duplicates", async () => {
    const accounts = (await test.services.accounts.list({ limit: 1000 })).items;
    await expectComplete(
      (page) => test.services.accounts.list(page),
      (item) => item.id,
      accounts.length,
    );
    const names = accounts.map((account) => account.name.toLowerCase());
    expect(names).toEqual([...names].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
    for (const name of ["Second", "third", "Fourth"]) {
      await test.services.organizations.createAsActor(SYSTEM, { name, ownerAccountId: owner });
    }
    await expectComplete(
      (page) => test.services.organizations.list(page),
      (item) => item.id,
      4,
    );
    await expectComplete(
      (page) => test.services.memberships.list(organizationId, page),
      (item) => item.accountId,
      8,
    );
    const members = (await test.services.memberships.list(organizationId)).items;
    expect(members.find((member) => member.accountId === owner)?.roles.map((role) => role.role)).toEqual([
      "owner",
    ]);
  });

  it("pages groups, group members, invitations and role assignments", async () => {
    const members = (await test.services.memberships.list(organizationId)).items;
    for (const name of ["Delta", "alpha", "Charlie", "bravo", "Echo"]) {
      const group = await test.services.groups.create(SYSTEM, organizationId, { name });
      if (name === "Delta") {
        for (const member of members)
          await test.services.groups.addMember(SYSTEM, group.id, member.accountId);
        await expectComplete(
          (page) => test.services.groups.members(group.id, page),
          (item) => item.accountId,
          members.length,
        );
      }
    }
    await expectComplete(
      (page) => test.services.groups.list(organizationId, page),
      (item) => item.id,
      5,
    );
    for (const email of ["c@example.org", "A@example.org", "b@example.org"]) {
      await test.services.invitations.create(SYSTEM, organizationId, { email, kind: "member" });
    }
    await expectComplete(
      (page) => test.services.invitations.list(organizationId, page),
      (item) => item.id,
      3,
    );
    for (const member of members.slice(0, 4)) {
      await test.services.roles.assign(SYSTEM, {
        scope: "organization",
        organizationId,
        role: { builtIn: "administrator" },
        principal: { kind: "account", id: member.accountId },
      });
    }
    await expectComplete(
      (page) => test.services.roles.listAssignments("organization", organizationId, page),
      (item) => item.id,
      (await test.services.roles.listAssignments("organization", organizationId)).items.length,
    );
  });

  it("pages service accounts and tokens", async () => {
    for (const name of ["Bot B", "bot a", "Bot C"]) {
      const service = await test.services.serviceAccounts.create(SYSTEM, organizationId, { name });
      for (const token of ["one", "two", "three"]) {
        await test.services.apiTokens.create(SYSTEM, {
          accountId: service.id,
          name: token,
          scopes: { organization: { membersAndGroups: "view" } },
        });
      }
      await expectComplete(
        (page) => test.services.apiTokens.listForAccount(service.id, page),
        (item) => item.id,
        3,
      );
    }
    await expectComplete(
      (page) => test.services.serviceAccounts.list(organizationId, page),
      (item) => item.id,
      3,
    );
    await expectComplete(
      (page) => test.services.apiTokens.listForOrganization(organizationId, page),
      (item) => item.id,
      9,
    );
  });
});
