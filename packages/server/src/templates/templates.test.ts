import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { languageSetting } from "../settings/builtin.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { builtInTemplates } from "./builtin/index.js";
import type { TemplateInput } from "./templates.js";

const baseUrl = testDatabaseBaseUrl();

const projectTemplate: TemplateInput = {
  name: "Project kickoff",
  description: "Start of a project",
  category: "projects",
  title: "Project {name} on {start}",
  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "start", label: "Start", type: "date", required: false },
    { key: "lead", label: "Lead", type: "person", required: true },
    { key: "size", label: "Size", type: "choice", required: true, options: ["Small", "Large"] },
  ],
  document: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Project " },
          { type: "templateField", attrs: { field: "name" }, marks: [{ type: "bold" }] },
          { type: "text", text: " led by " },
          { type: "templateField", attrs: { field: "lead" } },
          { type: "text", text: ", size " },
          { type: "templateField", attrs: { field: "size" } },
          { type: "text", text: ", starts " },
          { type: "templateField", attrs: { field: "start" } },
        ],
      },
      { type: "paragraph", content: [{ type: "placeholder", attrs: { text: "Describe the goal." } }] },
    ],
  },
};

describe.skipIf(!baseUrl)("page templates", () => {
  let test: TestServices;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function setup() {
    const org = await organization();
    const editorId = await member(org.id);
    const created = await space(org.id, editorId);
    return {
      org,
      editorId,
      editor: accountPrincipal(editorId),
      admin: accountPrincipal(org.owner),
      space: created,
    };
  }

  it("inserts input values into content and title and keeps placeholders", async () => {
    const context = await setup();
    const template = await test.services.templates.create(
      context.editor,
      { level: "space", spaceId: context.space.id },
      projectTemplate,
    );
    const page = await test.services.templates.instantiate(context.editor, context.space.id, {
      templateId: template.id,
      values: { name: "Atlas", start: "2026-11-02", lead: context.editorId, size: "Large" },
      placement: { parentId: null },
      mode: "live",
    });
    expect(page.title).toBe("Project Atlas on 2 Nov 2026");
    const content = (await test.services.documents.snapshot(page.id))?.document;
    const text = JSON.stringify(content);
    expect(content?.content?.[0]?.content?.[1]).toEqual({
      type: "text",
      text: "Atlas",
      marks: [{ type: "bold" }],
    });
    expect(text).toContain(`{"type":"mention","attrs":{"id":"${context.editorId}"}}`);
    expect(text).toContain(", size Large, starts ");
    expect(text).toContain('{"type":"date","attrs":{"date":"2026-11-02"}}');
    expect(text).toContain('"type":"placeholder"');
    expect(text).not.toContain("templateField");
  });

  it("fills dates with today and refuses missing or invalid values", async () => {
    const context = await setup();
    const template = await test.services.templates.create(
      context.editor,
      { level: "space", spaceId: context.space.id },
      projectTemplate,
    );
    const create = (values: Record<string, string>) =>
      test.services.templates.instantiate(context.editor, context.space.id, {
        templateId: template.id,
        values,
        placement: { parentId: null },
      });
    await expect(create({ name: "A", lead: context.editorId })).rejects.toMatchObject({
      code: "invalidTemplateValues",
      details: { fields: ["size"] },
    });
    await expect(create({ name: "A", lead: context.editorId, size: "Huge" })).rejects.toMatchObject({
      details: { fields: ["size"] },
    });
    const stranger = await member((await organization()).id);
    await expect(create({ name: "A", lead: stranger, size: "Small" })).rejects.toMatchObject({
      details: { fields: ["lead"] },
    });
    const page = await create({ name: "Today", lead: context.editorId, size: "Small" });
    const today = new Date().toISOString().slice(0, 10);
    expect(JSON.stringify((await test.services.documents.snapshot(page.id))?.document)).toContain(today);
  });

  it("uses the title pattern of a template button instead of the template's title", async () => {
    const context = await setup();
    const template = await test.services.templates.create(
      context.editor,
      { level: "space", spaceId: context.space.id },
      projectTemplate,
    );
    const create = (titlePattern: string) =>
      test.services.templates.instantiate(context.editor, context.space.id, {
        templateId: template.id,
        values: { name: "Atlas", start: "2026-11-02", lead: context.editorId, size: "Large" },
        placement: { parentId: null },
        titlePattern,
      });
    expect((await create("{start}  {name} kick-off")).title).toBe("2 Nov 2026 Atlas kick-off");
    expect((await create("{unknown} notes")).title).toBe("notes");
    expect((await create("{unknown}")).title).toBe("Project Atlas on 2 Nov 2026");
    expect((await create("")).title).toBe("Project Atlas on 2 Nov 2026");
  });

  it("does not change pages created before the template changed", async () => {
    const context = await setup();
    const template = await test.services.templates.create(
      context.editor,
      { level: "space", spaceId: context.space.id },
      projectTemplate,
    );
    const page = await test.services.templates.instantiate(context.editor, context.space.id, {
      templateId: template.id,
      values: { name: "Kept", lead: context.editorId, size: "Small" },
      placement: { parentId: null },
    });
    await test.services.templates.update(context.editor, template.id, {
      ...projectTemplate,
      document: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Changed" }] }],
      },
    });
    expect(JSON.stringify((await test.services.documents.snapshot(page.id))?.document)).not.toContain(
      "Changed",
    );
  });

  it("refuses templates that use fields they do not define", async () => {
    const context = await setup();
    await expect(
      test.services.templates.create(
        context.editor,
        { level: "space", spaceId: context.space.id },
        {
          ...projectTemplate,
          title: "Project {missing}",
        },
      ),
    ).rejects.toMatchObject({ code: "unknownTemplateField" });
  });

  it("offers only templates of the instance, the own organization and the space", async () => {
    const context = await setup();
    const other = await setup();
    const instance = await test.services.templates.create(
      context.admin,
      { level: "instance" },
      projectTemplate,
    );
    const own = await test.services.templates.create(
      context.admin,
      { level: "organization", organizationId: context.org.id },
      projectTemplate,
    );
    const foreign = await test.services.templates.create(
      other.admin,
      { level: "organization", organizationId: other.org.id },
      projectTemplate,
    );
    const otherSpace = await test.services.templates.create(
      other.editor,
      { level: "space", spaceId: other.space.id },
      projectTemplate,
    );
    const usable = (await test.services.templates.usable(context.editor, context.space.id)).map(
      (entry) => entry.id,
    );
    expect(usable).toEqual(expect.arrayContaining([instance.id, own.id]));
    expect(usable).not.toContain(foreign.id);
    expect(usable).not.toContain(otherSpace.id);
    expect(usable.filter((id) => id.startsWith("builtin:"))).toHaveLength(
      builtInTemplates.filter((template) => !template.knowledgeBase).length,
    );
    await expect(
      test.services.templates.instantiate(context.editor, context.space.id, {
        templateId: foreign.id,
        values: {},
        placement: { parentId: null },
      }),
    ).rejects.toMatchObject({ code: "templateNotFound" });
    const events = await test.database.execute<{ name: string }>(
      sql`select name from audit_events where target_id in (${instance.id}, ${own.id})`,
    );
    expect(events.rows.map((row) => row.name)).toEqual(["template.created", "template.created"]);
    await test.services.templates.delete(context.admin, instance.id);
  });

  it("creates a page from every built-in template in English and German", async () => {
    const context = await setup();
    const knowledgeBase = await test.services.spaces.create(
      context.editor,
      context.org.id,
      { name: "Help", key: "TPLHELP", type: "knowledgeBase", grants: [] },
      test.services.spacePermissions.holders,
    );
    const chain = { user: context.editorId };
    for (const language of ["en", "de"] as const) {
      await test.settings.set(languageSetting, chain, "user", language);
      for (const template of builtInTemplates) {
        const text = template.text[language];
        const values: Record<string, string> = {};
        for (const field of text.fields) {
          if (field.type === "text") values[field.key] = "Atlas";
          if (field.type === "person") values[field.key] = context.editorId;
          if (field.type === "choice") values[field.key] = field.options?.[0] ?? "";
        }
        const spaceId = template.knowledgeBase ? knowledgeBase.id : context.space.id;
        const page = await test.services.templates.instantiate(context.editor, spaceId, {
          templateId: `builtin:${template.key}`,
          values,
          placement: { parentId: null },
        });
        expect(page.title, `${language} ${template.key}`).not.toMatch(/[{}]/);
        const stored = JSON.stringify((await test.services.documents.snapshot(page.id))?.document);
        expect(stored).not.toContain("templateField");
        expect(stored).toContain(JSON.stringify(text.document.content?.[0]?.type ?? "doc"));
      }
    }
  });

  it("saves a page as a space template", async () => {
    const context = await setup();
    const page = await test.services.tree.create(context.editor, context.space.id, {
      kind: "page",
      title: "Runbook",
      mode: "publish",
      placement: { parentId: null },
    });
    await test.services.documents.replace(context.editor, page.id, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Steps" }] }],
    });
    const template = await test.services.templates.saveFromPage(context.editor, context.space.id, page.id, {
      name: "Runbook",
      description: "",
      category: "operations",
    });
    expect(template).toMatchObject({ level: "space", title: "Runbook", fields: [] });
    expect(JSON.stringify(template.document)).toContain("Steps");
  });
});
