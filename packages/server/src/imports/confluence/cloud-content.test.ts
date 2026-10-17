import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../../accounts/principal.js";
import { testDatabaseBaseUrl } from "../../testing/database.js";
import { createTestServices, type TestServices } from "../../testing/services.js";
import { spaceFixtures } from "../../testing/spaces.js";
import { createXmlExport, type SyntheticExport } from "../testing/confluence-export.js";
import { ALICE, BOB } from "../testing/fixture.js";
import { importHarness } from "../testing/harness.js";

const baseUrl = testDatabaseBaseUrl();
const as = (id: string) => accountPrincipal(id);

function cloudModel(): SyntheticExport {
  const page = (id: string, title: string, parentId: string | null, extra: Record<string, unknown> = {}) => ({
    id,
    title,
    parentId,
    position: Number(id),
    body: `<p>${title}</p>`,
    creatorKey: ALICE.key,
    ...extra,
  });
  return {
    space: { id: "9001", key: "CLD", name: "Cloud content", homePageId: "9100" },
    users: [ALICE, BOB],
    pages: [
      page("9100", "Cloud home", null),
      page("9101", "Plans", "9100", { kind: "folder" }),
      page("9102", "Meeting notes", "9101"),
      page("9103", "Example site", "9100", {
        kind: "embed",
        body: '<a href="https://example.org/" data-card-appearance="embed">https://example.org/</a>',
      }),
      page("9104", "Board with notes", "9100", {
        kind: "embed",
        body: '<a href="https://example.com/board" data-card-appearance="embed">https://example.com/board</a>',
      }),
      page("9105", "Notes on the board", "9104"),
      page("9106", "Retro board", "9100", { kind: "whiteboard" }),
      page("9107", "Requirements table", "9100", { kind: "database" }),
      page("9108", "Old phone system", "9100", { status: "archived" }),
      page("9109", "Old phone numbers", "9108", { status: "archived" }),
      page("9110", "Discarded idea", "9100", { status: "deleted" }),
      page("9111", "Shared page", "9100"),
      page("9112", "Restricted area", "9100"),
      page("9113", "Archived secrets", "9112", { status: "archived" }),
      page("9114", "Projects", "9100"),
      page("9115", "Closed projects", "9114", { kind: "folder" }),
      page("9116", "Old project", "9115"),
    ],
    attachments: [],
    restrictions: [
      { id: "9201", contentId: "9111", kind: "View", userKey: ALICE.key },
      { id: "9202", contentId: "9111", kind: "Edit", group: "tombstone" },
      { id: "9203", contentId: "9112", kind: "View", userKey: ALICE.key },
    ],
    spacePermissions: [
      { id: "9301", type: "VIEWSPACE", allUsers: true },
      { id: "9302", type: "EDITSPACE", allUsers: true },
      { id: "9303", type: "VIEWSPACE", allUsers: "productAdmins" },
      { id: "9304", type: "SETSPACEPERMISSIONS", allUsers: "productAdmins" },
      { id: "9305", type: "VIEWSPACE", userKey: ALICE.key },
      { id: "9306", type: "EDITSPACE", userKey: ALICE.key },
      { id: "9307", type: "SETSPACEPERMISSIONS", userKey: ALICE.key },
      { id: "9308", type: "VIEWSPACE", userKey: BOB.key },
      { id: "9309", type: "EDITSPACE", userKey: BOB.key },
      { id: "9310", type: "SETSPACEPERMISSIONS", userKey: BOB.key },
      { id: "9311", type: "ACCESSANALYTICS", group: "analysts" },
    ],
  };
}

