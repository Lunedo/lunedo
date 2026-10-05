import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import type { Database } from "../database/database.js";
import type { MembershipKind } from "../organizations/access-schema.js";
import type { AccountServices } from "../services.js";
import type { SpaceVisibility } from "../spaces/schema.js";
import type { SpaceGrant } from "../spaces/settings.js";

export function spaceFixtures(test: () => { database: Database; services: AccountServices }) {
  async function account(options: { type?: "standard" | "guest"; name?: string } = {}): Promise<string> {
    const services = test();
    if (options.type === "guest") {
      const id = randomUUID();
      await services.database.execute(sql`
        insert into accounts (id, type, state, email, name)
        values (${id}, 'guest', 'active', ${`${id}@guest.example.org`}, ${options.name ?? "Guest"})`);
      return id;
    }
    const created = await services.database.transaction((tx) =>
      services.services.accounts.createStandard(tx, {
        email: `${randomUUID()}@example.org`,
        name: options.name ?? `Person ${randomUUID().slice(0, 6)}`,
        password: "a long test passphrase",
        homeOrganizationId: null,
      }),
    );
    return created.id;
  }

  async function organization() {
    const owner = await account({ name: "Owner" });
    const created = await test().services.organizations.createAsActor(SYSTEM, {
      name: `Organization ${randomUUID().slice(0, 8)}`,
      ownerAccountId: owner,
    });
    return { id: created.id, owner };
  }

  async function join(organizationId: string, accountId: string, kind: MembershipKind = "member") {
    await test().database.transaction((tx) =>
      test().services.memberships.add(tx, SYSTEM, { organizationId, accountId, kind }),
    );
  }

  async function member(organizationId: string, kind: MembershipKind = "member", name?: string) {
    const id = await account(
      kind === "guest" ? { type: "guest", ...(name ? { name } : {}) } : name ? { name } : {},
    );
    await join(organizationId, id, kind);
    return id;
  }

  async function group(organizationId: string, members: string[]) {
    const created = await test().services.groups.create(SYSTEM, organizationId, {
      name: `Group ${randomUUID().slice(0, 8)}`,
    });
    for (const id of members) await test().services.groups.addMember(SYSTEM, created.id, id);
    return created.id;
  }

  async function space(
    organizationId: string,
    creator: string,
    options: { visibility?: SpaceVisibility; grants?: SpaceGrant[]; name?: string; key?: string } = {},
  ) {
    const services = test().services;
    const name = options.name ?? `Space ${randomUUID().slice(0, 8)}`;
    return services.spaces.create(
      accountPrincipal(creator),
      organizationId,
      {
        name,
        key: options.key ?? (await services.spaces.suggestKey(name)),
        visibility: options.visibility ?? "private",
        grants: options.grants ?? [],
      },
      services.spacePermissions.holders,
    );
  }

  async function deactivate(accountId: string) {
    await test().database.execute(sql`update accounts set state = 'deactivated' where id = ${accountId}`);
  }

  async function role(accountId: string, spaceId: string) {
    return (await test().services.authorization.spaceRole(accountId, spaceId, { fresh: true })).role;
  }

  return { account, organization, join, member, group, space, deactivate, role };
}
