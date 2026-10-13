import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { countQueries } from "../testing/queries.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { readText } from "../testing/streams.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("permission overview export", () => {
  let test: TestServices;
  const { organization, member, group, space } = spaceFixtures(() => test);

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

  async function exported(viewer: string, organizationId: string, accountId: string | null = null) {
    const lines = await test.services.accessExplanations.overviewCsv(
      accountPrincipal(viewer),
      organizationId,
      accountId,
    );
    return (await readText(lines)).split("\r\n").filter(Boolean);
  }

  async function countedExport(viewer: string, organizationId: string) {
    const queries = countQueries(test.pool);
    try {
      return { lines: await exported(viewer, organizationId), queries: queries.count };
    } finally {
      queries.stop();
    }
  }

  async function organizationWith(people: number, spaces: number) {
    const org = await organization();
    const members: string[] = [];
    for (let index = 0; index < people; index += 1) members.push(await member(org.id));
    const team = await group(org.id, members.slice(0, Math.ceil(people / 2)));
    for (let index = 0; index < spaces; index += 1) {
      const created = await space(org.id, org.owner, {
        visibility: index % 2 === 0 ? "organization" : "private",
        grants: [
          { principalKind: "group", principalId: team, role: "editor" },
          { principalKind: "account", principalId: members[index % people] ?? org.owner, role: "admin" },
        ],
      });
      const shared = await page(org.owner, created.id, `Shared ${index}`);
      await test.services.pageAccess.change(accountPrincipal(org.owner), shared.id, [
        { action: "share", holderKind: "group", holderId: team, role: "commenter" },
      ]);
      const linked = await page(org.owner, created.id, `Linked ${index}`);
      const { token } = await test.services.shareLinks.create(accountPrincipal(org.owner), linked.id, {
        scope: "organization",
      });
      for (const person of members) {
        await test.services.shareLinks.open(token, accountPrincipal(person), { clientIp: "192.0.2.10" });
      }
    }
    return { org, members, team };
  }

  it("runs the same number of queries for few and for many people and spaces", async () => {
    const small = await organizationWith(2, 1);
    const large = await organizationWith(7, 5);
    const few = await countedExport(small.org.owner, small.org.id);
    const many = await countedExport(large.org.owner, large.org.id);
    expect(many.lines.length).toBeGreaterThan(few.lines.length * 3);
    expect(many.queries).toBe(few.queries);
  });

  it("lists every source of access of every member, like the overview of one person", async () => {
    const { org, members } = await organizationWith(3, 2);
    const lines = await exported(org.owner, org.id);
    expect(lines[0]).toBe("person,email,kind,space,page,role,pages,reason");
    const joined = lines.join("\n");
    expect(joined).toContain("space role editor (group ");
    expect(joined).toContain("space role reader (space visible to organization)");
    expect(joined).toContain("space role admin (direct)");
    expect(joined).toContain("shared as commenter with group ");
    expect(joined).toContain("share link (organization)");
    for (const person of members) {
      const own = await exported(org.owner, org.id, person);
      const overview = await test.services.accessExplanations.personAccess(
        accountPrincipal(org.owner),
        person,
        {
          organizationId: org.id,
        },
      );
      expect(own.length - 1).toBe(overview.entries.length);
      for (const line of own.slice(1)) expect(lines).toContain(line);
    }
  });

  it("streams organizations larger than one batch and records the export before the first row", async () => {
    const org = await organization();
    const project = await space(org.id, org.owner, { visibility: "organization" });
    await test.database.execute(sql`
      with created as (
        insert into accounts (id, type, state, email, name)
        select gen_random_uuid(), 'standard', 'active', 'bulk-' || n || '-' || ${org.id} || '@example.org', 'Bulk ' || lpad(n::text, 4, '0')
        from generate_series(1, 520) as n
        returning id
      )
      insert into memberships (id, organization_id, account_id, kind)
      select gen_random_uuid(), ${org.id}, id, 'member' from created`);
    const lines = await test.services.accessExplanations.overviewCsv(
      accountPrincipal(org.owner),
      org.id,
      null,
    );
    const recorded = await test.database.execute<{ fields: Record<string, unknown> }>(sql`
      select fields from audit_events where name = 'access.overviewExported' and target_id = ${org.id}`);
    expect(recorded.rows.map((row: { fields: Record<string, unknown> }) => row.fields)).toEqual([
      { accountId: null, people: 521 },
    ]);
    const rows = (await readText(lines)).split("\r\n").filter(Boolean);
    const inProject = rows.filter((row) => row.includes(project.name));
    expect(inProject).toHaveLength(521);
    expect(inProject.at(-1)).toContain("Owner");
  });

  it("refuses the export of one person the caller cannot see", async () => {
    const org = await organization();
    const other = await organization();
    const stranger = await member(other.id);
    await expect(
      test.services.accessExplanations.overviewCsv(accountPrincipal(org.owner), org.id, stranger),
    ).rejects.toMatchObject({ code: "personNotFound" });
    const recorded = await test.database.execute(sql`
      select 1 from audit_events where name = 'access.overviewExported' and target_id = ${org.id}`);
    expect(recorded.rows).toEqual([]);
  });
});
