import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ANONYMOUS, accountPrincipal, type Principal, SYSTEM } from "../accounts/principal.js";
import { searchRequest } from "../search/search.testing.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";

const baseUrl = testDatabaseBaseUrl();

type Subject =
  | "spaceAdmin"
  | "organizationOwner"
  | "itEditor"
  | "hrEditor"
  | "plainEditor"
  | "hrReader"
  | "reader"
  | "guest"
  | "portal"
  | "itToken"
  | "anonymous";

type Article = "a" | "a2" | "b" | "c" | "d";

const SUBJECTS: Subject[] = [
  "spaceAdmin",
  "organizationOwner",
  "itEditor",
  "hrEditor",
  "plainEditor",
  "hrReader",
  "reader",
  "guest",
  "portal",
  "itToken",
  "anonymous",
];
const ARTICLES: Article[] = ["a", "a2", "b", "c", "d"];

const READS: Record<Subject, Article[]> = {
  spaceAdmin: ["a", "a2", "b", "d"],
  organizationOwner: ["a", "a2", "b", "d"],
  itEditor: ["a", "a2", "b", "d"],
  hrEditor: ["a", "a2", "b", "c", "d"],
  plainEditor: ["a", "a2", "b", "d"],
  hrReader: ["a", "a2", "b", "c", "d"],
  reader: ["a", "a2", "b", "d"],
  guest: ["a", "a2", "b", "d"],
  portal: ["a", "a2", "b", "d"],
  itToken: ["a", "a2", "b", "d"],
  anonymous: [],
};

const WRITES: Record<Subject, Article[]> = {
  spaceAdmin: ["a", "a2", "b", "d"],
  organizationOwner: [],
  itEditor: ["a", "a2", "b", "d"],
  hrEditor: ["c", "d"],
  plainEditor: ["d"],
  hrReader: [],
  reader: [],
  guest: [],
  portal: [],
  itToken: ["a", "a2", "b", "d"],
  anonymous: [],
};

