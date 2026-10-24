import { randomUUID } from "node:crypto";
import type { DocumentJson } from "@lunedo/editor-schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import type { KnowledgeBaseAudience } from "../spaces/schema.js";
import type { SpaceGrant } from "../spaces/settings.js";
import { defaultPageModeSetting } from "../spaces/settings.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";

const baseUrl = testDatabaseBaseUrl();

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe.skipIf(!baseUrl)("knowledge bases", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);
  const { organization, member, group, space, role } = fixtures;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function knowledgeBase(
    organizationId: string,
    creator: string,
    options: { audience?: KnowledgeBaseAudience; grants?: SpaceGrant[] } = {},
  ) {
    const name = `Help ${randomUUID().slice(0, 8)}`;
    return test.services.spaces.create(
      accountPrincipal(creator),
      organizationId,
      {
        name,
        key: await test.services.spaces.suggestKey(name),
        type: "knowledgeBase",
        ...(options.audience ? { audience: options.audience } : {}),
        grants: options.grants ?? [],
      },
      test.services.spacePermissions.holders,
    );
  }

  async function setup(audience?: KnowledgeBaseAudience) {
    const org = await organization();
    const editorId = await member(org.id);
    const kb = await knowledgeBase(org.id, editorId, audience ? { audience } : {});
    return { org, editorId, editor: accountPrincipal(editorId), kb };
  }

  function create(
    actor: ReturnType<typeof accountPrincipal>,
    spaceId: string,
    input: {
      kind?: "page" | "folder" | "whiteboard" | "link";
      title?: string;
      parentId?: string | null;
    } = {},
  ) {
    return test.services.tree.create(actor, spaceId, {
      kind: input.kind ?? "page",
      title: input.title ?? `Article ${randomUUID().slice(0, 6)}`,
      placement: { parentId: input.parentId ?? null },
      ...(input.kind === "link" ? { link: { url: "https://example.org" } } : {}),
    });
  }

  async function auditNames(targetId: string): Promise<string[]> {
    const result = await test.database.execute<{ name: string }>(
      sql`select name from audit_events where target_id = ${targetId} order by sequence`,
    );
    return result.rows.map((row) => row.name);
  }

  async function numberOf(itemId: string): Promise<number | null> {
    const result = await test.database.execute<{ number: number }>(
      sql`select an.number from article_numbers an join tree_items t on t.id = an.item_id and t.space_id = an.space_id
        where an.item_id = ${itemId}`,
    );
    return result.rows[0] ? Number(result.rows[0].number) : null;
  }

  describe("space type", () => {
    it("keeps existing and new ordinary spaces standard", async () => {
      const org = await organization();
      const creator = await member(org.id);
      const created = await space(org.id, creator);
      expect(created).toMatchObject({ type: "standard", audience: null });
      const column = await test.database.execute<{ column_default: string }>(sql`
        select column_default from information_schema.columns where table_name = 'spaces' and column_name = 'type'`);
      expect(column.rows[0]?.column_default).toContain("standard");
    });

    it("creates a knowledge base without overview page, readable by all signed-in users by default", async () => {
      const { org, editorId, kb } = await setup();
      expect(kb).toMatchObject({ type: "knowledgeBase", audience: "signedIn", visibility: "instance" });
      expect(kb.overviewItemId).toBeNull();
      expect(await role(await member(org.id), kb.id)).toBe("reader");
      expect(await role(editorId, kb.id)).toBe("admin");
      const audit = await test.database.execute<{ fields: Record<string, unknown> }>(
        sql`select fields from audit_events where target_id = ${kb.id} and name = 'space.created'`,
      );
      expect(audit.rows[0]?.fields).toMatchObject({ type: "knowledgeBase", audience: "signedIn" });
    });

    it("refuses confidential knowledge bases and audiences for standard spaces", async () => {
      const org = await organization();
      const creator = await member(org.id);
      await expect(
        test.services.spaces.create(
          accountPrincipal(creator),
          org.id,
          { name: "Secret help", key: "SECHELP", type: "knowledgeBase", confidential: true, grants: [] },
          test.services.spacePermissions.holders,
        ),
      ).rejects.toMatchObject({ code: "knowledgeBaseConfidential" });
      await expect(
        test.services.spaces.create(
          accountPrincipal(creator),
          org.id,
          { name: "Team", key: "TEAMAUD", visibility: "private", audience: "public", grants: [] },
          test.services.spacePermissions.holders,
        ),
      ).rejects.toMatchObject({ code: "invalidAudience" });
    });

    it("never changes the type of a space", async () => {
      const { kb } = await setup();
      await expect(
        test.database.execute(sql`update spaces set type = 'standard', audience = null where id = ${kb.id}`),
      ).rejects.toMatchObject({ cause: { constraint: "spaces_type_fixed" } });
      const org = await organization();
      const standard = await space(org.id, await member(org.id));
      await expect(
        test.database.execute(
          sql`update spaces set type = 'knowledgeBase', audience = 'signedIn', visibility = 'instance' where id = ${standard.id}`,
        ),
      ).rejects.toMatchObject({ cause: { constraint: "spaces_type_fixed" } });
    });

    it("refuses the ordinary visibility change for knowledge bases", async () => {
      const { editor, kb } = await setup();
      await expect(test.services.spaces.changeVisibility(editor, kb.id, "private")).rejects.toMatchObject({
        code: "knowledgeBaseVisibility",
      });
    });
  });

  describe("content", () => {
    it("creates articles in publish mode, also when the organization prefers live mode", async () => {
      const { org, editor, kb } = await setup();
      await test.settings.set(defaultPageModeSetting, { organization: org.id }, "organization", "live");
      const article = await create(editor, kb.id);
      expect(article.mode).toBe("publish");
      await expect(
        test.services.tree.create(editor, kb.id, {
          kind: "page",
          title: "Live",
          placement: { parentId: null },
          mode: "live",
        }),
      ).rejects.toMatchObject({ code: "knowledgeBaseMode" });
      await expect(test.services.versions.changeMode(editor, article.id, "live")).rejects.toMatchObject({
        code: "knowledgeBaseMode",
      });
    });

    it("holds only articles and categories", async () => {
      const { editor, kb } = await setup();
      const category = await create(editor, kb.id, { kind: "folder", title: "IT" });
      const article = await create(editor, kb.id, { parentId: category.id });
      for (const kind of ["whiteboard", "link"] as const) {
        await expect(create(editor, kb.id, { kind })).rejects.toMatchObject({ code: "knowledgeBaseContent" });
      }
      await expect(test.services.blog.create(editor, kb.id, { title: "News" })).rejects.toMatchObject({
        code: "knowledgeBaseContent",
      });
      await expect(
        test.services.meetings.createSeries(editor, kb.id, {
          name: "Jour fixe",
          parentId: null,
          members: [editor.type === "account" ? editor.id : ""],
          templateId: "builtin:team-meeting",
          rhythm: { frequency: "weekly", interval: 1, weekdays: ["MO"] },
          startsOn: "2030-03-18",
          startTime: "09:30",
          timeZone: "Europe/Vienna",
          durationMinutes: 45,
        }),
      ).rejects.toMatchObject({ code: "knowledgeBaseContent" });
      await expect(create(editor, kb.id, { parentId: article.id })).rejects.toMatchObject({
        code: "knowledgeBasePlacement",
      });
      await expect(test.services.tree.convert(editor, category.id, "page")).rejects.toMatchObject({
        code: "invalidConversion",
      });
    });

    it("refuses other kinds also where the services are bypassed", async () => {
      const { kb } = await setup();
      await expect(
        test.database.execute(sql`
          insert into tree_items (id, space_id, kind, position, title, mode)
          values (${randomUUID()}, ${kb.id}, 'blogPost', 'a0', 'News', 'publish')`),
      ).rejects.toMatchObject({ cause: { constraint: "tree_items_knowledge_base_kind" } });
      await expect(
        test.database.execute(sql`
          insert into tree_items (id, space_id, kind, position, title, mode)
          values (${randomUUID()}, ${kb.id}, 'page', 'a0', 'Live', 'live')`),
      ).rejects.toMatchObject({ cause: { constraint: "tree_items_knowledge_base_mode" } });
    });

    it("moves only fitting content into a knowledge base", async () => {
      const { org, editorId, editor, kb } = await setup();
      const team = await space(org.id, editorId);
      const whiteboard = await create(editor, team.id, { kind: "whiteboard" });
      await expect(
        test.services.tree.move(editor, whiteboard.id, { spaceId: kb.id, parentId: null }),
      ).rejects.toMatchObject({
        code: "knowledgeBaseContent",
      });
      const parent = await create(editor, team.id, { title: "Parent" });
      await create(editor, team.id, { title: "Child", parentId: parent.id });
      await expect(
        test.services.tree.move(editor, parent.id, { spaceId: kb.id, parentId: null }),
      ).rejects.toMatchObject({
        code: "knowledgeBasePlacement",
      });
      const live = await test.services.tree.create(editor, team.id, {
        kind: "page",
        title: "Live page",
        placement: { parentId: null },
        mode: "live",
      });
      await expect(
        test.services.tree.move(editor, live.id, { spaceId: kb.id, parentId: null }),
      ).rejects.toMatchObject({
        code: "knowledgeBaseMode",
      });
      const fitting = await create(editor, team.id, { title: "Fitting" });
      const impact = await test.services.tree.moveImpact(editor, fitting.id, {
        spaceId: kb.id,
        parentId: null,
      });
      const moved = await test.services.tree.move(editor, fitting.id, {
        spaceId: kb.id,
        parentId: null,
        confirmation: impact.confirmation ?? undefined,
      });
      expect(moved.spaceId).toBe(kb.id);
      expect(await numberOf(fitting.id)).toEqual(expect.any(Number));
    });
  });

  describe("templates and sections", () => {
    it("offers the article templates only in knowledge bases", async () => {
      const { org, editorId, editor, kb } = await setup();
      const inKb = (await test.services.templates.usable(editor, kb.id)).map((template) => template.id);
      expect(inKb).toEqual(["builtin:article-how-to", "builtin:article-troubleshooting"]);
      const team = await space(org.id, editorId);
      const elsewhere = (await test.services.templates.usable(editor, team.id)).map(
        (template) => template.id,
      );
      expect(elsewhere).not.toContain("builtin:article-how-to");
      expect(elsewhere).toContain("builtin:how-to");
    });

    it("creates articles with the sections and type of the template", async () => {
      const { editor, kb } = await setup();
      const article = await test.services.templates.instantiate(editor, kb.id, {
        templateId: "builtin:article-troubleshooting",
        values: {},
        placement: { parentId: null },
        title: "Printer prints blank pages",
      });
      expect(article.articleType).toBe("troubleshooting");
      const draft = await test.services.knowledgeBases.article(editor, article.id, { draft: true });
      expect(draft?.sections.map((section) => [section.key, section.icon])).toEqual([
        ["symptom", "eye"],
        ["cause", "search"],
        ["resolution", "wrench"],
      ]);
      expect(draft?.templateId).toBe("builtin:article-troubleshooting");
      await test.services.knowledgeBases.setArticleType(article.id, "howTo");
      expect((await test.services.tree.get(editor, article.id))?.articleType).toBe("howTo");
      await test.services.knowledgeBases.setArticleType(article.id, null);
      expect((await test.services.tree.get(editor, article.id))?.articleType).toBeNull();
    });

    it("keeps writing without a template possible", async () => {
      const { editor, kb } = await setup();
      const article = await create(editor, kb.id, { title: "Free text" });
      expect(article.articleType).toBeNull();
      await test.services.versions.publish(editor, article.id);
      expect((await test.services.knowledgeBases.article(editor, article.id))?.sections).toEqual([]);
    });

    it("blocks publishing while a required section is empty, keeps published articles published", async () => {
      const { editor, kb } = await setup();
      const optional = await test.services.templates.instantiate(editor, kb.id, {
        templateId: "builtin:article-how-to",
        values: {},
        placement: { parentId: null },
        title: "Published before",
      });
      await test.services.versions.publish(editor, optional.id);
      const sections = await test.services.knowledgeBases.setRequired(
        editor,
        kb.id,
        "builtin:article-how-to",
        "steps",
        true,
      );
      expect(sections[0]?.sections.find((section) => section.key === "steps")?.required).toBe(true);
      expect((await test.services.tree.get(editor, optional.id))?.published).toBe(true);

      const article = await test.services.templates.instantiate(editor, kb.id, {
        templateId: "builtin:article-how-to",
        values: {},
        placement: { parentId: null },
        title: "Set up VPN",
      });
      await expect(test.services.versions.publish(editor, article.id)).rejects.toMatchObject({
        code: "requiredSectionsEmpty",
        details: { sections: [{ key: "steps", title: "Steps" }] },
      });
      const draft = await test.services.documents.snapshot(article.id);
      const filled = {
        ...draft?.document,
        content: (draft?.document.content ?? []).map((node) =>
          node.type === "section" && node.attrs?.key === "steps"
            ? { ...node, content: [paragraph("Open the client.")] }
            : node,
        ),
      } as DocumentJson;
      await test.services.documents.replace(editor, article.id, filled);
      await expect(test.services.versions.publish(editor, article.id)).resolves.toMatchObject({
        created: true,
      });

      await test.services.knowledgeBases.setRequired(editor, kb.id, "builtin:article-how-to", "steps", false);
      const later = await test.services.templates.instantiate(editor, kb.id, {
        templateId: "builtin:article-how-to",
        values: {},
        placement: { parentId: null },
        title: "Optional again",
      });
      await expect(test.services.versions.publish(editor, later.id)).resolves.toMatchObject({
        created: true,
      });
    });

    it("refuses unknown sections and templates", async () => {
      const { editor, kb } = await setup();
      await expect(
        test.services.knowledgeBases.setRequired(editor, kb.id, "builtin:article-how-to", "cause", true),
      ).rejects.toMatchObject({ code: "sectionNotFound" });
      await expect(
        test.services.knowledgeBases.setRequired(editor, kb.id, "builtin:how-to", "steps", true),
      ).rejects.toMatchObject({ code: "sectionNotFound" });
    });
  });

  describe("categories", () => {
    it("inherits contact addresses through folders of any depth and the knowledge base", async () => {
      const { editor, kb } = await setup();
      const it = await create(editor, kb.id, { kind: "folder", title: "IT" });
      const network = await create(editor, kb.id, { kind: "folder", title: "Network", parentId: it.id });
      const deeper = await create(editor, kb.id, { kind: "folder", title: "VPN", parentId: network.id });
      const deepest = await create(editor, kb.id, { kind: "folder", title: "Clients", parentId: deeper.id });
      const article = await create(editor, kb.id, { parentId: deepest.id });
      await test.services.versions.publish(editor, article.id);
      const contact = async () =>
        (await test.services.knowledgeBases.article(editor, article.id))?.contactEmail;

      expect(await contact()).toBeNull();
      await test.services.knowledgeBases.setContactEmail(kb.id, "help@example.org");
      expect(await contact()).toBe("help@example.org");
      await test.services.knowledgeBases.updateCategory(it.id, {
        contactEmail: "it@example.org",
        icon: "monitor",
      });
      expect(await contact()).toBe("it@example.org");
      await test.services.knowledgeBases.updateCategory(network.id, { contactEmail: "network@example.org" });
      expect(await contact()).toBe("network@example.org");
      await test.services.knowledgeBases.updateCategory(network.id, { contactEmail: null });
      expect(await contact()).toBe("it@example.org");
      await test.services.knowledgeBases.updateCategory(deeper.id, {
        contactEmail: "vpn@example.org",
        icon: "wifi",
      });
      expect(await contact()).toBe("vpn@example.org");

      const categories = await test.services.knowledgeBases.categories(editor, kb.id);
      expect(
        categories.map((category) => [
          category.title,
          category.level,
          category.contactSource,
          category.articles,
        ]),
      ).toEqual([
        ["IT", 1, "category", 1],
        ["Network", 2, "parentCategory", 1],
        ["VPN", 3, "category", 1],
        ["Clients", 4, "parentCategory", 1],
      ]);
      expect(categories[0]?.icon).toBe("monitor");
      expect(categories[2]?.icon).toBe("wifi");
      expect(categories[3]?.effectiveContactEmail).toBe("vpn@example.org");
      expect(
        (await test.services.knowledgeBases.article(editor, article.id))?.categoryPath.map((c) => c.title),
      ).toEqual(["IT", "Network", "VPN", "Clients"]);
      await expect(
        test.services.knowledgeBases.updateCategory(article.id, { icon: "wifi" }),
      ).rejects.toMatchObject({
        code: "notCategory",
      });
      await expect(
        test.services.knowledgeBases.updateCategory(it.id, { contactEmail: "not an address" }),
      ).rejects.toMatchObject({ code: "invalidContactEmail" });
      await expect(
        test.services.knowledgeBases.updateCategory(it.id, { icon: "<svg>" }),
      ).rejects.toMatchObject({
        code: "invalidIcon",
      });
    });

    it("lets view restrictions of categories hide their articles from readers", async () => {
      const { org, editor, kb } = await setup();
      const reader = accountPrincipal(await member(org.id));
      const hr = await create(editor, kb.id, { kind: "folder", title: "HR" });
      const salary = await create(editor, kb.id, { title: "Salary", parentId: hr.id });
      const open = await create(editor, kb.id, { title: "Holidays" });
      await test.services.versions.publish(editor, salary.id);
      await test.services.versions.publish(editor, open.id);
      await test.services.pageAccess.change(editor, hr.id, [{ action: "restrict", kind: "view" }]);
      const titles = async (viewer: ReturnType<typeof accountPrincipal>) =>
        (await test.services.knowledgeBases.articles(viewer, kb.id)).items
          .map((article) => article.title)
          .sort();
      expect(await titles(editor)).toEqual(["Holidays", "Salary"]);
      expect(await titles(reader)).toEqual(["Holidays"]);
      expect(await test.services.knowledgeBases.article(reader, salary.id)).toBeNull();
      expect(
        (await test.services.knowledgeBases.categories(reader, kb.id)).map((category) => category.title),
      ).toEqual([]);
    });
  });

  describe("audience", () => {
    it("narrows without confirmation and widens only with it, audited with the number of articles", async () => {
      const { org, editorId, editor, kb } = await setup("signedIn");
      const outsider = await member(org.id);
      const insider = await member(org.id);
      const readers = await group(org.id, [insider]);
      const article = await create(editor, kb.id);
      await test.services.versions.publish(editor, article.id);

      const narrowed = await test.services.knowledgeBases.changeAudience(editor, kb.id, {
        audience: "groups",
        groupIds: [readers],
      });
      expect(narrowed.groups.map((entry) => entry.id)).toEqual([readers]);
      expect(await role(insider, kb.id)).toBe("reader");
      expect(await role(outsider, kb.id)).toBeNull();
      expect(await role(editorId, kb.id)).toBe("admin");

      const other = await group(org.id, [outsider]);
      expect(
        await test.services.knowledgeBases.audienceImpact(kb.id, {
          audience: "groups",
          groupIds: [readers, other],
        }),
      ).toEqual({ widening: true, articles: 1 });
      await expect(
        test.services.knowledgeBases.changeAudience(editor, kb.id, {
          audience: "groups",
          groupIds: [readers, other],
        }),
      ).rejects.toMatchObject({ code: "audienceWidening", details: { articles: 1 } });
      expect(await role(outsider, kb.id)).toBeNull();

      await expect(
        test.services.knowledgeBases.changeAudience(editor, kb.id, { audience: "public", groupIds: [] }),
      ).rejects.toMatchObject({ code: "audienceWidening" });
      const widened = await test.services.knowledgeBases.changeAudience(editor, kb.id, {
        audience: "public",
        groupIds: [],
        confirmWidening: true,
      });
      expect(widened.audience).toBe("public");
      expect(await role(outsider, kb.id)).toBe("reader");

      const events = await test.database.execute<{ fields: Record<string, unknown> }>(sql`
        select fields from audit_events where target_id = ${kb.id} and name = 'knowledgeBase.audienceChanged'
        order by sequence`);
      expect(
        events.rows.map((row) => [row.fields.audience, row.fields.widened, row.fields.articles]),
      ).toEqual([
        ["groups", false, 1],
        ["public", true, 1],
      ]);
      expect(await auditNames(kb.id)).toContain("space.permissionGranted");
    });

    it("lets portal knowledge bases be read in Lunedo only by holders of a role", async () => {
      const { org, kb, editor } = await setup("signedIn");
      const colleague = await member(org.id);
      expect(await role(colleague, kb.id)).toBe("reader");
      await test.services.knowledgeBases.changeAudience(editor, kb.id, {
        audience: "portal",
        groupIds: [],
        confirmWidening: true,
      });
      expect(await role(colleague, kb.id)).toBeNull();
    });

    it("needs a group for the group audience", async () => {
      const { editor, kb } = await setup();
      await expect(
        test.services.knowledgeBases.changeAudience(editor, kb.id, { audience: "groups", groupIds: [] }),
      ).rejects.toMatchObject({ code: "audienceGroupsMissing" });
    });
  });

  describe("article addresses", () => {
    it("numbers articles per knowledge base, keeps numbers on moves and never reuses them", async () => {
      const { editor, kb } = await setup();
      const other = await knowledgeBase(kb.organizationId ?? "", editor.type === "account" ? editor.id : "");
      const first = await create(editor, kb.id);
      const second = await create(editor, kb.id);
      const elsewhere = await create(editor, other.id);
      expect([await numberOf(first.id), await numberOf(second.id), await numberOf(elsewhere.id)]).toEqual([
        1, 2, 1,
      ]);
      const folder = await create(editor, kb.id, { kind: "folder", title: "IT" });
      await test.services.tree.move(editor, first.id, { parentId: folder.id });
      expect(await numberOf(first.id)).toBe(1);
      await test.database.execute(sql`delete from tree_items where id = ${second.id}`);
      expect(await numberOf((await create(editor, kb.id)).id)).toBe(3);
      const impact = await test.services.tree.moveImpact(editor, first.id, {
        spaceId: other.id,
        parentId: null,
      });
      await test.services.tree.move(editor, first.id, {
        spaceId: other.id,
        parentId: null,
        confirmation: impact.confirmation ?? undefined,
      });
      expect(await numberOf(first.id)).toBe(2);
      const kept = await test.database.execute<{ item_id: string }>(
        sql`select item_id from article_numbers where space_id = ${kb.id} and number = 1`,
      );
      expect(kept.rows[0]?.item_id).toBe(first.id);
    });

    it("gives parallel articles different numbers", async () => {
      const { editor, kb } = await setup();
      const created = await Promise.all(Array.from({ length: 6 }, () => create(editor, kb.id)));
      const numbers = await Promise.all(created.map((item) => numberOf(item.id)));
      expect(new Set(numbers).size).toBe(6);
      expect([...numbers].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("keeps old titles as slugs that redirect", async () => {
      const { editor, kb } = await setup();
      const article = await create(editor, kb.id, { title: "VPN-Verbindung einrichten" });
      await test.services.versions.publish(editor, article.id);
      expect((await test.services.knowledgeBases.article(editor, article.id))?.slug).toBe(
        "vpn-verbindung-einrichten",
      );
      await test.services.tree.update(editor, article.id, { title: "Störung: Drucker für Büro" });
      expect((await test.services.knowledgeBases.article(editor, article.id))?.slug).toBe(
        "vpn-verbindung-einrichten",
      );
      await test.services.versions.publish(editor, article.id);
      expect((await test.services.knowledgeBases.article(editor, article.id))?.slug).toBe(
        "stoerung-drucker-fuer-buero",
      );
      const slugs = await test.database.execute<{ slug: string }>(
        sql`select slug from article_slugs where item_id = ${article.id} order by created_at, slug`,
      );
      expect(slugs.rows.map((row) => row.slug)).toEqual([
        "vpn-verbindung-einrichten",
        "stoerung-drucker-fuer-buero",
      ]);
    });

    it("makes slugs from titles with accents, symbols and other scripts", async () => {
      const slug = async (title: string) =>
        (await test.database.execute<{ slug: string }>(sql`select article_slug(${title}) as slug`)).rows[0]
          ?.slug;
      expect(await slug("  Ärger mit Outlook?! Größe ändern  ")).toBe("aerger-mit-outlook-groesse-aendern");
      expect(await slug("Café & Crème brûlée")).toBe("cafe-creme-brulee");
      expect(await slug("Привет")).toBe("");
      expect((await slug(`${"a".repeat(79)} b`))?.length).toBeLessThanOrEqual(80);
    });
  });
});
