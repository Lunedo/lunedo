import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("access scope", () => {
  let test: TestServices;
  const { organization, join, member, space, role } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function allowed(accountId: string, action: string, id: string): Promise<boolean> {
    const type = action.startsWith("space.") ? "space" : "item";
    return (
      await test.services.authorization.explain(
        accountPrincipal(accountId),
        action,
        { type, id },
        { fresh: true },
      )
    ).allowed;
  }

  async function page(creator: string, spaceId: string, title: string, parentId: string | null = null) {
    return test.services.tree.create(accountPrincipal(creator), spaceId, {
      kind: "page",
      title,
      mode: "live",
      placement: { parentId },
    });
  }

  async function events(name: string, targetId: string) {
    const result = await test.database.execute<{ actor_id: string | null; fields: Record<string, unknown> }>(
      sql`select actor_id, fields from audit_events where name = ${name} and target_id = ${targetId}`,
    );
    return result.rows;
  }

  async function confidential(organizationId: string, creator: string, members: string[]) {
    return test.services.spaces.create(
      accountPrincipal(creator),
      organizationId,
      {
        name: `Council ${randomUUID().slice(0, 6)}`,
        key: `C${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`,
        visibility: "private",
        confidential: true,
        grants: members.map((id) => ({
          principalKind: "account" as const,
          principalId: id,
          role: "editor" as const,
        })),
      },
      test.services.spacePermissions.holders,
    );
  }

  describe("an ended membership", () => {
    async function twoOrganizations() {
      const home = await organization();
      const other = await organization();
      const dave = await member(home.id);
      await join(other.id, dave);
      const lead = await member(other.id);
      return { home, other, dave, lead };
    }

    it("leaves space roles, shares and link entries stored but without effect, until the person rejoins", async () => {
      const { other, dave, lead } = await twoOrganizations();
      const project = await space(other.id, lead, {
        grants: [{ principalKind: "account", principalId: dave, role: "editor" }],
      });
      const hidden = await space(other.id, lead);
      const plan = await page(lead, hidden.id, "Plan");
      const budget = await page(lead, hidden.id, "Budget");
      await test.services.pageAccess.change(accountPrincipal(lead), plan.id, [
        { action: "share", holderKind: "account", holderId: dave, role: "editor" },
      ]);
      const { token } = await test.services.shareLinks.create(accountPrincipal(lead), budget.id, {
        scope: "people",
        people: [{ kind: "account", id: dave }],
      });
      await test.services.shareLinks.open(token, accountPrincipal(dave), { clientIp: "192.0.2.10" });
      expect(await role(dave, project.id)).toBe("editor");
      expect(await allowed(dave, "item.edit", plan.id)).toBe(true);
      expect(await allowed(dave, "item.view", budget.id)).toBe(true);

      await test.services.memberships.remove(accountPrincipal(other.owner), other.id, dave);

      expect(await role(dave, project.id)).toBeNull();
      expect(await allowed(dave, "space.edit", project.id)).toBe(false);
      expect(await allowed(dave, "item.view", plan.id)).toBe(false);
      expect(await allowed(dave, "item.view", budget.id)).toBe(false);
      const stored = await test.database.execute<{ permissions: number; shares: number; people: number }>(sql`
        select (select count(*) from space_permissions where principal_id = ${dave})::int as permissions,
          (select count(*) from page_shares where principal_id = ${dave})::int as shares,
          (select count(*) from share_link_people where principal_id = ${dave})::int as people`);
      expect(stored.rows[0]).toEqual({ permissions: 1, shares: 1, people: 1 });

      const viewer = accountPrincipal(lead);
      const space_ = await test.services.accessExplanations.explainAccess(
        viewer,
        { type: "space", id: project.id },
        dave,
      );
      expect(space_.role).toBeNull();
      expect(space_.reasons).toEqual([
        { type: "spaceRole", role: "editor", via: { type: "account" }, inactive: "membershipEnded" },
      ]);
      const item = await test.services.accessExplanations.explainAccess(
        viewer,
        { type: "item", id: plan.id },
        dave,
      );
      expect(item.role).toBeNull();
      expect(item.reasons).toMatchObject([{ type: "share", role: "editor", inactive: "membershipEnded" }]);

      await join(other.id, dave);
      expect(await role(dave, project.id)).toBe("editor");
      expect(await allowed(dave, "item.edit", plan.id)).toBe(true);
      expect(await allowed(dave, "item.view", budget.id)).toBe(true);
    });

    it("shows inactive entries in the access overview with the reason instead of as access", async () => {
      const { other, dave, lead } = await twoOrganizations();
      const project = await space(other.id, lead, {
        grants: [
          { principalKind: "account", principalId: dave, role: "editor" },
          { principalKind: "account", principalId: other.owner, role: "reader" },
        ],
      });
      const plan = await page(lead, project.id, "Plan");
      await test.services.pageAccess.change(accountPrincipal(lead), plan.id, [
        { action: "share", holderKind: "account", holderId: dave, role: "editor" },
      ]);
      await test.services.memberships.remove(accountPrincipal(other.owner), other.id, dave);
      const overview = await test.services.accessExplanations.personAccess(
        accountPrincipal(other.owner),
        dave,
        {
          organizationId: other.id,
        },
      );
      expect(overview.entries.map((entry) => [entry.kind, entry.role, entry.inactive])).toEqual([
        ["space", "editor", "membershipEnded"],
        ["share", "editor", "membershipEnded"],
      ]);
      const csv = await test.services.accessExplanations.overviewCsv(
        accountPrincipal(other.owner),
        other.id,
        dave,
      );
      expect(csv).toContain("inactive: membership ended");
    });

    it("ends the access of a guest whose membership expires, also before the expiry is processed", async () => {
      const org = await organization();
      const lead = await member(org.id);
      const guest = await member(org.id, "guest");
      const project = await space(org.id, lead);
      const plan = await page(lead, project.id, "Plan");
      await test.services.pageAccess.change(accountPrincipal(lead), plan.id, [
        { action: "share", holderKind: "account", holderId: guest, role: "reader" },
      ]);
      expect(await allowed(guest, "item.view", plan.id)).toBe(true);
      await test.database.execute(sql`
        update memberships set expires_at = now() - interval '1 minute'
        where organization_id = ${org.id} and account_id = ${guest}`);
      expect(await allowed(guest, "item.view", plan.id)).toBe(false);
      expect(await test.services.memberships.expire(org.id, guest)).toBe(true);
      expect(await allowed(guest, "item.view", plan.id)).toBe(false);
      expect((await events("membership.removed", guest)).map((row) => row.fields.reason)).toEqual([
        "expired",
      ]);
    });

    it("no longer counts a space admin whose membership ended", async () => {
      const { other, dave, lead } = await twoOrganizations();
      const project = await space(other.id, dave, {
        grants: [{ principalKind: "account", principalId: lead, role: "reader" }],
      });
      await test.services.memberships.remove(accountPrincipal(other.owner), other.id, dave);
      const without = await test.services.spaces.withoutAdministrator(other.id);
      expect(without.items.map((entry) => entry.id)).toContain(project.id);
      await test.services.spaces.appointAdministrator(accountPrincipal(other.owner), project.id, lead);
      expect(await role(lead, project.id)).toBe("admin");
    });

    it("handles a confidential space whose last admin left like one without an admin", async () => {
      const { other, dave, lead } = await twoOrganizations();
      const council = await confidential(other.id, dave, [lead]);
      const minutes = await page(dave, council.id, "Minutes");
      await test.services.memberships.remove(accountPrincipal(other.owner), other.id, dave);
      expect(await allowed(dave, "item.view", minutes.id)).toBe(false);
      const [summary] = (await test.services.confidentialSpaces.list(other.id)).items;
      expect(summary).toMatchObject({ id: council.id, activeMembers: 1, needsAdministrator: true });
      const notified = await test.database.execute<{ recipient_id: string }>(sql`
        select recipient_id from notifications
        where type = 'space.confidentialWithoutAdministrator' and target_id = ${council.id}`);
      expect(notified.rows.map((row) => row.recipient_id)).toContain(other.owner);
      expect(
        (
          await test.services.confidentialSpaces.remainingMembers(
            accountPrincipal(other.owner),
            other.id,
            council.id,
          )
        ).map((entry) => entry.id),
      ).toEqual([lead]);
      await expect(
        test.services.confidentialSpaces.appointAdministrator(
          accountPrincipal(other.owner),
          other.id,
          council.id,
          dave,
        ),
      ).rejects.toMatchObject({ code: "invalidHolder" });
      await test.services.confidentialSpaces.appointAdministrator(
        accountPrincipal(other.owner),
        other.id,
        council.id,
        lead,
      );
      expect(await role(lead, council.id)).toBe("admin");
    });

    it("lets a confidential space be deleted once no member of the organization remains in it", async () => {
      const { other, dave } = await twoOrganizations();
      const council = await confidential(other.id, dave, []);
      await test.services.memberships.remove(accountPrincipal(other.owner), other.id, dave);
      const [summary] = (await test.services.confidentialSpaces.list(other.id)).items;
      expect(summary).toMatchObject({ id: council.id, activeMembers: 0, deletable: true });
    });

    it("removes a one-on-one from the list of the person who left and from their partner's list", async () => {
      const { other, dave, lead } = await twoOrganizations();
      await test.services.oneOnOnes.create(accountPrincipal(lead), {
        otherId: dave,
        organizationId: other.id,
        rhythm: { frequency: "weekly", interval: 1, weekdays: ["MO"] },
        startsOn: "2030-03-18",
        startTime: "09:00",
        timeZone: "Europe/Vienna",
        durationMinutes: 30,
      });
      const before = await test.services.oneOnOnes.list(accountPrincipal(dave));
      expect(before).toHaveLength(1);
      const spaceId = before[0]?.spaceId ?? "";
      await test.services.memberships.remove(accountPrincipal(other.owner), other.id, dave);
      expect(await test.services.oneOnOnes.list(accountPrincipal(dave))).toEqual([]);
      expect(await allowed(dave, "space.view", spaceId)).toBe(false);
      const partner = await test.services.oneOnOnes.list(accountPrincipal(lead));
      expect(partner.map((entry) => entry.partners)).toEqual([[]]);
    });
  });
});