describe.skipIf(!baseUrl)("access to knowledge base categories", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);
  const principals = {} as Record<Subject, Principal>;
  const ids = {} as Record<Subject, string>;
  const articles = {} as Record<Article, string>;
  const folders = {} as Record<"A" | "A1" | "A2" | "B" | "C" | "C1" | "D", string>;
  const groups = {} as Record<"it" | "hr" | "facility", string>;
  let spaceId = "";
  let organizationId = "";

  async function create(actor: Principal, kind: "page" | "folder", title: string, parentId: string | null) {
    const created = await test.services.tree.create(actor, spaceId, { kind, title, placement: { parentId } });
    return created.id;
  }

  async function article(title: string, parentId: string) {
    const id = await create(principals.spaceAdmin, "page", title, parentId);
    await test.services.versions.publish(principals.spaceAdmin, id);
    return id;
  }

  async function denial(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (error) {
      const failure = error as { code?: string; decision?: { denials?: string[] } };
      return failure.decision?.denials?.[0] ?? failure.code ?? "unknown";
    }
    return "allowed";
  }

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    const { organization, member, group, portalReader } = fixtures;
    const org = await organization();
    organizationId = org.id;
    ids.organizationOwner = org.owner;
    for (const subject of [
      "spaceAdmin",
      "itEditor",
      "hrEditor",
      "plainEditor",
      "hrReader",
      "reader",
    ] as const) {
      ids[subject] = await member(org.id);
    }
    ids.guest = await member(org.id, "guest");
    const bot = await test.services.serviceAccounts.create(SYSTEM, org.id, { name: "Article bot" });
    ids.itToken = bot.id;
    groups.it = await group(org.id, [ids.itEditor, ids.itToken]);
    groups.hr = await group(org.id, [ids.hrEditor, ids.hrReader]);
    groups.facility = await group(org.id, []);
    const editor = (id: string) => ({
      principalKind: "account" as const,
      principalId: id,
      role: "editor" as const,
    });
    const reader = (id: string) => ({
      principalKind: "account" as const,
      principalId: id,
      role: "reader" as const,
    });
    const kb = await test.services.spaces.create(
      accountPrincipal(ids.spaceAdmin),
      org.id,
      {
        name: `Help ${randomUUID().slice(0, 6)}`,
        key: `H${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`,
        type: "knowledgeBase",
        audience: "public",
        grants: [
          editor(ids.itEditor),
          editor(ids.hrEditor),
          editor(ids.plainEditor),
          editor(ids.itToken),
          reader(ids.hrReader),
          reader(ids.reader),
          reader(ids.guest),
        ],
      },
      test.services.spacePermissions.holders,
    );
    spaceId = kb.id;
    ids.portal = await portalReader(org.id, [spaceId]);
    ids.anonymous = "";
    for (const subject of SUBJECTS) principals[subject] = accountPrincipal(ids[subject]);
    principals.anonymous = ANONYMOUS;
    principals.itToken = {
      type: "account",
      id: ids.itToken,
      token: {
        id: randomUUID(),
        organizationId: org.id,
        scopes: { organization: { spaces: "manage" } },
        contentLevel: "publish",
        knowledgeBaseIds: null,
      },
    };

    const admin = principals.spaceAdmin;
    folders.A = await create(admin, "folder", "IT and devices", null);
    folders.A1 = await create(admin, "folder", "Laptops", folders.A);
    folders.A2 = await create(admin, "folder", "Docking stations", folders.A1);
    folders.B = await create(admin, "folder", "Buildings", null);
    folders.C = await create(admin, "folder", "People internal", null);
    folders.C1 = await create(admin, "folder", "Salaries", folders.C);
    folders.D = await create(admin, "folder", "General", null);
    articles.a = await article("Reset a password", folders.A);
    articles.a2 = await article("Connect a dock", folders.A2);
    articles.b = await article("Book a room", folders.B);
    articles.c = await article("Salary bands", folders.C1);
    articles.d = await article("Welcome", folders.D);

    const access = test.services.categoryAccess;
    await access.change(admin, spaceId, folders.A, {
      responsibleGroupIds: [groups.it],
      visibleGroupIds: null,
    });
    await access.change(admin, spaceId, folders.B, {
      responsibleGroupIds: [groups.facility, groups.it],
      visibleGroupIds: null,
    });
    await access.change(admin, spaceId, folders.C, {
      responsibleGroupIds: [groups.hr],
      visibleGroupIds: [groups.hr],
    });
  });

  afterAll(async () => {
    await test?.close();
  });

  it("decides reading and writing for every subject and article, the same in the decision and in SQL", async () => {
    const auth = test.services.authorization;
    for (const subject of SUBJECTS) {
      const principal = principals[subject];
      for (const article of ARTICLES) {
        const resource = { type: "item", id: articles[article] };
        const reads = (await auth.explain(principal, "item.view", resource, { fresh: true })).allowed;
        const portalReads = await test.database.execute<{ readable: boolean }>(sql`
          select ${auth.portalFilter(principal, sql`t`, sql`s`)} as readable
          from tree_items t join spaces s on s.id = t.space_id where t.id = ${articles[article]}`);
        const expectedRead = READS[subject].includes(article) || (subject === "anonymous" && article !== "c");
        expect(reads || portalReads.rows[0]?.readable === true, `${subject} reads ${article}`).toBe(
          expectedRead,
        );
        for (const action of ["item.edit", "item.publish", "item.delete"]) {
          const writes = (await auth.explain(principal, action, resource, { fresh: true })).allowed;
          expect(writes, `${subject} ${action} ${article}`).toBe(WRITES[subject].includes(article));
        }
        if (subject === "anonymous") continue;
        const filtered = await test.database.execute<{ reader: boolean; editor: boolean }>(sql`
          select ${auth.itemFilter(principal, sql`t`, sql`s`)} as reader,
            ${auth.itemFilter(principal, sql`t`, sql`s`, "editor", { editRestriction: true })} as editor
          from tree_items t join spaces s on s.id = t.space_id where t.id = ${articles[article]}`);
        const decidedRead = (await auth.explain(principal, "item.view", resource, { fresh: true })).allowed;
        const decidedWrite = (await auth.explain(principal, "item.edit", resource, { fresh: true })).allowed;
        expect(filtered.rows[0]?.reader, `${subject} filter reads ${article}`).toBe(decidedRead);
        expect(filtered.rows[0]?.editor, `${subject} filter writes ${article}`).toBe(decidedWrite);
      }
    }
  });

  it("decides the same in the batch check as one by one", async () => {
    const auth = test.services.authorization;
    const resources = ARTICLES.map((article) => ({ type: "item", id: articles[article] }));
    for (const subject of SUBJECTS) {
      for (const action of ["item.view", "item.edit", "item.publish"]) {
        const many = await auth.explainMany(principals[subject], action, resources, { fresh: true });
        const batch = auth.batch(principals[subject], { fresh: true });
        const batched = await Promise.all(resources.map((resource) => batch(action, resource)));
        for (const [index, resource] of resources.entries()) {
          const one = await auth.explain(principals[subject], action, resource, { fresh: true });
          expect(many[index]?.denials, `${subject} ${action} ${index}`).toEqual(one.denials);
          expect(batched[index]?.allowed, `${subject} ${action} ${index}`).toBe(one.allowed);
        }
      }
    }
  });

  it("finds every readable article in search and marks those outside the own categories", async () => {
    await test.services.search.indexer.drain();
    const find = async (subject: Subject, query: string) =>
      (await test.services.search.search(principals[subject], organizationId, searchRequest(query))).results;
    const it = await find("itEditor", "Book a room");
    expect(it.find((hit) => hit.itemId === articles.b)?.otherCategory).toBe(false);
    const hr = await find("hrEditor", "Book a room");
    expect(hr.find((hit) => hit.itemId === articles.b)?.otherCategory).toBe(true);
    expect(
      (await find("hrEditor", "Salary bands")).find((hit) => hit.itemId === articles.c)?.otherCategory,
    ).toBe(false);
    expect((await find("itEditor", "Salary bands")).map((hit) => hit.itemId)).not.toContain(articles.c);
    expect(
      (await find("plainEditor", "Book a room")).find((hit) => hit.itemId === articles.b)?.otherCategory,
    ).toBe(false);
  });

  it("names the missing responsibility as the reason", async () => {
    const decision = await test.services.authorization.explain(principals.hrEditor, "item.edit", {
      type: "item",
      id: articles.a2,
    });
    expect(decision.denials).toEqual(["notResponsible"]);
  });

  it("lets only responsible people create articles in a category and its subcategories", async () => {
    expect(await denial(create(principals.hrEditor, "page", "Printer", folders.A2))).toBe("notResponsible");
    expect(await denial(create(principals.plainEditor, "page", "Printer", folders.A))).toBe("notResponsible");
    expect(await denial(create(principals.itEditor, "page", "Printer", folders.A2))).toBe("allowed");
    expect(await denial(create(principals.plainEditor, "page", "Notes", folders.D))).toBe("allowed");
  });

  it("asks before a move between categories changes who may write, and refuses moves out of other categories", async () => {
    const tree = test.services.tree;
    const moved = await article("VPN", folders.A);
    const impact = await tree.moveImpact(principals.itEditor, moved, { parentId: folders.D });
    expect(impact.confirmation).not.toBeNull();
    expect(impact.changes.map((change) => change.accountId)).toEqual(
      expect.arrayContaining([ids.hrEditor, ids.plainEditor]),
    );
    expect(await denial(tree.move(principals.itEditor, moved, { parentId: folders.D }))).toBe(
      "moveChangesAccess",
    );
    expect(await denial(tree.move(principals.hrEditor, moved, { parentId: folders.D }))).toBe(
      "notResponsible",
    );
    expect(await denial(tree.move(principals.plainEditor, articles.d, { parentId: folders.A }))).toBe(
      "notResponsible",
    );
    await tree.move(principals.itEditor, moved, {
      parentId: folders.D,
      confirmation: impact.confirmation ?? "",
    });
    const decision = await test.services.authorization.explain(principals.plainEditor, "item.edit", {
      type: "item",
      id: moved,
    });
    expect(decision.allowed).toBe(true);
  });

  it("is changed by space admins of the knowledge base only, not by organization admins or editors", async () => {
    const access = test.services.categoryAccess;
    for (const subject of ["organizationOwner", "itEditor", "hrReader"] as const) {
      expect(
        await denial(
          access.change(principals[subject], spaceId, folders.D, {
            responsibleGroupIds: [],
            visibleGroupIds: null,
          }),
        ),
        subject,
      ).toMatch(/categoryAccessForSpaceAdmins|spaceNotFound/);
    }
    expect(
      await denial(
        test.services.pageAccess.change(principals.spaceAdmin, folders.D, [
          { action: "restrict", kind: "view" },
        ]),
      ),
    ).toBe("categoryAccessManaged");
  });

  it("lets a subcategory narrow, never widen, the groups of the category above", async () => {
    const access = test.services.categoryAccess;
    expect(
      await denial(
        access.change(principals.spaceAdmin, spaceId, folders.A1, {
          responsibleGroupIds: [groups.hr],
          visibleGroupIds: null,
        }),
      ),
    ).toBe("categoryWidensParent");
    expect(
      await denial(
        access.change(principals.spaceAdmin, spaceId, folders.C1, {
          responsibleGroupIds: [],
          visibleGroupIds: [groups.it],
        }),
      ),
    ).toBe("categoryWidensParent");
    expect(
      await denial(
        access.change(principals.spaceAdmin, spaceId, folders.A1, {
          responsibleGroupIds: [groups.it],
          visibleGroupIds: null,
        }),
      ),
    ).toBe("allowed");
  });

  it("shows the effect before saving and asks before widening the readers", async () => {
    const access = test.services.categoryAccess;
    const effect = await access.preview(principals.spaceAdmin, spaceId, folders.D, {
      responsibleGroupIds: [groups.it],
      visibleGroupIds: [groups.it],
    });
    expect(effect.losingWrite.map((change) => change.accountId)).toEqual(
      expect.arrayContaining([ids.hrEditor, ids.plainEditor]),
    );
    expect(effect.losingWrite.map((change) => change.accountId)).not.toContain(ids.itEditor);
    expect(effect.losingRead).toBeGreaterThanOrEqual(3);
    expect(effect.articles).toBeGreaterThanOrEqual(1);
    expect(effect.publicPortalLosesAccess).toBe(true);
    const unchanged = await test.services.authorization.explain(principals.plainEditor, "item.edit", {
      type: "item",
      id: articles.d,
    });
    expect(unchanged.allowed).toBe(true);

    const widened = { responsibleGroupIds: [groups.hr], visibleGroupIds: null };
    expect(await denial(access.change(principals.spaceAdmin, spaceId, folders.C, widened))).toBe(
      "categoryVisibilityWidening",
    );
    const opened = await access.change(principals.spaceAdmin, spaceId, folders.C, {
      ...widened,
      confirmWidening: true,
    });
    expect(opened.visibleTo).toBeNull();
    const audit = await test.database.execute<{ fields: Record<string, unknown> }>(sql`
      select fields from audit_events where target_id = ${folders.C} and name = 'knowledgeBase.categoryAccessChanged'
      order by occurred_at desc limit 1`);
    expect(audit.rows[0]?.fields).toMatchObject({ widened: true, visibleGroupIds: null });
    await access.change(principals.spaceAdmin, spaceId, folders.C, {
      responsibleGroupIds: [groups.hr],
      visibleGroupIds: [groups.hr],
    });
  });

  it("lists categories with their groups, hidden ones for space admins only", async () => {
    const access = test.services.categoryAccess;
    const forAdmin = await access.list(principals.spaceAdmin, spaceId);
    const hidden = forAdmin.find((entry) => entry.itemId === folders.C);
    expect(hidden).toMatchObject({ readable: false, visibleTo: [{ id: groups.hr }] });
    const forIt = await access.list(principals.itEditor, spaceId);
    expect(forIt.map((entry) => entry.itemId)).not.toContain(folders.C);
    expect(forIt.find((entry) => entry.itemId === folders.A2)).toMatchObject({
      mine: true,
      writable: true,
      responsibleGroups: null,
      inheritedResponsibleGroups: [{ id: groups.it }],
    });
    expect(forIt.find((entry) => entry.itemId === folders.D)).toMatchObject({ mine: false, writable: true });
    const forHr = await access.list(principals.hrEditor, spaceId);
    expect(forHr.find((entry) => entry.itemId === folders.A)).toMatchObject({ mine: false, writable: false });
    expect(forHr.find((entry) => entry.itemId === folders.C)).toMatchObject({ mine: true, readable: true });
  });

  it("keeps a category closed to editors when its last responsible group is deleted", async () => {
    const lonely = await fixtures.group(organizationId, [ids.plainEditor]);
    const folder = await create(principals.spaceAdmin, "folder", "Temporary", null);
    const note = await article("Temporary note", folder);
    await test.services.categoryAccess.change(principals.spaceAdmin, spaceId, folder, {
      responsibleGroupIds: [lonely],
      visibleGroupIds: null,
    });
    await test.database.execute(sql`delete from groups where id = ${lonely}`);
    const auth = test.services.authorization;
    const resource = { type: "item", id: note };
    expect((await auth.explain(principals.plainEditor, "item.edit", resource, { fresh: true })).allowed).toBe(
      false,
    );
    expect((await auth.explain(principals.spaceAdmin, "item.edit", resource, { fresh: true })).allowed).toBe(
      true,
    );
  });
});
