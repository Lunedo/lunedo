import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { runWithRequestContext } from "../observability/request-context.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { countQueries } from "../testing/queries.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import type { Resource } from "./registry.js";

const baseUrl = testDatabaseBaseUrl();

const PRINCIPALS = [
  "admin",
  "reader",
  "commenter",
  "editor",
  "viaGroup",
  "shared",
  "linked",
  "listed",
  "plain",
  "guest",
  "collaborator",
  "deactivated",
  "outsider",
  "owner",
  "system",
  "anonymous",
];

describe.skipIf(!baseUrl)("batch decisions", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);
  let principals: [string, Principal][] = [];
  let resources: Record<string, Resource[]> = {};

  async function page(creator: string, spaceId: string, title: string, parentId: string | null = null) {
    const created = await test.services.tree.create(accountPrincipal(creator), spaceId, {
      kind: "page",
      title,
      mode: "live",
      placement: { parentId },
    });
    return created.id;
  }

  async function comment(
    itemId: string,
    authorId: string,
    state: { deleted?: boolean; quote?: boolean } = {},
  ) {
    const id = randomUUID();
    await test.database.execute(sql`
      insert into comments (id, item_id, author_id, body, deleted_at, quote, quote_public)
      values (${id}, ${itemId}, ${authorId}, ${JSON.stringify({ type: "doc", content: [] })}::jsonb,
        ${state.deleted ? sql`now()` : sql`null`}, ${state.quote ? "quoted" : null},
        ${false})`);
    return id;
  }

  async function task(itemId: string, published: boolean) {
    const id = randomUUID();
    await test.database.execute(
      sql`insert into tasks (id, item_id, published) values (${id}, ${itemId}, ${published})`,
    );
    return id;
  }

  async function attachment(itemId: string, deleted: boolean) {
    const id = randomUUID();
    await test.database.execute(sql`
      insert into attachments (id, item_id, name, name_key, deleted_at)
      values (${id}, ${itemId}, 'plan.pdf', ${`plan-${id}`}, ${deleted ? sql`now()` : sql`null`})`);
    return id;
  }

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    const { organization, member, group, space, deactivate } = fixtures;
    const org = await organization();
    const admin = await member(org.id);
    const reader = await member(org.id);
    const commenter = await member(org.id);
    const editor = await member(org.id);
    const viaGroup = await member(org.id);
    const shared = await member(org.id);
    const linked = await member(org.id);
    const listed = await member(org.id);
    const plain = await member(org.id);
    const guest = await member(org.id, "guest");
    const collaborator = await member(org.id, "collaborator");
    const deactivated = await member(org.id);
    const outsider = await fixtures.account();
    const readers = await group(org.id, [viaGroup]);

    const grants = [
      { principalKind: "account" as const, principalId: reader, role: "reader" as const },
      { principalKind: "account" as const, principalId: commenter, role: "commenter" as const },
      { principalKind: "account" as const, principalId: editor, role: "editor" as const },
      { principalKind: "account" as const, principalId: admin, role: "admin" as const },
      { principalKind: "group" as const, principalId: readers, role: "reader" as const },
      { principalKind: "account" as const, principalId: guest, role: "reader" as const },
      { principalKind: "account" as const, principalId: collaborator, role: "editor" as const },
      { principalKind: "account" as const, principalId: deactivated, role: "editor" as const },
    ];
    const open = await space(org.id, admin, { grants });
    const archived = await space(org.id, admin, { grants });
    const deleted = await space(org.id, admin, { grants });
    const visible = await space(org.id, admin, { visibility: "organization" });
    const confidential = await test.services.spaces.create(
      accountPrincipal(admin),
      org.id,
      {
        name: `Council ${randomUUID().slice(0, 6)}`,
        key: `C${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`,
        visibility: "private",
        confidential: true,
        grants: [{ principalKind: "account", principalId: editor, role: "editor" }],
      },
      test.services.spacePermissions.holders,
    );
    const personal = await test.services.personalSpaces.ensure(accountPrincipal(editor), "Overview");

    const pages: string[] = [];
    const comments: string[] = [];
    const tasks: string[] = [];
    const attachments: string[] = [];
    for (const target of [open, archived, deleted, visible, confidential, personal]) {
      const owner = target.id === personal.id ? editor : admin;
      const root = await page(owner, target.id, "Root");
      const draft = await page(owner, target.id, "Draft");
      await test.database.execute(sql`update tree_items set reader_visible = false where id = ${draft}`);
      const trashed = await page(owner, target.id, "Trashed");
      const archivedPage = await page(owner, target.id, "Archived");
      pages.push(root, draft, trashed, archivedPage);
      if (target.id === open.id) {
        const secret = await page(admin, open.id, "Secret");
        const below = await page(admin, open.id, "Below", secret);
        const locked = await page(admin, open.id, "Locked");
        const shown = await page(admin, open.id, "Shown");
        await test.services.pageAccess.change(accountPrincipal(admin), secret, [
          { action: "share", holderKind: "account", holderId: listed, role: "reader" },
          { action: "restrict", kind: "view" },
        ]);
        await test.services.pageAccess.change(accountPrincipal(admin), locked, [
          { action: "share", holderKind: "account", holderId: listed, role: "editor" },
          { action: "restrict", kind: "edit" },
        ]);
        await test.services.pageAccess.change(accountPrincipal(admin), root, [
          { action: "share", holderKind: "account", holderId: shared, role: "commenter" },
        ]);
        const { token } = await test.services.shareLinks.create(accountPrincipal(admin), shown, {
          scope: "people",
          people: [{ kind: "account", id: linked }],
        });
        await test.services.shareLinks.open(token, accountPrincipal(linked), { clientIp: "192.0.2.10" });
        const sharedLink = await test.services.shareLinks.create(accountPrincipal(admin), below, {
          scope: "organization",
        });
        await test.services.shareLinks.open(sharedLink.token, accountPrincipal(linked), {
          clientIp: "192.0.2.10",
        });
        pages.push(secret, below, locked, shown);
        comments.push(await comment(secret, editor), await comment(below, reader));
      }
      comments.push(
        await comment(root, commenter),
        await comment(root, reader, { quote: true }),
        await comment(root, editor, { deleted: true }),
        await comment(draft, editor),
        await comment(trashed, commenter),
      );
      tasks.push(
        await task(root, true),
        await task(root, false),
        await task(draft, true),
        await task(trashed, true),
      );
      attachments.push(
        await attachment(root, false),
        await attachment(root, true),
        await attachment(trashed, false),
      );
      await test.services.archive.archive(accountPrincipal(owner), archivedPage);
      await test.services.trash.deleteItem(accountPrincipal(owner), trashed);
    }
    await test.database.execute(sql`update spaces set archived_at = now() where id = ${archived.id}`);
    await test.database.execute(sql`update spaces set deleted_at = now() where id = ${deleted.id}`);
    await deactivate(deactivated);

    const spaces = [open, archived, deleted, visible, confidential, personal].map((entry) => entry.id);
    const missing = [randomUUID(), "not-an-id", ""];
    const of = (type: string, ids: string[]) => [...ids, ...missing].map((id): Resource => ({ type, id }));
    resources = {
      space: of("space", spaces),
      item: of("item", pages),
      comment: of("comment", comments),
      task: of("task", tasks),
      attachment: of("attachment", attachments),
    };
    principals = [
      ...Object.entries({
        admin,
        reader,
        commenter,
        editor,
        viaGroup,
        shared,
        linked,
        listed,
        plain,
        guest,
        collaborator,
        deactivated,
        outsider,
        owner: org.owner,
      }).map(([name, id]): [string, Principal] => [name, accountPrincipal(id)]),
      ["system", { type: "system" }],
      ["anonymous", { type: "anonymous" }],
    ];
  });

  afterAll(async () => {
    await test?.close();
  });

  it("has a resource list for every resource type with space actions", () => {
    const actions = test.services.authorization.registry
      .actions()
      .filter((action) => action.scope === "space");
    expect(new Set(actions.map((action) => action.resourceType.type))).toEqual(
      new Set(Object.keys(resources)),
    );
    expect(principals.map(([name]) => name)).toEqual(PRINCIPALS);
  });

  it.each(PRINCIPALS)(
    "decides every space action for %s on many resources exactly as one by one",
    async (name) => {
      const principal = principals.find(([candidate]) => candidate === name)?.[1];
      if (!principal) throw new Error(`missing ${name}`);
      const actions = test.services.authorization.registry
        .actions()
        .filter((action) => action.scope === "space");
      for (const action of actions) {
        const list = resources[action.resourceType.type] ?? [];
        const many = await test.services.authorization.explainMany(principal, action.name, list, {
          fresh: true,
        });
        const single = await Promise.all(
          list.map((resource) =>
            test.services.authorization.explain(principal, action.name, resource, { fresh: true }),
          ),
        );
        expect(many, `${name} ${action.name}`).toEqual(single);
      }
    },
    120_000,
  );

  it("covers allowed and denied cases for viewing items and comments", async () => {
    const outcomes = new Set<string>();
    for (const [, principal] of principals) {
      for (const [action, type] of [
        ["item.view", "item"],
        ["comment.view", "comment"],
      ] as const) {
        const decisions = await test.services.authorization.explainMany(
          principal,
          action,
          resources[type] ?? [],
        );
        for (const decision of decisions) {
          outcomes.add(decision.allowed ? `${action} allowed` : `${action} ${decision.denials.join(",")}`);
        }
      }
    }
    expect([...outcomes].sort()).toEqual(
      expect.arrayContaining([
        "comment.view allowed",
        "comment.view inTrash",
        "comment.view noSpaceRole",
        "comment.view resourceNotFound",
        "comment.view restricted",
        "comment.view unpublished",
        "item.view accountInactive",
        "item.view allowed",
        "item.view anonymous",
        "item.view inTrash",
        "item.view noSpaceRole",
        "item.view resourceNotFound",
        "item.view restricted",
        "item.view unpublished",
      ]),
    );
  });

  it("loads the facts for many items of one space with a fixed number of queries", async () => {
    const [, editor] = principals.find(([name]) => name === "editor") ?? [];
    if (!editor) throw new Error("missing editor");
    const items = resources.item ?? [];
    const count = async (list: Resource[]) => {
      const counter = countQueries(test.pool);
      await runWithRequestContext({ requestId: "batch", cache: new Map() }, () =>
        test.services.authorization.explainMany(editor, "item.view", list),
      );
      return counter.stop();
    };
    expect(await count(items.slice(0, 8))).toBe(await count(items.slice(0, 2)));
  });

  it("checks a page with at most four queries and reuses them for the rest of the request", async () => {
    const [, editor] = principals.find(([name]) => name === "editor") ?? [];
    const [target] = resources.item ?? [];
    if (!editor || !target) throw new Error("missing editor or item");
    const counter = countQueries(test.pool);
    await runWithRequestContext({ requestId: "budget", cache: new Map() }, async () => {
      await test.services.authorization.explain(editor, "item.view", target);
      const first = counter.count;
      await test.services.authorization.explain(editor, "item.view", target);
      await test.services.authorization.explain(editor, "item.edit", target);
      expect(first).toBeLessThanOrEqual(4);
      expect(counter.count).toBe(first);
    });
    counter.stop();
  });

  it("sees a change made earlier in the same request", async () => {
    const [, editor] = principals.find(([name]) => name === "editor") ?? [];
    const spaceId = (
      await test.database.execute<{ space_id: string }>(
        sql`select space_id from tree_items where id = ${resources.item?.[0]?.id ?? null}`,
      )
    ).rows[0]?.space_id;
    if (editor?.type !== "account" || !spaceId) throw new Error("missing editor or space");
    const itemId = await page(editor.id, spaceId, "Trashed later");
    const resource = { type: "item", id: itemId };
    await runWithRequestContext({ requestId: "write", cache: new Map() }, async () => {
      expect((await test.services.authorization.explain(editor, "item.view", resource)).allowed).toBe(true);
      await test.services.trash.deleteItem(editor, itemId);
      const after = await test.services.authorization.explain(editor, "item.view", resource);
      expect(after.allowed).toBe(false);
      expect(after.denials).toContain("inTrash");
    });
  });

  it("answers queued checks of several actions together", async () => {
    const [, reader] = principals.find(([name]) => name === "reader") ?? [];
    if (!reader) throw new Error("missing reader");
    const decide = test.services.authorization.batch(reader, { fresh: true });
    const queued = await Promise.all([
      ...(resources.item ?? []).map((resource) => decide("item.view", resource)),
      ...(resources.comment ?? []).map((resource) => decide("comment.view", resource)),
    ]);
    const single = [];
    for (const [action, list] of [
      ["item.view", resources.item ?? []],
      ["comment.view", resources.comment ?? []],
    ] as const) {
      for (const resource of list) {
        single.push(await test.services.authorization.explain(reader, action, resource, { fresh: true }));
      }
    }
    expect(queued).toEqual(single);
  });
});
