import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { ABANDONED_DRAFT_DAYS } from "./imports.js";

const baseUrl = testDatabaseBaseUrl();
const TOKEN = "atlassian-token-value-abandoned";

const atlassian = (async (input: string | URL | Request) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.pathname === "/wiki/rest/api/user/current") {
    return Response.json({ accountId: "557058:importer", type: "known" });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;

describe.skipIf(!baseUrl)("API tokens of import drafts", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);
  const as = (id: string) => accountPrincipal(id);

  beforeAll(async () => {
    test = await createTestServices(baseUrl as string, { atlassianFetch: atlassian });
  });

  afterAll(async () => {
    await test?.close();
  });

  async function administrator(organizationId: string) {
    const id = await fixtures.member(organizationId);
    const assignment = await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id },
    });
    return { id, assignmentId: assignment.id };
  }

  async function draftWithToken(organizationId: string, importer: string): Promise<string> {
    const draft = await test.services.imports.create(as(importer), organizationId, {
      source: "confluence-xml",
    });
    await test.services.imports.setPeopleSource(as(importer), draft.id, {
      kind: "token",
      site: "example.atlassian.net",
      email: "importer@example.org",
      token: TOKEN,
    });
    return draft.id;
  }

  async function hasToken(importId: string): Promise<boolean> {
    const result = await test.database.execute(
      sql`select 1 from import_credentials where import_id = ${importId}`,
    );
    return result.rows.length > 0;
  }

  async function deletions(importId: string): Promise<string[]> {
    const result = await test.database.execute<{ reason: string }>(sql`
      select fields ->> 'reason' as reason from audit_events
      where name = 'import.tokenDeleted' and target_id = ${importId} order by sequence`);
    return result.rows.map((row) => row.reason);
  }

  it("is deleted when the importer's administrator role is removed", async () => {
    const organization = await fixtures.organization();
    const importer = await administrator(organization.id);
    const id = await draftWithToken(organization.id, importer.id);
    await test.services.roles.unassign(SYSTEM, "organization", organization.id, importer.assignmentId);
    expect(await hasToken(id)).toBe(false);
    expect(await deletions(id)).toEqual(["permissionLost"]);
    const row = await test.database.execute<{ token_deleted_at: Date | null }>(
      sql`select token_deleted_at from imports where id = ${id}`,
    );
    expect(row.rows[0]?.token_deleted_at).not.toBeNull();
  });

  it("is deleted when the importer leaves the organization", async () => {
    const organization = await fixtures.organization();
    const importer = await administrator(organization.id);
    const id = await draftWithToken(organization.id, importer.id);
    await test.services.memberships.remove(SYSTEM, organization.id, importer.id, "removed", {
      releaseHome: true,
    });
    expect(await hasToken(id)).toBe(false);
    expect(await deletions(id)).toEqual(["permissionLost"]);
  });

  it("is deleted when the importer leaves the group that gives the role", async () => {
    const organization = await fixtures.organization();
    const importer = await fixtures.member(organization.id);
    const group = await fixtures.group(organization.id, [importer]);
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: organization.id,
      role: { builtIn: "administrator" },
      principal: { kind: "group", id: group },
    });
    const id = await draftWithToken(organization.id, importer);
    await test.services.groups.removeMember(SYSTEM, group, importer);
    expect(await hasToken(id)).toBe(false);
  });

  it("is deleted when the importer's account is deactivated", async () => {
    const organization = await fixtures.organization();
    const importer = await administrator(organization.id);
    const id = await draftWithToken(organization.id, importer.id);
    await test.services.memberships.deactivate(SYSTEM, importer.id);
    expect(await hasToken(id)).toBe(false);
  });

  it("stays while the importer can still import through another role", async () => {
    const organization = await fixtures.organization();
    const importer = await fixtures.member(organization.id);
    const group = await fixtures.group(organization.id, [importer]);
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: organization.id,
      role: { builtIn: "administrator" },
      principal: { kind: "group", id: group },
    });
    const direct = await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: organization.id,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: importer },
    });
    const id = await draftWithToken(organization.id, importer);
    await test.services.roles.unassign(SYSTEM, "organization", organization.id, direct.id);
    expect(await hasToken(id)).toBe(true);
    expect(await deletions(id)).toEqual([]);
  });

  it("is deleted by the safety net once the draft was left alone long enough", async () => {
    const organization = await fixtures.organization();
    const fresh = await draftWithToken(organization.id, organization.owner);
    const old = await draftWithToken(organization.id, organization.owner);
    await test.database.execute(sql`
      update imports set updated_at = now() - make_interval(days => ${ABANDONED_DRAFT_DAYS + 1}) where id = ${old}`);
    while ((await test.services.imports.removeAbandonedCredentials()) > 0) {}
    expect(await hasToken(old)).toBe(false);
    expect(await deletions(old)).toEqual(["abandoned"]);
    expect(await hasToken(fresh)).toBe(true);
  });

  it("must be entered again before a draft whose token was deleted can start", async () => {
    const organization = await fixtures.organization();
    const importer = await administrator(organization.id);
    const id = await draftWithToken(organization.id, importer.id);
    await test.database.execute(sql`
      update imports set updated_at = now() - make_interval(days => ${ABANDONED_DRAFT_DAYS + 1}) where id = ${id}`);
    while ((await test.services.imports.removeAbandonedCredentials()) > 0) {}
    await test.database.execute(sql`
      update imports set state = 'ready', space_name = 'Imported', space_key = 'TOKENGONE' where id = ${id}`);
    const view = await test.services.imports.get(as(importer.id), id);
    expect(view.peopleSource).toMatchObject({ kind: "token", site: null });
    expect(view.tokenDeletedAt).not.toBeNull();
    await expect(test.services.imports.start(as(importer.id), id)).rejects.toMatchObject({
      code: "tokenMissing",
    });
  });
});
