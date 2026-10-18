import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../../accounts/principal.js";
import { createLogger } from "../../logging/logger.js";
import { testDatabaseBaseUrl } from "../../testing/database.js";
import { testJobContext } from "../../testing/jobs.js";
import { createTestServices, type TestServices } from "../../testing/services.js";
import { spaceFixtures } from "../../testing/spaces.js";
import { atlassianHostsSetting } from "../atlassian.js";
import {
  type FakeConfluence,
  fakeConfluence,
  fakeConfluenceSpaces,
  json,
  response,
} from "../testing/confluence-api.js";
import type { SyntheticExport } from "../testing/confluence-export.js";
import { ALICE, BOB, PNG } from "../testing/fixture.js";
import { importHarness } from "../testing/harness.js";
import type { ConfluenceTransport, TransportResponse } from "./api-client.js";
import { MAX_LISTING_PAGES } from "./paging.js";

const baseUrl = testDatabaseBaseUrl();
const SITE = "example.atlassian.net";
const EMAIL = "importer@example.org";
const TOKEN = "confluence-api-token-4b1d7e";
const BASIC = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64")}`;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const RECENT = /"20(2[6-9]|[3-9]\d)-\d\d-\d\d[T ][^"]*"/g;
const KIND_ORDER = ["page", "template", "person", "comment", "attachment", "attachmentVersion"];

const GUIDE_BODY = [
  '<h1>Guide</h1><p>Read the <ac:link><ri:page ri:content-title="Notes" /></ac:link> first, ask ',
  `<ac:link><ri:user ri:account-id="${BOB.accountId}" /></ac:link>.</p>`,
  '<p>Look at <ac:inline-comment-marker ac:ref="marker-1">this sentence</ac:inline-comment-marker>.</p>',
  "<table><tbody><tr><th>Key</th><th>Value</th></tr><tr><td>VLAN</td><td>42</td></tr></tbody></table>",
  '<p><ac:image ac:alt="Diagram"><ri:attachment ri:filename="diagram.png" /></ac:image></p>',
  '<p>Download <ac:link><ri:attachment ri:filename="report.pdf" /></ac:link></p>',
  '<ac:structured-macro ac:name="details"><ac:rich-text-body><table><tbody><tr><th>Owner</th><td><p>IT</p></td></tr>',
  "</tbody></table></ac:rich-text-body></ac:structured-macro>",
].join("");

function apiModel(): SyntheticExport {
  return {
    space: { id: "7001", key: "APIX", name: "API space", homePageId: "7100" },
    users: [ALICE, BOB],
    pages: [
      {
        id: "7100",
        title: "API home",
        parentId: null,
        position: null,
        body: "<p>Welcome</p>",
        creatorKey: ALICE.key,
      },
      {
        id: "7101",
        title: "Guide",
        parentId: "7100",
        position: 1,
        body: GUIDE_BODY,
        creatorKey: BOB.key,
        modifierKey: ALICE.key,
        labels: ["howto", "network"],
        created: "2024-01-02 03:04:05.000",
        modified: "2024-02-03 04:05:06.000",
      },
      {
        id: "7102",
        title: "Notes",
        parentId: "7100",
        position: 0,
        body: "<p>Notes</p>",
        creatorKey: ALICE.key,
      },
      {
        id: "7103",
        title: "Secret",
        parentId: "7101",
        position: 0,
        body: "<p>Closed</p>",
        creatorKey: ALICE.key,
      },
    ],
    blogPosts: [
      {
        id: "7200",
        title: "Launch",
        parentId: null,
        position: null,
        body: "<p>We launched</p>",
        creatorKey: BOB.key,
        labels: ["news"],
        created: "2024-04-05 06:07:08.000",
      },
    ],
    attachments: [
      { pageId: "7101", fileName: "diagram.png", versions: [{ id: "7301", version: 1, data: PNG }] },
      {
        pageId: "7101",
        fileName: "report.pdf",
        versions: [{ id: "7302", version: 2, data: "%PDF-1.4 api" }],
      },
    ],
    comments: [
      {
        id: "7400",
        pageId: "7101",
        creatorKey: BOB.key,
        body: "<p>Question</p>",
        created: "2024-02-01 10:00:00.000",
      },
      {
        id: "7401",
        pageId: "7101",
        parentId: "7400",
        creatorKey: ALICE.key,
        body: "<p>Answer</p>",
        created: "2024-02-01 11:00:00.000",
      },
      {
        id: "7402",
        pageId: "7101",
        creatorKey: ALICE.key,
        body: "<p>Inline remark</p>",
        inline: { markerRef: "marker-1", selection: "this sentence" },
        status: "resolved",
        resolverKey: BOB.key,
      },
    ],
    likes: [{ id: "7500", contentId: "7101", userKey: BOB.key }],
    spacePermissions: [
      { id: "7600", type: "VIEWSPACE", group: "it-admins" },
      { id: "7601", type: "EDITSPACE", group: "it-admins" },
      { id: "7602", type: "VIEWSPACE", userKey: ALICE.key },
      { id: "7603", type: "SETSPACEPERMISSIONS", userKey: ALICE.key },
      { id: "7604", type: "EDITSPACE", userKey: ALICE.key },
      { id: "7605", type: "VIEWSPACE", userKey: BOB.key },
      { id: "7606", type: "COMMENT", userKey: BOB.key },
    ],
    restrictions: [
      { id: "7700", contentId: "7103", kind: "View", userKey: ALICE.key },
      { id: "7701", contentId: "7103", kind: "View", group: "it-admins" },
      { id: "7702", contentId: "7103", kind: "Edit", userKey: ALICE.key },
    ],
    templates: [
      {
        id: "7800",
        name: "Runbook",
        description: "Steps",
        body: "<h2>Steps</h2><p>Do it</p>",
        creatorKey: ALICE.key,
      },
    ],
  };
}

const PEOPLE: Record<string, { name: string; email?: string }> = {
  [ALICE.accountId]: { name: "Alice Archer", email: "alice.api@example.org" },
  [BOB.accountId]: { name: "Bob Barker" },
};

function atlassianDirectory(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (new Headers(init?.headers).get("authorization") !== BASIC) return new Response("{}", { status: 401 });
    if (url.pathname === "/wiki/rest/api/user/current")
      return Response.json({ accountId: "557058:importer" });
    if (url.pathname === "/wiki/rest/api/user/bulk") {
      return Response.json({
        results: url.searchParams.getAll("accountId").flatMap((id) => {
          const entry = PEOPLE[id];
          return entry
            ? [{ accountId: id, displayName: entry.name, ...(entry.email ? { email: entry.email } : {}) }]
            : [];
        }),
      });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

function secondModel(): SyntheticExport {
  return {
    space: { id: "8001", key: "APIY", name: "Second space", homePageId: "8100" },
    users: [ALICE],
    pages: [
      {
        id: "8100",
        title: "Second home",
        parentId: null,
        position: null,
        body: "<p>Second</p>",
        creatorKey: ALICE.key,
      },
      {
        id: "8101",
        title: "Runbook",
        parentId: "8100",
        position: 1,
        body: "<p>Steps</p>",
        creatorKey: ALICE.key,
      },
    ],
    attachments: [],
  };
}

describe.skipIf(!baseUrl)("Confluence API imports", () => {
  let test: TestServices;
  let current: ConfluenceTransport;
  const transport: ConfluenceTransport = { get: (url, request) => current.get(url, request) };
  const fixtures = spaceFixtures(() => test);
  const harness = importHarness(() => test, { transport, fetch: atlassianDirectory() });
  const as = (id: string) => accountPrincipal(id);

  beforeAll(async () => {
    test = await createTestServices(baseUrl as string, {
      confluenceTransport: transport,
      atlassianFetch: atlassianDirectory(),
    });
  });

  afterAll(async () => {
    await test?.close();
  });

  function serve(
    model = apiModel(),
    options: Partial<Parameters<typeof fakeConfluence>[1]> = {},
  ): FakeConfluence {
    const fake = fakeConfluence(model, { kind: "cloud", site: SITE, authorization: BASIC, ...options });
    current = fake;
    return fake;
  }

  async function connected(organizationId: string, admin: string, options: { history?: boolean } = {}) {
    const imports = test.services.imports;
    const draft = await imports.create(as(admin), organizationId, { source: "confluence-cloud" });
    if (options.history) await imports.update(as(admin), draft.id, { history: true });
    await imports.setConnection(as(admin), draft.id, {
      kind: "cloud",
      site: SITE,
      email: EMAIL,
      token: TOKEN,
    });
    return draft.id;
  }

  async function analyzed(organizationId: string, admin: string, runner = harness.worker()) {
    const id = await connected(organizationId, admin);
    await test.services.imports.update(as(admin), id, { options: { spaceKey: "APIX" } });
    await harness.drive(id, runner);
    return id;
  }

  async function imported(organizationId: string, admin: string, key: string) {
    const id = await analyzed(organizationId, admin);
    const imports = test.services.imports;
    await imports.update(as(admin), id, { spaceName: `Imported ${key}`, spaceKey: key });
    await imports.start(as(admin), id);
    await harness.drive(id);
    return imports.get(as(admin), id);
  }

  async function snapshot(importId: string): Promise<unknown> {
    const view = await test.database.execute<{ quarantine_space_id: string }>(
      sql`select quarantine_space_id from imports where id = ${importId}`,
    );
    const spaceId = view.rows[0]?.quarantine_space_id as string;
    const mapped = await test.database.execute<{ kind: string; source_id: string; target_id: string }>(
      sql`select kind, source_id, target_id from import_items where import_id = ${importId}`,
    );
    const names = new Map<string, string>();
    const rank = (kind: string) => (KIND_ORDER.includes(kind) ? KIND_ORDER.indexOf(kind) : KIND_ORDER.length);
    for (const row of [...mapped.rows].sort((left, right) => rank(left.kind) - rank(right.kind))) {
      if (!names.has(row.target_id)) names.set(row.target_id, `${row.kind}:${row.source_id}`);
    }
    const rows = async (query: ReturnType<typeof sql>) => (await test.database.execute(query)).rows;
    const items = sql`(select id from tree_items where space_id = ${spaceId})`;
    const data = {
      pages: await rows(sql`
        select case when t.id = s.overview_item_id then 'overview' else t.title end as title, t.kind, t.parent_id,
          t.created_at, t.creator_id, t.owner_id, t.position, d.snapshot
        from tree_items t join spaces s on s.id = t.space_id left join page_documents d on d.item_id = t.id
        where t.space_id = ${spaceId} and t.trash_entry_id is null order by t.title`),
      labels: await rows(
        sql`select item_id, label from page_labels where item_id in ${items} order by item_id, label`,
      ),
      attachments: await rows(sql`
        select a.item_id, a.name, a.created_by, f.size, encode(f.content_digest, 'hex') as digest
        from attachments a join attachment_versions v on v.attachment_id = a.id join stored_files f on f.id = v.file_id
        where a.item_id in ${items} order by a.name`),
      comments: await rows(sql`
        select item_id, parent_id, author_id, body, quote, resolved_at, resolved_by, created_at
        from comments where item_id in ${items} order by created_at, quote nulls first`),
      reactions: await rows(sql`select item_id, account_id, emoji from reactions where item_id in ${items}`),
      restrictions: await rows(sql`
        select to_jsonb(r) - 'id' - 'created_at' - 'updated_at' as row from page_restrictions r
        where r.item_id in ${items} order by r.item_id, r.kind`),
      holders: await rows(sql`
        select to_jsonb(h) - 'created_at' - 'updated_at' as row from page_restriction_holders h
        where h.item_id in ${items} order by 1`),
      grants: await rows(sql`
        select holder_kind, account_id, group_key, role, permissions, status, code from import_grants
        where import_id = ${importId} order by holder_kind, group_key, role`),
      templates: await rows(
        sql`select name, description, title, document from page_templates where space_id = ${spaceId}`,
      ),
    };
    const text = JSON.stringify(data)
      .replace(UUID, (id) => names.get(id) ?? "uuid")
      .replace(RECENT, '"now"');
    return JSON.parse(text);
  }

  it("tests the connection before it stores the token", async () => {
    const organization = await fixtures.organization();
    serve();
    const imports = test.services.imports;
    const draft = await imports.create(as(organization.owner), organization.id, {
      source: "confluence-cloud",
    });
    const refused = await imports
      .setConnection(as(organization.owner), draft.id, {
        kind: "cloud",
        site: SITE,
        email: EMAIL,
        token: "wrong",
      })
      .catch((error: unknown) => error);
    expect(refused).toMatchObject({ code: "confluenceUnauthorized" });
    expect(JSON.stringify(refused)).not.toContain("wrong");
    const stored = await test.database.execute(
      sql`select 1 from import_connections where organization_id = ${organization.id}`,
    );
    expect(stored.rows).toHaveLength(0);
    const view = await imports.setConnection(as(organization.owner), draft.id, {
      kind: "cloud",
      site: SITE,
      email: EMAIL,
      token: TOKEN,
    });
    expect(view.connection).toMatchObject({ kind: "cloud", site: SITE, account: "Importer" });
    expect(view.peopleSource?.kind).toBe("token");
    const token = await test.database.execute<{ token: Buffer }>(
      sql`select c.token from import_connections c join imports i on i.connection_id = c.id where i.id = ${draft.id}`,
    );
    expect(token.rows).toHaveLength(1);
    expect(token.rows[0]?.token.toString("utf8")).not.toContain(TOKEN);
  });

  it("lists the spaces and the page trees of the selection with page counts and sizes", async () => {
    const organization = await fixtures.organization();
    serve();
    const id = await connected(organization.id, organization.owner);
    const spaces = await test.services.imports.connectionSpaces(as(organization.owner), id);
    expect(spaces).toEqual([{ id: "7001", key: "APIX", name: "API space", personal: false }]);
    const tree = await test.services.imports.connectionTree(as(organization.owner), id, "APIX");
    expect(tree).toMatchObject({ spaceKey: "APIX", pages: 4, blogPosts: 1, complete: true });
    expect(tree.attachmentBytes).toBe(PNG.length + "%PDF-1.4 api".length);
    expect(tree.trees).toEqual([
      { id: "7101", title: "Guide", pages: 2, attachmentBytes: PNG.length + "%PDF-1.4 api".length },
      { id: "7102", title: "Notes", pages: 1, attachmentBytes: 0 },
    ]);
  });

  it("imports the same result as the XML export of the same space", async () => {
    const organization = await fixtures.organization();
    const model = apiModel();
    serve(model);
    const fromXml = await harness.imported(model, {
      organizationId: organization.id,
      admin: organization.owner,
      key: "VIAXML",
      people: { kind: "token", site: SITE, email: EMAIL, token: TOKEN },
    });
    expect(fromXml.state).toBe("review");
    const fromApi = await imported(organization.id, organization.owner, "VIAAPI");
    expect(fromApi.state).toBe("review");
    expect(fromApi.found).toMatchObject({
      pages: 4,
      blogPosts: 1,
      comments: 3,
      attachments: 2,
      likes: 0,
      people: fromXml.found?.people,
    });
    const { reactions: apiReactions, ...apiContent } = (await snapshot(fromApi.id)) as Record<
      string,
      unknown
    >;
    const { reactions: xmlReactions, ...xmlContent } = (await snapshot(fromXml.id)) as Record<
      string,
      unknown
    >;
    expect(apiContent).toEqual(xmlContent);
    expect(xmlReactions).toHaveLength(1);
    expect(apiReactions).toEqual([]);
    const skipped = await test.services.imports.entries(as(organization.owner), fromApi.id, {
      code: "likesAndWatchersSkipped",
      limit: 10,
    });
    expect(skipped.entries).toHaveLength(1);
  });

  it("imports the page history as far as the API provides it", async () => {
    const organization = await fixtures.organization();
    const model = apiModel();
    const withHistory: SyntheticExport = {
      ...model,
      pages: model.pages.map((page) =>
        page.id === "7102"
          ? {
              ...page,
              history: [
                { id: "7902", body: "<p>First notes</p>", title: "Old notes" },
                { id: "7903", body: "<p>Second notes</p>" },
              ],
            }
          : page,
      ),
    };
    serve(withHistory);
    const id = await connected(organization.id, organization.owner, { history: true });
    await test.services.imports.update(as(organization.owner), id, { options: { spaceKey: "APIX" } });
    await harness.drive(id);
    const ready = await test.services.imports.get(as(organization.owner), id);
    expect(ready.found).toMatchObject({ versions: 2 });
    await test.services.imports.update(as(organization.owner), id, {
      spaceName: "History",
      spaceKey: "HISTAPI",
    });
    await test.services.imports.start(as(organization.owner), id);
    await harness.drive(id);
    const notes = await harness.target(id, "page", "7102");
    const versions = await test.database.execute<{ title: string }>(
      sql`select title from page_versions where item_id = ${notes} order by number`,
    );
    expect(versions.rows.map((row) => row.title)).toEqual(["Old notes", "Notes", "Notes"]);
  });

  function serveSpaces(): FakeConfluence {
    const fake = fakeConfluenceSpaces([apiModel(), secondModel()], {
      kind: "cloud",
      site: SITE,
      authorization: BASIC,
    });
    current = fake;
    return fake;
  }

  async function connections(organizationId: string) {
    const result = await test.database.execute<{ id: string }>(
      sql`select id from import_connections where organization_id = ${organizationId}`,
    );
    return result.rows.map((row) => row.id);
  }

  async function tokenDeletions(importIds: readonly string[]) {
    const result = await test.database.execute<{ target_id: string; reason: string }>(sql`
      select target_id, fields ->> 'reason' as reason from audit_events
      where name = 'import.tokenDeleted' and target_id = any(${sql.param([...importIds])}::text[])
      order by id`);
    return result.rows;
  }

  async function bothSpaces(organizationId: string, admin: string) {
    const id = await connected(organizationId, admin);
    const view = await test.services.imports.selectSpaces(as(admin), id, ["APIX", "APIY"]);
    const sibling = view.connection?.selection.find((entry) => entry.spaceKey === "APIY")?.importId as string;
    return { id, sibling };
  }

  it("imports several spaces as one import each over one connection, one after another", async () => {
    const organization = await fixtures.organization();
    const fake = serveSpaces();
    const imports = test.services.imports;
    const id = await connected(organization.id, organization.owner);
    const spaces = await imports.connectionSpaces(as(organization.owner), id);
    expect(spaces.map((space) => space.key)).toEqual(["APIX", "APIY"]);
    const view = await imports.selectSpaces(as(organization.owner), id, ["APIX", "APIY"]);
    expect(view.options.spaceKey).toBe("APIX");
    expect(view.connection?.selection.map((entry) => entry.spaceKey)).toEqual(["APIX", "APIY"]);
    const sibling = view.connection?.selection.find((entry) => entry.spaceKey === "APIY")?.importId as string;
    expect(sibling).not.toBe(id);
    const shared = await test.database.execute<{ connection_id: string }>(
      sql`select connection_id from imports where id = any(${sql.param([id, sibling])}::uuid[])`,
    );
    expect(new Set(shared.rows.map((row) => row.connection_id)).size).toBe(1);
    expect(await connections(organization.id)).toHaveLength(1);

    const waiting = await imports.get(as(organization.owner), sibling);
    expect(waiting).toMatchObject({ state: "analyzing", source: "confluence-cloud", waitingFor: "APIX" });
    expect(waiting.connection).toMatchObject({ kind: "cloud", site: SITE });
    await harness.worker().work(testJobContext("imports.work", { importId: sibling }));
    expect(fake.requests.some((url) => url.includes("APIY") || url.includes("/8100"))).toBe(false);
    expect((await imports.get(as(organization.owner), sibling)).state).toBe("analyzing");

    await harness.drive(id);
    expect((await imports.get(as(organization.owner), sibling)).waitingFor).toBeNull();
    await harness.drive(sibling);
    const first = await imports.get(as(organization.owner), id);
    const second = await imports.get(as(organization.owner), sibling);
    expect(first).toMatchObject({ state: "ready", found: { spaceKey: "APIX", pages: 4 } });
    expect(second).toMatchObject({ state: "ready", found: { spaceKey: "APIY", pages: 2, blogPosts: 0 } });

    await imports.update(as(organization.owner), id, { spaceName: "First", spaceKey: "FIRSTAPI" });
    await imports.update(as(organization.owner), sibling, { spaceName: "Second", spaceKey: "SECONDAPI" });
    await imports.start(as(organization.owner), id);
    await imports.start(as(organization.owner), sibling);
    await harness.worker().work(testJobContext("imports.work", { importId: sibling }));
    expect((await imports.get(as(organization.owner), sibling)).state).toBe("running");
    await harness.drive(id);
    await harness.drive(sibling);
    const started = [
      await imports.get(as(organization.owner), id),
      await imports.get(as(organization.owner), sibling),
    ];
    expect(started.map((entry) => entry.state)).toEqual(["review", "review"]);
    expect(new Set(started.map((entry) => entry.quarantineSpace?.id)).size).toBe(2);
    const titles = await test.database.execute<{ id: string; title: string }>(sql`
      select i.id, t.title from imports i join tree_items t on t.space_id = i.quarantine_space_id
      where i.id = any(${sql.param([id, sibling])}::uuid[]) and t.title in ('Guide', 'Runbook')`);
    expect(titles.rows.map((row) => [row.id === id ? "first" : "second", row.title]).sort()).toEqual([
      ["first", "Guide"],
      ["second", "Runbook"],
    ]);
  });

  it("removes the drafts of spaces taken out of the selection", async () => {
    const organization = await fixtures.organization();
    serveSpaces();
    const imports = test.services.imports;
    const { id, sibling } = await bothSpaces(organization.id, organization.owner);
    const view = await imports.selectSpaces(as(organization.owner), id, ["APIX"]);
    expect(view.connection?.selection).toEqual([{ importId: id, spaceKey: "APIX" }]);
    const left = await test.database.execute(sql`select 1 from imports where id = ${sibling}`);
    expect(left.rows).toHaveLength(0);
    expect(await connections(organization.id)).toHaveLength(1);
    await expect(imports.selectSpaces(as(organization.owner), id, [])).rejects.toMatchObject({
      code: "invalidSelection",
    });
    await expect(imports.selectSpaces(as(organization.owner), id, ["not a key"])).rejects.toMatchObject({
      code: "invalidSelection",
    });
  });

  it("keeps the shared token until the last import of the connection has ended", async () => {
    const organization = await fixtures.organization();
    serveSpaces();
    const imports = test.services.imports;
    const { id, sibling } = await bothSpaces(organization.id, organization.owner);
    await harness.drive(id);
    await harness.drive(sibling);
    await imports.update(as(organization.owner), id, { spaceName: "First", spaceKey: "KEEPA" });
    await imports.update(as(organization.owner), sibling, { spaceName: "Second", spaceKey: "KEEPB" });
    await imports.start(as(organization.owner), id);
    await harness.drive(id);
    await imports.accept(as(organization.owner), id, { visibility: "private", grants: [] });
    expect(await connections(organization.id)).toHaveLength(1);
    expect(await tokenDeletions([id, sibling])).toEqual([]);
    const accepted = await imports.get(as(organization.owner), id);
    expect(accepted.connection).toBeNull();
    expect((await imports.get(as(organization.owner), sibling)).connection).toMatchObject({ site: SITE });

    await imports.start(as(organization.owner), sibling);
    await harness.drive(sibling);
    await imports.discard(as(organization.owner), sibling, "KEEPB");
    await harness.drive(sibling);
    expect((await imports.get(as(organization.owner), sibling)).state).toBe("discarded");
    expect(await connections(organization.id)).toEqual([]);
    expect(await tokenDeletions([id, sibling])).toEqual([{ target_id: sibling, reason: "discarded" }]);
  });

  it("deletes the shared token when every draft using it was removed or left alone", async () => {
    const organization = await fixtures.organization();
    serveSpaces();
    const imports = test.services.imports;
    const { id, sibling } = await bothSpaces(organization.id, organization.owner);
    await harness.drive(id);
    await harness.drive(sibling);
    await test.database.execute(
      sql`update imports set updated_at = now() - interval '8 days' where id = ${sibling}`,
    );
    await imports.removeAbandonedCredentials();
    expect(await connections(organization.id)).toHaveLength(1);
    expect((await imports.get(as(organization.owner), sibling)).tokenDeletedAt).not.toBeNull();
    expect((await imports.get(as(organization.owner), id)).connection).toMatchObject({ site: SITE });

    await imports.remove(as(organization.owner), id);
    expect(await connections(organization.id)).toEqual([]);
    expect(await tokenDeletions([id, sibling])).toEqual([{ target_id: id, reason: "removed" }]);
    await expect(imports.start(as(organization.owner), sibling)).rejects.toMatchObject({
      code: "tokenMissing",
    });
  });

  it("imports only the chosen page trees", async () => {
    const organization = await fixtures.organization();
    serve();
    const id = await connected(organization.id, organization.owner);
    await test.services.imports.update(as(organization.owner), id, {
      options: { spaceKey: "APIX", pageIds: ["7102"] },
    });
    await harness.drive(id);
    const view = await test.services.imports.get(as(organization.owner), id);
    expect(view.state).toBe("ready");
    expect(view.found).toMatchObject({ pages: 1, blogPosts: 0, attachments: 0 });
  });

  it("waits when Confluence asks to slow down, shows it and goes on", async () => {
    const organization = await fixtures.organization();
    let throttled = 0;
    const fake = serve(apiModel(), {
      before: (url) => {
        if (url.pathname === "/wiki/api/v2/spaces/7001/pages" && throttled < 2) {
          throttled += 1;
          return response(429, { "retry-after": "1" });
        }
        return null;
      },
    });
    const id = await analyzed(organization.id, organization.owner);
    const view = await test.services.imports.get(as(organization.owner), id);
    expect(view.state).toBe("ready");
    expect(throttled).toBe(2);
    expect(view.throttledUntil).not.toBeNull();
    expect(fake.requests.filter((url) => url.includes("/api/v2/spaces/7001/pages?")).length).toBeGreaterThan(
      2,
    );
  });

  it("continues after a restart from the last completed step without reading anything twice", async () => {
    const organization = await fixtures.organization();
    const fake = serve();
    const id = await connected(organization.id, organization.owner);
    await test.services.imports.update(as(organization.owner), id, { options: { spaceKey: "APIX" } });
    const runs = await harness.drive(id, harness.worker(1));
    const view = await test.services.imports.get(as(organization.owner), id);
    expect(runs).toBeGreaterThan(3);
    expect(view.state).toBe("ready");
    expect(view.found).toMatchObject({ pages: 4, comments: 3 });
    const listings = fake.requests.filter((url) => url.includes("/api/v2/spaces/7001/pages?"));
    expect(new Set(listings).size).toBe(listings.length);
    const details = fake.requests.filter((url) => url.includes("/footer-comments?"));
    expect(new Set(details).size).toBe(details.length);
  });

  it("follows attachment downloads only to Atlassian's media service and refuses other redirects", async () => {
    const organization = await fixtures.organization();
    const fake = serve(apiModel(), {
      before: (url): TransportResponse | null =>
        url.pathname.endsWith("/child/attachment/att7302/download")
          ? response(302, { location: "https://attacker.example/steal?file=report.pdf" })
          : null,
    });
    const view = await imported(organization.id, organization.owner, "REDIR");
    expect(view.state).toBe("review");
    expect(fake.requests.some((url) => new URL(url).host === "attacker.example")).toBe(false);
    expect(fake.requests.some((url) => new URL(url).host === "api.media.atlassian.com")).toBe(true);
    const report = await test.services.imports.entries(as(organization.owner), view.id, {
      code: "attachmentFileMissing",
      limit: 10,
    });
    expect(report.entries.map((entry) => entry.details.fileName)).toEqual(["report.pdf"]);

    const second = await fixtures.organization();
    serve(apiModel(), {
      before: (url) =>
        url.pathname === "/wiki/api/v2/spaces"
          ? response(301, { location: "https://attacker.example/wiki/api/v2/spaces" })
          : null,
    });
    const id = await analyzed(second.id, second.owner);
    const failed = await test.services.imports.get(as(second.owner), id);
    expect(failed.errorCode).toBe("confluenceRedirect");
  });

  it("lists content the token cannot read as skipped", async () => {
    const organization = await fixtures.organization();
    serve(apiModel(), {
      restricted: new Set(["7101/footer-comments", "7101/inline-comments", "7101/attachments"]),
    });
    const view = await imported(organization.id, organization.owner, "SKIPPED");
    expect(view.state).toBe("review");
    const report = await test.services.imports.entries(as(organization.owner), view.id, {
      code: "contentSkipped",
      limit: 10,
    });
    expect(report.entries.map((entry) => entry.details)).toEqual(
      expect.arrayContaining([
        { title: "Guide", part: "comments" },
        { title: "Guide", part: "attachments" },
      ]),
    );
  });

  it("keeps the token out of logs, errors and the report and deletes it with the import", async () => {
    const organization = await fixtures.organization();
    const lines: string[] = [];
    const logger = createLogger({
      service: "test",
      level: "debug",
      destination: { write: (line: string) => lines.push(line) },
    } as never);
    const logged = importHarness(() => test, { transport, fetch: atlassianDirectory(), logger });
    let failing = true;
    serve(apiModel(), {
      before: (url) => {
        if (failing && url.pathname.endsWith("/attachments")) {
          failing = false;
          throw new Error(`connection reset while reading ${url.pathname}`);
        }
        return null;
      },
    });
    const id = await connected(organization.id, organization.owner);
    await test.services.imports.update(as(organization.owner), id, { options: { spaceKey: "APIX" } });
    await logged.drive(id, logged.worker());
    const imports = test.services.imports;
    await imports.update(as(organization.owner), id, { spaceName: "Logged", spaceKey: "LOGGED" });
    await imports.start(as(organization.owner), id);
    await logged.drive(id, logged.worker());
    const leaks = await test.database.execute<{ hit: string }>(sql`
      select 'audit' as hit from audit_events where fields::text like ${`%${TOKEN}%`}
      union all select 'imports' from imports where row_to_json(imports)::text like ${`%${TOKEN}%`}
      union all select 'records' from import_records where data::text like ${`%${TOKEN}%`}
      union all select 'problems' from import_problems where details::text like ${`%${TOKEN}%`}`);
    expect(leaks.rows).toEqual([]);
    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(lines.join("\n")).not.toContain(Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64"));
    const view = await imports.get(as(organization.owner), id);
    expect(JSON.stringify(view)).not.toContain(TOKEN);
    await imports.accept(as(organization.owner), id, { visibility: "private", grants: [] });
    const left = await test.database.execute(
      sql`select 1 from import_connections where organization_id = ${organization.id}`,
    );
    expect(left.rows).toHaveLength(0);
    const deleted = await test.database.execute<{ reason: string }>(sql`
      select fields ->> 'reason' as reason from audit_events where name = 'import.tokenDeleted' and target_id = ${id}`);
    expect(deleted.rows.map((row) => row.reason)).toEqual(["accepted"]);
  });

  it("reads Confluence Data Center with a personal access token", async () => {
    const organization = await fixtures.organization();
    await test.settings.set(atlassianHostsSetting, {}, "instance", "wiki.example.com");
    try {
      const fake = serve(apiModel(), {
        kind: "dataCenter",
        site: "wiki.example.com",
        basePath: "/confluence",
        authorization: `Bearer ${TOKEN}`,
      });
      const imports = test.services.imports;
      const draft = await imports.create(as(organization.owner), organization.id, {
        source: "confluence-dc",
      });
      const view = await imports.setConnection(as(organization.owner), draft.id, {
        kind: "dataCenter",
        baseUrl: "https://wiki.example.com/confluence/",
        token: TOKEN,
      });
      expect(view.connection).toMatchObject({
        kind: "dataCenter",
        site: "wiki.example.com",
        basePath: "/confluence",
      });
      expect(view.peopleSource?.kind).toBe("source");
      await imports.update(as(organization.owner), draft.id, { options: { spaceKey: "APIX" } });
      await harness.drive(draft.id);
      const ready = await imports.get(as(organization.owner), draft.id);
      expect(ready.found).toMatchObject({ pages: 4, comments: 3, attachments: 2 });
      expect(fake.requests.every((url) => url.startsWith("https://wiki.example.com/confluence/"))).toBe(true);
    } finally {
      await test.settings.set(atlassianHostsSetting, {}, "instance", "");
    }
  });

  it("refuses a Data Center host the instance administrator did not allow", async () => {
    const organization = await fixtures.organization();
    const fake = serve();
    const draft = await test.services.imports.create(as(organization.owner), organization.id, {
      source: "confluence-dc",
    });
    await expect(
      test.services.imports.setConnection(as(organization.owner), draft.id, {
        kind: "dataCenter",
        baseUrl: "https://intranet.example.com",
        token: TOKEN,
      }),
    ).rejects.toMatchObject({ code: "invalidDataCenterAddress" });
    expect(fake.requests).toEqual([]);
  });

  it("re-imports a space imported from its XML export through the API and lists only the changes", async () => {
    const organization = await fixtures.organization();
    const model = apiModel();
    serve(model);
    const first = await harness.accepted(model, {
      organizationId: organization.id,
      admin: organization.owner,
      key: "REAPI",
      people: { kind: "token", site: SITE, email: EMAIL, token: TOKEN },
    });
    const spaceId = first.quarantineSpace?.id ?? first.reimportSpaceId ?? "";
    const changed: SyntheticExport = {
      ...model,
      pages: [
        ...model.pages.map((page) =>
          page.id === "7102" ? { ...page, body: "<p>Notes, updated</p>", version: 2 } : page,
        ),
        {
          id: "7104",
          title: "New page",
          parentId: "7102",
          position: 0,
          body: "<p>New</p>",
          creatorKey: BOB.key,
        },
      ],
    };
    serve(changed);
    const imports = test.services.imports;
    const draft = await imports.create(as(organization.owner), organization.id, {
      source: "confluence-cloud",
      spaceId,
    });
    await imports.setConnection(as(organization.owner), draft.id, {
      kind: "cloud",
      site: SITE,
      email: EMAIL,
      token: TOKEN,
    });
    await imports.update(as(organization.owner), draft.id, { options: { spaceKey: "APIX" } });
    await harness.drive(draft.id);
    await imports.start(as(organization.owner), draft.id);
    await harness.drive(draft.id);
    const view = await imports.get(as(organization.owner), draft.id);
    expect(view.state).toBe("review");
    expect(view.targetSpace?.id).toBe(spaceId);
    expect(view.counts).toMatchObject({ new: 1, updated: 1, conflicts: 0, deleted: 0 });
  });

  describe("content Confluence does not return", () => {
    type Kind = "cloud" | "dataCenter";
    const DC_SITE = "wiki.example.com";

    function guarded(): SyntheticExport {
      const model = apiModel();
      return {
        ...model,
        pages: [
          ...model.pages,
          {
            id: "7105",
            title: "Guide details",
            parentId: "7101",
            position: 1,
            body: "<p>Details</p>",
            creatorKey: ALICE.key,
          },
        ],
      };
    }

    async function importedFrom(
      kind: Kind,
      key: string,
      before: (url: URL) => TransportResponse | null,
      restricted: ReadonlySet<string> = new Set(),
    ) {
      const organization = await fixtures.organization();
      const imports = test.services.imports;
      const owner = as(organization.owner);
      if (kind === "dataCenter") {
        await test.settings.set(atlassianHostsSetting, {}, "instance", DC_SITE);
        serve(guarded(), {
          kind: "dataCenter",
          site: DC_SITE,
          basePath: "/confluence",
          authorization: `Bearer ${TOKEN}`,
          before,
          restricted,
        });
      } else serve(guarded(), { before, restricted });
      try {
        const draft = await imports.create(owner, organization.id, {
          source: kind === "cloud" ? "confluence-cloud" : "confluence-dc",
        });
        await imports.setConnection(
          owner,
          draft.id,
          kind === "cloud"
            ? { kind: "cloud", site: SITE, email: EMAIL, token: TOKEN }
            : { kind: "dataCenter", baseUrl: `https://${DC_SITE}/confluence/`, token: TOKEN },
        );
        await imports.update(owner, draft.id, { options: { spaceKey: "APIX" } });
        await harness.drive(draft.id);
        await imports.update(owner, draft.id, { spaceName: `Imported ${key}`, spaceKey: key });
        await imports.start(owner, draft.id);
        await harness.drive(draft.id);
        return { view: await imports.get(owner, draft.id), owner };
      } finally {
        if (kind === "dataCenter") await test.settings.set(atlassianHostsSetting, {}, "instance", "");
      }
    }

    async function restricted(importId: string): Promise<Map<string, boolean>> {
      const result = await test.database.execute<{ title: string; restricted: boolean }>(sql`
        select t.title, exists (select 1 from page_restrictions r where r.item_id = any(t.path) and r.kind = 'view')
          as restricted
        from imports i join tree_items t on t.space_id = i.quarantine_space_id
        where i.id = ${importId} and t.trash_entry_id is null`);
      return new Map(result.rows.map((row) => [row.title, row.restricted]));
    }

    async function reported(owner: ReturnType<typeof as>, importId: string, code: string) {
      const report = await test.services.imports.entries(owner, importId, { code, limit: 20 });
      return report.entries.map((entry) => entry.details);
    }

    const restrictionPath = (kind: Kind, pageId: string) =>
      kind === "cloud"
        ? `/wiki/rest/api/content/${pageId}/restriction`
        : `/confluence/rest/api/content/${pageId}/restriction/byOperation`;

    it.each([
      ["cloud", 403],
      ["cloud", 404],
      ["dataCenter", 403],
      ["dataCenter", 404],
      ["cloud", 405],
      ["dataCenter", 405],
    ] as const)(
      "keeps a %s page and its children restricted when its restrictions answer %i",
      async (kind, status) => {
        const { view, owner } = await importedFrom(
          kind,
          `UNR${kind === "cloud" ? "C" : "D"}${status}`,
          (url) => (url.pathname === restrictionPath(kind, "7101") ? response(status) : null),
        );
        expect(view.state).toBe("review");
        const found = await restricted(view.id);
        expect(found.get("Guide")).toBe(true);
        expect(found.get("Guide details")).toBe(true);
        expect(found.get("Notes")).toBe(false);
        expect(await reported(owner, view.id, "restrictionsUnreadable")).toEqual([
          { title: "Guide", reason: "restrictions" },
        ]);
        const holders = await test.database.execute(sql`
        select 1 from page_restriction_holders h join tree_items t on t.id = h.item_id
        join imports i on i.quarantine_space_id = t.space_id where i.id = ${view.id} and t.title = 'Guide'`);
        expect(holders.rows).toEqual([]);
      },
    );

    it.each([403, 404])(
      "leaves out a Cloud page whose details answer %i and keeps its children restricted",
      async (status) => {
        const { view, owner } = await importedFrom("cloud", `UNRPAGE${status}`, (url) =>
          url.pathname === "/wiki/api/v2/pages/7101" ? response(status) : null,
        );
        expect(view.state).toBe("review");
        const found = await restricted(view.id);
        expect(found.has("Guide")).toBe(false);
        expect(found.get("Guide details")).toBe(true);
        expect(found.get("Secret")).toBe(true);
        expect(found.get("Notes")).toBe(false);
        expect(await reported(owner, view.id, "pageUnreadable")).toEqual([{ title: "Guide" }]);
        expect(await reported(owner, view.id, "restrictionsUnreadable")).toEqual(
          expect.arrayContaining([
            { title: "Guide details", reason: "parent" },
            { title: "Secret", reason: "parent" },
          ]),
        );
      },
    );

    it.each(["cloud", "dataCenter"] as const)(
      "stops a %s listing whose next link repeats and reports it",
      async (kind) => {
        const listing =
          kind === "cloud" ? "/api/v2/pages/7101/attachments" : "/rest/api/content/7101/child/attachment";
        const prefix = kind === "cloud" ? "/wiki" : "/confluence";
        let requests = 0;
        const { view, owner } = await importedFrom(kind, `LOOP${kind === "cloud" ? "C" : "D"}`, (url) => {
          if (url.pathname !== `${prefix}${listing}`) return null;
          requests += 1;
          return json(200, {
            results: [],
            _links: { next: `${kind === "cloud" ? "/wiki" : ""}${listing}?cursor=again` },
          });
        });
        expect(view.state).toBe("review");
        expect(requests).toBeLessThanOrEqual(4);
        expect(await reported(owner, view.id, "listingIncomplete")).toEqual([
          { listing, reason: "repeated", limit: MAX_LISTING_PAGES },
        ]);
      },
    );
  });
});