describe.skipIf(!baseUrl)("Confluence Cloud content types, archive and trash", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);
  const harness = importHarness(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl as string);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function items(importId: string) {
    const result = await test.database.execute<{
      title: string;
      kind: string;
      parent: string | null;
      link_url: string | null;
      archived: boolean;
      archived_root: string | null;
      document: unknown;
      restrictions: string[] | null;
    }>(sql`
      select t.title, t.kind, coalesce(p.title, r.title) as parent, t.link_url, t.archived_at is not null as archived,
        a.title as archived_root, d.snapshot as document,
        (select array_agg(kind::text order by kind) from page_restrictions x where x.item_id = t.id) as restrictions
      from imports i join tree_items t on t.space_id = i.quarantine_space_id
        left join tree_items p on p.id = t.parent_id left join tree_items r on r.id = t.restore_parent_id
        left join tree_items a on a.id = t.archived_root_id left join page_documents d on d.item_id = t.id
      where i.id = ${importId}`);
    return new Map(result.rows.map((row) => [row.title, row]));
  }

  async function problems(importId: string) {
    const result = await test.database.execute<{ code: string; details: Record<string, unknown> }>(
      sql`select code, details from import_problems where import_id = ${importId}`,
    );
    return result.rows;
  }

  async function grants(importId: string) {
    const result = await test.database.execute<{
      holder_kind: string;
      group_key: string | null;
      role: string | null;
      code: string | null;
    }>(sql`
      select holder_kind, group_key, role, code from import_grants where import_id = ${importId} and item_id is null
      order by holder_kind, group_key, role`);
    return result.rows;
  }

  async function expectCloudContent(importId: string) {
    const found = await items(importId);
    expect(found.get("Plans")).toMatchObject({ kind: "folder", document: null });
    expect(found.get("Meeting notes")).toMatchObject({ kind: "page", parent: "Plans" });
    expect(found.get("Example site")).toMatchObject({ kind: "link", link_url: "https://example.org/" });
    expect(found.get("Board with notes")?.kind).toBe("page");
    expect(JSON.stringify(found.get("Board with notes")?.document)).toContain("https://example.com/board");
    expect(found.get("Notes on the board")?.parent).toBe("Board with notes");
    expect(JSON.stringify(found.get("Retro board")?.document)).toContain(
      "Confluence whiteboard not imported.",
    );
    expect(JSON.stringify(found.get("Requirements table")?.document)).toContain(
      "Confluence database not imported.",
    );
    expect(found.get("Old phone system")).toMatchObject({
      archived: true,
      archived_root: "Old phone system",
    });
    expect(found.get("Old phone numbers")).toMatchObject({
      archived_root: "Old phone system",
      parent: "Old phone system",
    });
    expect(found.has("Discarded idea")).toBe(false);
    expect(found.get("Shared page")?.restrictions).toEqual(["view"]);
    expect(found.get("Archived secrets")).toMatchObject({ archived: true, parent: "Restricted area" });
    const inherited = await test.database.execute<{ restricted: boolean }>(sql`
      select exists (select 1 from page_restrictions r where r.item_id = any(t.path) and r.kind = 'view') as restricted
      from imports i join tree_items t on t.space_id = i.quarantine_space_id
      where i.id = ${importId} and t.title = 'Archived secrets'`);
    expect(inherited.rows[0]?.restricted).toBe(true);
    const reported = await problems(importId);
    expect(reported).toEqual(
      expect.arrayContaining([
        { code: "trashedContent", details: { title: "Discarded idea" } },
        { code: "contentTypeNotImported", details: { type: "whiteboard", title: "Retro board" } },
        { code: "contentTypeNotImported", details: { type: "database", title: "Requirements table" } },
      ]),
    );
    return grants(importId);
  }

  it.each(["xml", "csv"] as const)("imports Confluence Cloud content of a %s export", async (format) => {
    const organization = await fixtures.organization();
    const view = await harness.imported(cloudModel(), {
      organizationId: organization.id,
      admin: organization.owner,
      key: `CL${format.toUpperCase()}`,
      format,
    });
    expect(view.state).toBe("review");
    expect(await expectCloudContent(view.id)).toEqual([
      { holder_kind: "account", group_key: null, role: "admin", code: null },
      { holder_kind: "account", group_key: null, role: "admin", code: null },
      { holder_kind: "organizationMembers", group_key: null, role: "editor", code: "widened" },
    ]);
  });

  it("asks for the space of a site backup and imports only the chosen one", async () => {
    const organization = await fixtures.organization();
    const imports = test.services.imports;
    const admin = as(organization.owner);
    const archive = createXmlExport({
      ...cloudModel(),
      siteSpaces: [{ id: "9901", key: "OTHER", name: "Another space" }],
    });
    const created = await imports.create(admin, organization.id, { source: "confluence-xml" });
    const uploadId = await harness.upload(organization.owner, organization.id, archive);
    await imports.update(admin, created.id, { file: { kind: "upload", uploadId } });
    await harness.drive(created.id);
    const asked = await imports.get(admin, created.id);
    expect(asked).toMatchObject({ state: "draft", errorCode: "spaceChoiceRequired", found: null });
    expect(asked.sourceSpaces).toEqual([
      { key: "CLD", name: "Cloud content" },
      { key: "OTHER", name: "Another space" },
    ]);
    await imports.update(admin, created.id, { options: { spaceKey: "CLD" } });
    await harness.drive(created.id);
    const ready = await imports.get(admin, created.id);
    expect(ready).toMatchObject({ state: "ready", found: { spaceKey: "CLD" }, options: { spaceKey: "CLD" } });
    expect(ready.sourceSpaces?.map((choice) => choice.key)).toEqual(["CLD", "OTHER"]);
    await imports.update(admin, created.id, { spaceName: "From the backup", spaceKey: "CLSITE" });
    await imports.setPeopleSource(admin, created.id, { kind: "skip", confirmed: true });
    await imports.start(admin, created.id);
    await harness.drive(created.id);
    const groups = (await grants(created.id)).map((grant) => grant.group_key);
    expect(groups).not.toContain("confluence-users");
    await expect(imports.update(admin, created.id, { options: { pageIds: ["9102"] } })).rejects.toMatchObject(
      { code: "importStarted" },
    );
  });

  it("refuses a page selection for an export", async () => {
    const organization = await fixtures.organization();
    const imports = test.services.imports;
    const admin = as(organization.owner);
    const created = await imports.create(admin, organization.id, { source: "confluence-xml" });
    await expect(imports.update(admin, created.id, { options: { pageIds: ["9102"] } })).rejects.toMatchObject(
      {
        code: "invalidOptions",
      },
    );
  });
});
