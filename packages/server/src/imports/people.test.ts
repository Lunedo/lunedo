import { randomUUID } from "node:crypto";
import type { NodeJson } from "@pagehall/editor-schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { atlassianHostsSetting } from "./atlassian.js";
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  OLD_DATE,
  PEOPLE_COMMENT,
  PEOPLE_PAGE,
  peopleExport,
} from "./testing/fixture.js";
import { importHarness } from "./testing/harness.js";

const baseUrl = testDatabaseBaseUrl();
const TOKEN = "atlassian-token-value-7f3c9e";

function nodes(node: NodeJson): NodeJson[] {
  return [node, ...(node.content ?? []).flatMap(nodes)];
}

function iso(confluence: string): string {
  return new Date(`${confluence.replace(" ", "T")}Z`).toISOString();
}

interface Directory {
  readonly [accountId: string]: { name: string; email?: string };
}

function fakeAtlassian(directory: Directory, calls: string[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.href);
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    const expected = `Basic ${Buffer.from(`importer@example.org:${TOKEN}`).toString("base64")}`;
    if (authorization !== expected) return new Response("{}", { status: 401 });
    if (url.pathname === "/wiki/rest/api/user/current") {
      return Response.json({ accountId: "557058:importer", type: "known" });
    }
    if (url.pathname === "/wiki/rest/api/user/bulk") {
      const ids = url.searchParams.getAll("accountId");
      return Response.json({
        results: ids.flatMap((id) => {
          const entry = directory[id];
          return entry
            ? [{ accountId: id, displayName: entry.name, ...(entry.email ? { email: entry.email } : {}) }]
            : [];
        }),
      });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

describe.skipIf(!baseUrl)("Confluence imports: people, comments, history and permissions", () => {
  let test: TestServices;
  const calls: string[] = [];
  let directory: Directory = {};
  const fixtures = spaceFixtures(() => test);
  const harness = importHarness(() => test, {
    fetch: (input, init) => fakeAtlassian(directory, calls)(input, init),
  });
  const as = (id: string) => accountPrincipal(id);

  beforeAll(async () => {
    test = await createTestServices(baseUrl as string, {
      atlassianFetch: (input, init) => fakeAtlassian(directory, calls)(input, init),
    });
  });

  afterAll(async () => {
    await test?.close();
  });

  async function emailOf(accountId: string): Promise<string> {
    const result = await test.database.execute<{ email: string }>(
      sql`select email from accounts where id = ${accountId}`,
    );
    return result.rows[0]?.email ?? "";
  }

  async function world() {
    const organization = await fixtures.organization();
    const alice = await fixtures.member(organization.id, "member", "Alice Archer");
    const bobLookalike = await fixtures.member(organization.id, "member", "Bob Barker");
    const mapper = await fixtures.member(organization.id, "member", "Mia Mapper");
    const reviewer = await fixtures.member(organization.id);
    const outsider = await fixtures.member(organization.id);
    const editors = await test.services.groups.create(SYSTEM, organization.id, { name: "editors" });
    await test.services.groups.addMember(SYSTEM, editors.id, outsider);
    const userList = [
      "User id,User name,email,User status",
      `${ALICE.accountId},Alice A.,${await emailOf(alice)},Active`,
      `${BOB.accountId},Bob Barker,bob.barker@elsewhere.example,Active`,
      `${CAROL.accountId},Carol Clark,,Active`,
    ].join("\n");
    return {
      organizationId: organization.id,
      admin: organization.owner,
      alice,
      bobLookalike,
      mapper,
      reviewer,
      outsider,
      editors: editors.id,
      userList,
    };
  }

  async function run(
    w: Awaited<ReturnType<typeof world>>,
    options: { history?: boolean; format?: "xml" | "csv"; legacyRestrictions?: boolean } = {},
  ) {
    const result = await harness.imported(peopleExport(), {
      organizationId: w.organizationId,
      admin: w.admin,
      key: `P${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      reviewers: [w.reviewer],
      people: { kind: "list", userList: w.userList },
      ...(options.history !== undefined ? { history: options.history } : {}),
      ...(options.format ? { format: options.format } : {}),
      ...(options.legacyRestrictions ? { legacyRestrictions: true } : {}),
    });
    expect(result.state).toBe("review");
    return result;
  }

  async function person(importId: string, sourceId: string): Promise<string> {
    return harness.target(importId, "person", sourceId);
  }

  async function page(importId: string, sourceId: string): Promise<string> {
    return harness.target(importId, "page", sourceId);
  }

  it.each(["xml", "csv"] as const)(
    "reads comments, likes, watchers, blog posts and versions from the %s export",
    async (format) => {
      const w = await world();
      const id = await harness.prepared(peopleExport(), {
        organizationId: w.organizationId,
        admin: w.admin,
        key: `R${format.toUpperCase()}${randomUUID().slice(0, 3).toUpperCase()}`
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 10),
        format,
      });
      const ready = await test.services.imports.get(as(w.admin), id);
      expect(ready.found).toMatchObject({
        pages: 6,
        blogPosts: 1,
        comments: 8,
        likes: 4,
        watchers: 3,
        versions: 2,
      });
    },
  );

  it("matches people only by e-mail and never by name", async () => {
    const w = await world();
    const result = await run(w);
    const alice = await person(result.id, ALICE.accountId);
    const bob = await person(result.id, BOB.accountId);
    const carol = await person(result.id, CAROL.accountId);
    const dave = await person(result.id, DAVE.accountId);
    expect(alice).toBe(w.alice);
    expect(bob).not.toBe(w.bobLookalike);
    const accounts = await test.database.execute<{
      id: string;
      state: string;
      name: string;
      email: string | null;
    }>(sql`
      select id, state::text as state, name, email from accounts where id = any(${sql.param([bob, carol, dave])}::uuid[])`);
    const byId = new Map(accounts.rows.map((row) => [row.id, row]));
    expect(byId.get(bob)).toMatchObject({
      state: "placeholder",
      name: "Bob Barker",
      email: "bob.barker@elsewhere.example",
    });
    expect(byId.get(carol)).toMatchObject({ state: "placeholder", name: "Carol Clark", email: null });
    expect(byId.get(dave)).toMatchObject({ state: "placeholder", name: DAVE.accountId });
    const people = await test.services.imports.resolution.people(as(w.admin), result.id, {
      offset: 0,
      limit: 50,
    });
    const bobRow = people.people.find((row) => row.id === bob);
    expect(bobRow?.mappedTo).toBeNull();
    expect(bobRow?.candidates.map((candidate) => candidate.id)).toContain(w.bobLookalike);
    expect(result.counts).toMatchObject({ people: 4, peopleMatched: 1 });
  });

  it("imports page comments with replies, authors and original times", async () => {
    const w = await world();
    const result = await run(w);
    const plan = await page(result.id, PEOPLE_PAGE.plan);
    const root = await harness.target(result.id, "comment", PEOPLE_COMMENT.root);
    const reply = await harness.target(result.id, "comment", PEOPLE_COMMENT.reply);
    const nested = await harness.target(result.id, "comment", PEOPLE_COMMENT.replyToReply);
    const rows = await test.database.execute<{
      id: string;
      parent_id: string | null;
      author_id: string;
      created_at: Date;
      body: NodeJson;
    }>(sql`select id, parent_id, author_id, created_at, body from comments where item_id = ${plan}`);
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    expect(byId.get(root)).toMatchObject({
      parent_id: null,
      author_id: await person(result.id, BOB.accountId),
    });
    expect(byId.get(reply)?.parent_id).toBe(root);
    expect(byId.get(nested)?.parent_id).toBe(root);
    expect(new Date(byId.get(reply)?.created_at ?? 0).toISOString()).toBe(iso(OLD_DATE));
    const types = nodes(byId.get(nested)?.body as NodeJson).map((node) => node.type);
    expect(types).not.toContain("table");
    expect(types).not.toContain("heading");
    const mention = nodes(byId.get(reply)?.body as NodeJson).find((node) => node.type === "mention");
    expect(mention?.attrs?.id).toBe(await person(result.id, BOB.accountId));
  });

  it("anchors inline comments to their text, keeps resolved ones resolved and moves lost ones to the page", async () => {
    const w = await world();
    const result = await run(w);
    const plan = await page(result.id, PEOPLE_PAGE.plan);
    const found = await harness.target(result.id, "comment", PEOPLE_COMMENT.inlineFound);
    const resolved = await harness.target(result.id, "comment", PEOPLE_COMMENT.inlineResolved);
    const missing = await harness.target(result.id, "comment", PEOPLE_COMMENT.inlineMissing);
    const dangling = await harness.target(result.id, "comment", PEOPLE_COMMENT.inlineDangling);
    const snapshot = await test.database.execute<{ snapshot: NodeJson }>(
      sql`select snapshot from page_documents where item_id = ${plan}`,
    );
    const marked = nodes(snapshot.rows[0]?.snapshot as NodeJson).filter((node) =>
      node.marks?.some((mark) => mark.type === "inlineComment"),
    );
    expect(
      marked.map((node) => [
        node.text,
        node.marks?.find((mark) => mark.type === "inlineComment")?.attrs?.threadId,
      ]),
    ).toEqual([
      ["rollout window", found],
      ["backup check", resolved],
    ]);
    const rows = await test.database.execute<{
      id: string;
      quote: string | null;
      resolved_at: Date | null;
      resolved_by: string | null;
      body: NodeJson;
    }>(sql`select id, quote, resolved_at, resolved_by, body from comments where item_id = ${plan}`);
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    expect(byId.get(found)).toMatchObject({ quote: "rollout window", resolved_at: null });
    expect(byId.get(resolved)?.quote).toBe("backup check");
    expect(byId.get(resolved)?.resolved_at).not.toBeNull();
    expect(byId.get(resolved)?.resolved_by).toBe(w.alice);
    for (const [moved, quote] of [
      [missing, "removed sentence"],
      [dangling, "older wording"],
    ] as const) {
      expect(byId.get(moved)?.quote).toBeNull();
      expect(nodes(byId.get(moved)?.body as NodeJson).some((node) => node.text?.includes(quote))).toBe(true);
    }
    const entries = await test.services.imports.entries(as(w.admin), result.id, {
      code: "inlineCommentMoved",
      limit: 10,
    });
    expect(entries.entries).toHaveLength(2);
    expect(result.counts).toMatchObject({ inlineAnchored: 2, inlineMoved: 2 });
  });

  it("turns likes into thumbs-up reactions by the same person and counts watchers", async () => {
    const w = await world();
    const result = await run(w);
    const plan = await page(result.id, PEOPLE_PAGE.plan);
    const blog = await page(result.id, PEOPLE_PAGE.blog);
    const root = await harness.target(result.id, "comment", PEOPLE_COMMENT.root);
    const reactions = await test.database.execute<{
      item_id: string;
      comment_id: string | null;
      account_id: string;
      emoji: string;
    }>(
      sql`select item_id, comment_id, account_id, emoji from reactions where item_id = any(${sql.param([plan, blog])}::uuid[])`,
    );
    const bob = await person(result.id, BOB.accountId);
    const carol = await person(result.id, CAROL.accountId);
    expect(reactions.rows).toEqual(
      expect.arrayContaining([
        { item_id: plan, comment_id: null, account_id: bob, emoji: "👍" },
        { item_id: plan, comment_id: root, account_id: carol, emoji: "👍" },
        { item_id: blog, comment_id: null, account_id: w.alice, emoji: "👍" },
        { item_id: blog, comment_id: null, account_id: bob, emoji: "👍" },
      ]),
    );
    expect(reactions.rows).toHaveLength(4);
    expect(result.counts).toMatchObject({ likes: 4, watchers: 3 });
  });

  it("imports blog posts with labels, attachments, author and original date", async () => {
    const w = await world();
    const result = await run(w);
    const blog = await page(result.id, PEOPLE_PAGE.blog);
    const row = await test.database.execute<{
      kind: string;
      title: string;
      creator_id: string;
      published_at: Date;
      published_version_id: string | null;
    }>(sql`
      select t.kind::text as kind, t.title, t.creator_id, b.published_at, t.published_version_id
      from tree_items t join blog_posts b on b.item_id = t.id where t.id = ${blog}`);
    expect(row.rows[0]).toMatchObject({
      kind: "blogPost",
      title: "Quarterly update",
      creator_id: await person(result.id, CAROL.accountId),
    });
    expect(new Date(row.rows[0]?.published_at ?? 0).toISOString()).toBe(iso(OLD_DATE));
    expect(row.rows[0]?.published_version_id).not.toBeNull();
    expect(await test.services.documents.labels(blog)).toEqual(["news"]);
    const attachments = await test.database.execute<{ name: string }>(
      sql`select name from attachments where item_id = ${blog}`,
    );
    expect(attachments.rows.map((attachment) => attachment.name)).toEqual(["chart.png"]);
    const comments = await test.database.execute<{ count: number }>(
      sql`select count(*)::int as count from comments where item_id = ${blog}`,
    );
    expect(comments.rows[0]?.count).toBe(1);
    expect(result.counts).toMatchObject({ blogPosts: 1 });
  });

  it("imports every version with its author and date in order when the full history is chosen", async () => {
    const w = await world();
    const full = await run(w, { history: true });
    const item = await page(full.id, PEOPLE_PAGE.history);
    const versions = await test.database.execute<{
      number: number;
      title: string;
      created_by: string;
      created_at: Date;
      document: NodeJson;
    }>(
      sql`select number, title, created_by, created_at, document from page_versions where item_id = ${item} order by number`,
    );
    expect(versions.rows.map((version) => version.number)).toEqual([1, 2, 3]);
    expect(versions.rows.map((version) => version.created_by)).toEqual([
      w.alice,
      await person(full.id, CAROL.accountId),
      await person(full.id, BOB.accountId),
    ]);
    expect(versions.rows.map((version) => new Date(version.created_at).toISOString())).toEqual([
      "2023-01-01T01:01:01.000Z",
      "2023-02-02T02:02:02.000Z",
      "2023-03-03T03:03:03.000Z",
    ]);
    expect(versions.rows[0]?.title).toBe("Notes");
    expect(nodes(versions.rows[1]?.document as NodeJson).some((node) => node.text === "Version two")).toBe(
      true,
    );
    const published = await test.database.execute<{ number: number }>(sql`
      select v.number from tree_items t join page_versions v on v.id = t.published_version_id where t.id = ${item}`);
    expect(published.rows[0]?.number).toBe(3);

    const current = await run(await world(), { history: false });
    const only = await page(current.id, PEOPLE_PAGE.history);
    const single = await test.database.execute<{ count: number }>(
      sql`select count(*)::int as count from page_versions where item_id = ${only}`,
    );
    expect(single.rows[0]?.count).toBe(1);
  });

  it("maps every space permission combination to the highest fitting role and lists the rest", async () => {
    const w = await world();
    const result = await run(w);
    const { entries } = await test.services.imports.resolution.permissions(as(w.admin), result.id, {
      limit: 100,
    });
    const space = entries.filter((entry) => entry.scope === "space");
    const find = (predicate: (entry: (typeof space)[number]) => boolean) => space.find(predicate);
    expect(find((entry) => entry.holder.sourceName === "confluence-users")).toMatchObject({
      role: "commenter",
      status: "missing",
    });
    expect(find((entry) => entry.holder.sourceName === "Editors")).toMatchObject({
      role: "editor",
      status: "mapped",
      holder: { id: w.editors },
    });
    expect(find((entry) => entry.holder.id === w.alice)).toMatchObject({ role: "admin", status: "mapped" });
    const bob = await person(result.id, BOB.accountId);
    expect(find((entry) => entry.holder.id === bob)).toMatchObject({ role: "editor", status: "waiting" });
    expect(find((entry) => entry.holder.sourceName === "contractors")).toMatchObject({
      role: "reader",
      status: "missing",
    });
    expect(find((entry) => entry.holder.sourceName === "auditors")).toMatchObject({
      role: null,
      status: "notTaken",
      code: "withoutView",
    });
    expect(find((entry) => entry.holder.kind === "organizationMembers")).toMatchObject({
      role: "reader",
      status: "mapped",
    });
    expect(find((entry) => entry.holder.kind === "anonymous")).toMatchObject({
      status: "notTaken",
      code: "anonymous",
    });
    const raw = await test.database.execute<{ source_key: string; status: string; code: string | null }>(
      sql`select source_key, status, code from import_grants where import_id = ${result.id} and item_id is null`,
    );
    const codes = new Map(raw.rows.map((row) => [row.source_key, [row.status, row.code]]));
    expect(codes.get(`space:user:${BOB.accountId}`)).toEqual(["check", "widened"]);
    expect(codes.get("space:group:contractors")).toEqual(["check", "narrowed"]);
  });

  it("keeps restricted pages closed until people and groups are resolved, in every view, before and after accepting", async () => {
    const w = await world();
    const result = await run(w);
    const spaceId = result.quarantineSpace?.id ?? "";
    const secret = await page(result.id, PEOPLE_PAGE.secret);
    const editorsPage = await page(result.id, PEOPLE_PAGE.editors);
    const hidden = async (viewer: string) => {
      const principal = as(viewer);
      expect(
        (await test.services.authorization.explain(principal, "item.view", { type: "item", id: secret }))
          .allowed,
      ).toBe(false);
      const children = await test.services.tree.children(principal, spaceId, null);
      expect(children.items.map((item) => item.id)).not.toContain(secret);
      const search = await test.services.tree.search(principal, { query: "Salary", spaceId });
      expect(search.map((item) => item.id)).not.toContain(secret);
      expect(await test.services.tree.findByTitle(principal, spaceId, "Salary bands")).toBeNull();
      const report = await test.services.imports
        .entries(principal, result.id, { limit: 100 })
        .catch(() => null);
      for (const entry of report?.entries ?? [])
        if (entry.item?.id === secret) expect(entry.item.title).toBeNull();
      const permissions = await test.services.imports.resolution
        .permissions(principal, result.id, { limit: 100 })
        .catch(() => null);
      for (const entry of permissions?.entries ?? [])
        if (entry.item?.id === secret) expect(entry.item.title).toBeNull();
    };
    for (const viewer of [w.admin, w.reviewer]) await hidden(viewer);
    const shares = await test.database.execute<{
      principal_kind: string;
      principal_id: string;
      role: string;
    }>(sql`
      select principal_kind::text as principal_kind, principal_id, role::text as role from page_shares
      where item_id = any(${sql.param([secret, editorsPage])}::uuid[]) order by item_id`);
    expect(shares.rows).toEqual(
      expect.arrayContaining([
        { principal_kind: "account", principal_id: await person(result.id, CAROL.accountId), role: "reader" },
        { principal_kind: "group", principal_id: w.editors, role: "editor" },
      ]),
    );
    const proposal = await test.services.imports.resolution.proposal(as(w.admin), result.id);
    await test.services.imports.accept(as(w.admin), result.id, {
      visibility: proposal.visibility,
      grants: proposal.grants.map(({ name: _name, ...grant }) => grant),
    });
    for (const viewer of [w.admin, w.reviewer, w.outsider, w.alice]) await hidden(viewer);
    const carol = await person(result.id, CAROL.accountId);
    await test.services.imports.resolution.mapPeople(as(w.admin), result.id, [
      { placeholderId: carol, accountId: w.mapper },
    ]);
    expect(
      (await test.services.authorization.explain(as(w.mapper), "item.view", { type: "item", id: secret }))
        .allowed,
    ).toBe(true);
    await hidden(w.outsider);
  });

  it("restricts pages from the moment they exist in the quarantine space", async () => {
    const w = await world();
    const id = await harness.prepared(peopleExport(), {
      organizationId: w.organizationId,
      admin: w.admin,
      key: `M${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      people: { kind: "list", userList: w.userList },
    });
    await test.services.imports.start(as(w.admin), id);
    const stepper = harness.worker(0);
    let seen = false;
    for (let step = 0; step < 500; step += 1) {
      const state = await test.database.execute<{ state: string }>(
        sql`select state from imports where id = ${id}`,
      );
      if (state.rows[0]?.state !== "running") break;
      await stepper.work(
        (await import("../testing/jobs.js")).testJobContext("imports.work", { importId: id }),
      );
      const secret = await harness.target(id, "page", PEOPLE_PAGE.secret);
      if (!secret) continue;
      seen = true;
      const restricted = await test.database.execute<{ count: number }>(
        sql`select count(*)::int as count from page_restrictions where item_id = ${secret} and kind = 'view'`,
      );
      expect(restricted.rows[0]?.count).toBe(1);
      expect(
        (await test.services.authorization.explain(as(w.admin), "item.view", { type: "item", id: secret }))
          .allowed,
      ).toBe(false);
    }
    expect(seen).toBe(true);
  });

  it("applies the imported permissions on accept and the pending ones when people and groups are mapped later", async () => {
    const w = await world();
    const result = await run(w);
    const spaceId = result.quarantineSpace?.id ?? "";
    const proposal = await test.services.imports.resolution.proposal(as(w.admin), result.id);
    expect(proposal.visibility).toBe("organization");
    expect(
      proposal.grants.map(({ principalKind, principalId, role }) => ({ principalKind, principalId, role })),
    ).toEqual(
      expect.arrayContaining([
        { principalKind: "account", principalId: w.alice, role: "admin" },
        { principalKind: "group", principalId: w.editors, role: "editor" },
        { principalKind: "organizationMembers", principalId: null, role: "reader" },
      ]),
    );
    expect(proposal.grants).toHaveLength(3);
    expect(proposal.pending).toBe(4);
    await test.services.imports.accept(as(w.admin), result.id, {
      visibility: proposal.visibility,
      grants: proposal.grants.map(({ name: _name, ...grant }) => grant),
    });
    const permissions = async () =>
      (
        await test.database.execute<{
          principal_kind: string;
          principal_id: string | null;
          role: string;
        }>(sql`
          select principal_kind::text as principal_kind, principal_id, role::text as role from space_permissions
          where space_id = ${spaceId}`)
      ).rows;
    expect(await permissions()).toEqual(
      expect.arrayContaining([
        { principal_kind: "account", principal_id: w.alice, role: "admin" },
        { principal_kind: "group", principal_id: w.editors, role: "editor" },
        { principal_kind: "organizationMembers", principal_id: null, role: "reader" },
        { principal_kind: "account", principal_id: w.admin, role: "admin" },
      ]),
    );
    const bob = await person(result.id, BOB.accountId);
    await test.services.imports.resolution.mapPeople(as(w.admin), result.id, [
      { placeholderId: bob, accountId: w.bobLookalike },
    ]);
    expect(await permissions()).toContainEqual({
      principal_kind: "account",
      principal_id: w.bobLookalike,
      role: "editor",
    });
    const created = await test.services.imports.resolution.mapGroup(
      as(w.admin),
      result.id,
      "confluence-users",
      {
        create: true,
      },
    );
    expect(created.group?.name).toBe("confluence-users");
    expect(await permissions()).toContainEqual({
      principal_kind: "group",
      principal_id: created.group?.id ?? "",
      role: "commenter",
    });
    const events = await test.database.execute<{ name: string }>(sql`
      select name from audit_events where target_id = any(${sql.param([result.id, created.group?.id ?? ""])}::text[])
        or (name = 'import.placeholderMapped' and target_id = ${w.bobLookalike})`);
    expect(events.rows.map((event) => event.name)).toEqual(
      expect.arrayContaining([
        "import.permissionsApplied",
        "import.groupMapped",
        "group.created",
        "import.placeholderMapped",
      ]),
    );
  });

  it("maps a group in the report to an existing group and opens restricted pages for its members", async () => {
    const w = await world();
    const result = await run(w);
    const secret = await page(result.id, PEOPLE_PAGE.secret);
    const hr = await test.services.groups.create(SYSTEM, w.organizationId, { name: "People team" });
    await test.services.groups.addMember(SYSTEM, hr.id, w.reviewer);
    expect(
      (await test.services.authorization.explain(as(w.reviewer), "item.view", { type: "item", id: secret }))
        .allowed,
    ).toBe(false);
    const mapped = await test.services.imports.resolution.mapGroup(as(w.admin), result.id, "hr-team", {
      groupId: hr.id,
    });
    expect(mapped.group?.id).toBe(hr.id);
    expect(
      (await test.services.authorization.explain(as(w.reviewer), "item.view", { type: "item", id: secret }))
        .allowed,
    ).toBe(true);
    await expect(
      test.services.imports.resolution.mapGroup(as(w.admin), result.id, "hr-team", { groupId: hr.id }),
    ).rejects.toMatchObject({ code: "groupAlreadyMapped" });
  });

  it("moves authorship, comments, mentions, tasks, reactions and restrictions to the account in one step", async () => {
    const w = await world();
    const result = await run(w);
    const bob = await person(result.id, BOB.accountId);
    const tasksPage = await page(result.id, PEOPLE_PAGE.tasks);
    const counts = async (account: string) =>
      (
        await test.database.execute<Record<string, number>>(sql`
          select
            (select count(*) from comments where author_id = ${account})::int as comments,
            (select count(*) from content_mentions where account_id = ${account})::int as mentions,
            (select count(*) from tasks where assignee_id = ${account} and notified_assignee_id = ${account})::int as tasks,
            (select count(*) from reactions where account_id = ${account})::int as reactions,
            (select count(*) from tree_items where creator_id = ${account} or owner_id = ${account})::int as items,
            (select count(*) from page_documents where updated_by = ${account})::int as documents`)
      ).rows[0];
    const before = await counts(bob);
    expect(before).toMatchObject({ comments: 5, tasks: 1, reactions: 2 });
    expect(before?.mentions).toBeGreaterThanOrEqual(2);
    await test.services.imports.resolution.mapPeople(as(w.admin), result.id, [
      { placeholderId: bob, accountId: w.bobLookalike },
    ]);
    expect(await counts(bob)).toEqual({
      comments: 0,
      mentions: 0,
      tasks: 0,
      reactions: 0,
      items: 0,
      documents: 0,
    });
    expect(await counts(w.bobLookalike)).toMatchObject(before ?? {});
    const merged = await test.database.execute<{ merged_into_id: string }>(
      sql`select merged_into_id from accounts where id = ${bob}`,
    );
    expect(merged.rows[0]?.merged_into_id).toBe(w.bobLookalike);
    const snapshot = await test.services.documents.snapshot(tasksPage);
    const references = await test.services.documents.references(as(w.outsider), snapshot?.document as never);
    expect(references.people[bob]).toBe("Bob Barker");
    const people = await test.services.imports.resolution.people(as(w.admin), result.id, {
      offset: 0,
      limit: 50,
    });
    expect(people.people.find((row) => row.id === bob)?.mappedTo).toEqual({
      id: w.bobLookalike,
      name: "Bob Barker",
    });
  });

  it("leaves nothing half-moved when mapping fails in the middle", async () => {
    const w = await world();
    const result = await run(w);
    const bob = await person(result.id, BOB.accountId);
    const audit = test.services.audit;
    const original = audit.record.bind(audit);
    audit.record = (async (tx: never, input: { name: string }) => {
      if (input.name === "import.placeholderMapped") throw new Error("audit unavailable");
      return original(tx, input as never);
    }) as typeof audit.record;
    try {
      await expect(
        test.services.imports.resolution.mapPeople(as(w.admin), result.id, [
          { placeholderId: bob, accountId: w.bobLookalike },
        ]),
      ).rejects.toThrow("audit unavailable");
    } finally {
      audit.record = original;
    }
    const left = await test.database.execute<Record<string, number>>(sql`
      select
        (select count(*) from comments where author_id = ${w.bobLookalike})::int as comments,
        (select count(*) from reactions where account_id = ${w.bobLookalike})::int as reactions,
        (select count(*) from tasks where assignee_id = ${w.bobLookalike})::int as tasks,
        (select count(*) from accounts where id = ${bob} and merged_into_id is null)::int as unmerged`);
    expect(left.rows[0]).toEqual({ comments: 0, reactions: 0, tasks: 0, unmerged: 1 });
  });

  it("refuses to map a placeholder that holds page access to the administrator's own account", async () => {
    const w = await world();
    const result = await run(w);
    const carol = await person(result.id, CAROL.accountId);
    await expect(
      test.services.imports.resolution.mapPeople(as(w.admin), result.id, [
        { placeholderId: carol, accountId: w.admin },
      ]),
    ).rejects.toMatchObject({ code: "selfExtension" });
  });

  it("resolves remaining placeholders with a user list uploaded after accepting", async () => {
    const w = await world();
    const result = await run(w);
    const proposal = await test.services.imports.resolution.proposal(as(w.admin), result.id);
    await test.services.imports.accept(as(w.admin), result.id, {
      visibility: proposal.visibility,
      grants: proposal.grants.map(({ name: _name, ...grant }) => grant),
    });
    const dave = await person(result.id, DAVE.accountId);
    const list = ["User id,User name,email", `${DAVE.accountId},Dave Dent,${await emailOf(w.mapper)}`].join(
      "\n",
    );
    const outcome = await test.services.imports.resolution.uploadUserList(as(w.admin), result.id, list);
    expect(outcome.matched).toBe(1);
    const merged = await test.database.execute<{ merged_into_id: string }>(
      sql`select merged_into_id from accounts where id = ${dave}`,
    );
    expect(merged.rows[0]?.merged_into_id).toBe(w.mapper);
    const event = await test.database.execute<{ fields: Record<string, unknown> }>(sql`
      select fields from audit_events where name = 'import.placeholderMapped' and target_id = ${w.mapper}`);
    expect(event.rows[0]?.fields).toMatchObject({ via: "userList", placeholderId: dave });
  });

  describe("sends no notifications", () => {
    async function notifications(accounts: readonly string[]): Promise<{ type: string }[]> {
      const result = await test.database.execute<{ type: string }>(sql`
        select type from notifications where recipient_id = any(${sql.param([...accounts])}::uuid[])
          and type not like 'import.%'`);
      return result.rows;
    }

    async function everyStep() {
      const w = await world();
      const result = await run(w);
      const imported = await notifications([w.alice, w.admin, w.reviewer]);
      const proposal = await test.services.imports.resolution.proposal(as(w.admin), result.id);
      await test.services.imports.accept(as(w.admin), result.id, {
        visibility: proposal.visibility,
        grants: proposal.grants.map(({ name: _name, ...grant }) => grant),
      });
      const accepted = await notifications([w.alice, w.admin, w.reviewer]);
      const bob = await person(result.id, BOB.accountId);
      const carol = await person(result.id, CAROL.accountId);
      await test.services.imports.resolution.mapPeople(as(w.admin), result.id, [
        { placeholderId: bob, accountId: w.bobLookalike },
        { placeholderId: carol, accountId: w.mapper },
      ]);
      const items = await test.database.execute<{ item_id: string; snapshot: never }>(sql`
        select d.item_id, d.snapshot from import_items i join page_documents d on d.item_id = i.target_id
        where i.import_id = ${result.id} and i.kind = 'page'`);
      const comments = await test.database.execute<{ id: string; item_id: string; body: never }>(sql`
        select c.id, c.item_id, c.body from import_items i join comments c on c.id = i.target_id
        where i.import_id = ${result.id} and i.kind = 'comment'`);
      await test.database.transaction(async (tx) => {
        for (const item of items.rows) {
          await test.services.activity.readerContentChanged(tx, item.item_id, item.snapshot, w.admin);
        }
        for (const comment of comments.rows) {
          await test.services.activity.commentMentions(
            tx,
            comment.item_id,
            comment.id,
            comment.body,
            w.admin,
          );
        }
      });
      const mapped = await notifications([w.bobLookalike, w.mapper, w.alice]);
      return { imported, accepted, mapped };
    }

    it.each([
      ["mentions", "content.mentioned"],
      ["task assignments", "task.assigned"],
      ["comments", "comment."],
      ["reactions", "reaction."],
      ["blog posts", "blogPost."],
    ])("for %s", async (_kind, type) => {
      const steps = await everyStep();
      for (const step of [steps.imported, steps.accepted, steps.mapped]) {
        expect(step.filter((notification) => notification.type.startsWith(type))).toEqual([]);
      }
    });
  });

  describe("the API token", () => {
    async function withToken(site = "example.atlassian.net") {
      const w = await world();
      directory = {
        [ALICE.accountId]: { name: "Alice Archer", email: await emailOf(w.alice) },
        [BOB.accountId]: { name: "Bob Barker" },
      };
      calls.length = 0;
      const id = await harness.prepared(peopleExport(), {
        organizationId: w.organizationId,
        admin: w.admin,
        key: `T${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        people: { kind: "token", site, email: "importer@example.org", token: TOKEN },
      });
      return { w, id };
    }

    async function leaks(importId: string): Promise<string[]> {
      const places: string[] = [];
      const tables = await test.database.execute<{ hit: string }>(sql`
        select 'audit' as hit from audit_events where fields::text like ${`%${TOKEN}%`}
        union all select 'imports' from imports where row_to_json(imports)::text like ${`%${TOKEN}%`}
        union all select 'records' from import_records where data::text like ${`%${TOKEN}%`}
        union all select 'problems' from import_problems where details::text like ${`%${TOKEN}%`}`);
      places.push(...tables.rows.map((row) => row.hit));
      const view = await test.services.imports.get(
        as(
          (
            await test.database.execute<{ importer_id: string }>(
              sql`select importer_id from imports where id = ${importId}`,
            )
          ).rows[0]?.importer_id ?? "",
        ),
        importId,
      );
      if (JSON.stringify(view).includes(TOKEN)) places.push("view");
      return places;
    }

    it("is checked only against the given Atlassian site and stored encrypted", async () => {
      const { w, id } = await withToken();
      expect(calls.every((url) => new URL(url).host === "example.atlassian.net")).toBe(true);
      expect(calls.some((url) => url.includes("/wiki/rest/api/user/current"))).toBe(true);
      const view = await test.services.imports.get(as(w.admin), id);
      expect(view.peopleSource).toMatchObject({
        kind: "token",
        site: "example.atlassian.net",
        people: 2,
        withEmail: 1,
      });
      const stored = await test.database.execute<{ token: Buffer }>(
        sql`select token from import_credentials where import_id = ${id}`,
      );
      expect(stored.rows[0]?.token.toString("utf8")).not.toContain(TOKEN);
      expect(await leaks(id)).toEqual([]);
    });

    it.each([
      ["a plain address", "http://example.atlassian.net"],
      ["another host", "confluence.example.com"],
      ["a look-alike host", "example.atlassian.net.evil.example"],
      ["a host with a port", "example.atlassian.net:8443"],
      ["the bare suffix", "atlassian.net"],
    ])("refuses %s", async (_case, site) => {
      const w = await world();
      const id = await harness.prepared(peopleExport(), {
        organizationId: w.organizationId,
        admin: w.admin,
        key: `S${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      });
      calls.length = 0;
      await expect(
        test.services.imports.setPeopleSource(as(w.admin), id, {
          kind: "token",
          site,
          email: "importer@example.org",
          token: TOKEN,
        }),
      ).rejects.toMatchObject({ code: "invalidAtlassianSite" });
      expect(calls).toEqual([]);
    });

    it("accepts a host the instance administrator allowed", async () => {
      await test.settings.set(atlassianHostsSetting, {}, "instance", "wiki.example.com");
      try {
        const { id } = await withToken("wiki.example.com");
        expect(calls.every((url) => new URL(url).host === "wiki.example.com")).toBe(true);
        expect(id).toBeTruthy();
      } finally {
        await test.settings.set(atlassianHostsSetting, {}, "instance", "");
      }
    });

    it("explains a refused token without repeating it", async () => {
      const w = await world();
      const id = await harness.prepared(peopleExport(), {
        organizationId: w.organizationId,
        admin: w.admin,
        key: `U${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      });
      const failure = await test.services.imports
        .setPeopleSource(as(w.admin), id, {
          kind: "token",
          site: "example.atlassian.net",
          email: "importer@example.org",
          token: "wrong-token",
        })
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: "atlassianUnauthorized" });
      expect(JSON.stringify(failure)).not.toContain("wrong-token");
      expect(String((failure as Error).message)).not.toContain("wrong-token");
    });

    it("resolves people during the run and is deleted when the import is accepted", async () => {
      const { w, id } = await withToken();
      await test.services.imports.start(as(w.admin), id);
      await harness.drive(id);
      expect(await person(id, ALICE.accountId)).toBe(w.alice);
      const bob = await person(id, BOB.accountId);
      const name = await test.database.execute<{ name: string }>(
        sql`select name from accounts where id = ${bob}`,
      );
      expect(name.rows[0]?.name).toBe("Bob Barker");
      expect(calls.some((url) => url.includes("/wiki/rest/api/user/bulk"))).toBe(true);
      const proposal = await test.services.imports.resolution.proposal(as(w.admin), id);
      await test.services.imports.accept(as(w.admin), id, {
        visibility: proposal.visibility,
        grants: proposal.grants.map(({ name: _name, ...grant }) => grant),
      });
      const remaining = await test.database.execute<{ count: number }>(
        sql`select count(*)::int as count from import_credentials where import_id = ${id}`,
      );
      expect(remaining.rows[0]?.count).toBe(0);
      const view = await test.services.imports.get(as(w.admin), id);
      expect(view.tokenDeletedAt).not.toBeNull();
      const events = await test.database.execute<{ name: string; fields: Record<string, unknown> }>(sql`
        select name, fields from audit_events where target_id = ${id} and name like 'import.token%' order by id`);
      expect(events.rows.map((event) => event.name)).toEqual([
        "import.tokenUsed",
        "import.tokenUsed",
        "import.tokenDeleted",
      ]);
      expect(events.rows.at(-1)?.fields).toEqual({ reason: "accepted" });
      expect(await leaks(id)).toEqual([]);
    });

    it.each(["discarded", "stopped", "failed"] as const)("is deleted when the import is %s", async (end) => {
      const { w, id } = await withToken();
      await test.services.imports.start(as(w.admin), id);
      const key = (await test.services.imports.get(as(w.admin), id)).spaceKey ?? "";
      if (end === "stopped") {
        await test.services.imports.stop(as(w.admin), id, key);
      } else if (end === "failed") {
        directory = {};
        const refused = importHarness(() => test, {
          fetch: (async () => new Response("{}", { status: 401 })) as typeof fetch,
        });
        await refused.drive(id);
      } else {
        await harness.drive(id);
        await test.services.imports.discard(as(w.admin), id, key);
      }
      await harness.drive(id);
      const view = await test.services.imports.get(as(w.admin), id);
      expect(view.state).toBe(end);
      const remaining = await test.database.execute<{ count: number }>(
        sql`select count(*)::int as count from import_credentials where import_id = ${id}`,
      );
      expect(remaining.rows[0]?.count).toBe(0);
      expect(view.tokenDeletedAt).not.toBeNull();
      const deleted = await test.database.execute<{ fields: Record<string, unknown> }>(sql`
        select fields from audit_events where target_id = ${id} and name = 'import.tokenDeleted'`);
      expect(deleted.rows[0]?.fields).toEqual({ reason: end });
    });

    it("never reaches the logs, even when the run fails", async () => {
      const lines: string[] = [];
      const { w, id } = await withToken();
      const { createLogger } = await import("../logging/logger.js");
      const logger = createLogger({
        service: "test",
        level: "debug",
        destination: { write: (line: string) => lines.push(line) },
      } as never);
      const failing = importHarness(() => test, {
        logger,
        fetch: (async () => {
          throw new Error(`network down for ${"x".repeat(3)}`);
        }) as typeof fetch,
      });
      await test.services.imports.start(as(w.admin), id);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await failing
          .worker()
          .work({ ...(await import("../testing/jobs.js")).testJobContext("imports.work", { importId: id }) })
          .catch(() => undefined);
      }
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("\n")).not.toContain(TOKEN);
    });
  });
});
