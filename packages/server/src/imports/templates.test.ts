import type { NodeJson } from "@pagehall/editor-schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../logging/logger.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { testJobContext } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { AtlassianDirectory } from "./atlassian.js";
import { ConfluenceCsvReader } from "./confluence/csv-reader.js";
import { ConfluenceXmlReader } from "./confluence/xml-reader.js";
import { ImportPipeline } from "./pipeline.js";
import { ImportReaderRegistry } from "./source.js";
import type { SyntheticExport } from "./testing/confluence-export.js";
import { ALICE } from "./testing/fixture.js";
import { importHarness } from "./testing/harness.js";
import { ImportWorker } from "./worker.js";

const baseUrl = testDatabaseBaseUrl();

const SOURCE = { home: "100", project: "200", notes: "300", other: "400" } as const;
const TEMPLATE = { notes: "900", followUp: "901", foreign: "902", older: "903" } as const;

function parameter(name: string, value: string): string {
  return `<ac:parameter ac:name="${name}">${value}</ac:parameter>`;
}

function macro(name: string, ...parameters: string[]): string {
  return `<ac:structured-macro ac:name="${name}" ac:schema-version="1">${parameters.join("")}</ac:structured-macro>`;
}

const DECISION =
  '<ac:adf-extension><ac:adf-node type="decision-list"><ac:adf-node type="decision-item">' +
  '<ac:adf-attribute key="state">DECIDED</ac:adf-attribute><ac:adf-content>Ship in May</ac:adf-content>' +
  "</ac:adf-node></ac:adf-node></ac:adf-extension>";

function model(key: string): SyntheticExport {
  const space = `<ri:space ri:space-key="${key}" />`;
  return {
    space: { id: "50", key, name: "Projects", homePageId: SOURCE.home },
    users: [ALICE],
    attachments: [],
    pages: [
      {
        id: SOURCE.home,
        title: "Projects",
        parentId: null,
        position: 0,
        creatorKey: ALICE.key,
        body: [
          macro(
            "recently-updated",
            parameter("types", "page"),
            parameter("max", "15"),
            parameter("spaces", space),
          ),
          macro("decisionreport", parameter("cql", `space = "${key}" and parent = "999999"`)),
        ].join(""),
      },
      {
        id: SOURCE.project,
        title: "Project Alpha",
        parentId: SOURCE.home,
        position: 1,
        creatorKey: ALICE.key,
        labels: ["project-alpha"],
        body: [
          macro(
            "create-from-template",
            parameter("spaceKey", space),
            parameter("templateId", TEMPLATE.notes),
            parameter("title", "@currentDate Alpha notes"),
            parameter("buttonLabel", "New meeting note"),
          ),
          '<ac:macro ac:name="create-from-template">' +
            parameter(
              "blueprintModuleCompleteKey",
              "com.atlassian.confluence.plugins.confluence-business-blueprints:meeting-notes-blueprint",
            ) +
            parameter("createButtonLabel", "Create meeting note") +
            "</ac:macro>",
          macro(
            "tasks-report-macro",
            parameter("pages", SOURCE.project),
            parameter("isMissingRequiredParameters", "true"),
            parameter("labels", "project-alpha"),
          ),
          macro(
            "decisionreport",
            parameter("cql", `space = "${key}" and label = "project-alpha" and parent = "${SOURCE.project}"`),
          ),
          macro(
            "content-report-table",
            parameter("maxResults", "20"),
            parameter("spaces", space),
            parameter("labels", "project-alpha"),
          ),
          macro("children", parameter("page", '<ac:link><ri:page ri:content-title="Kick-off" /></ac:link>')),
        ].join(""),
      },
      {
        id: SOURCE.notes,
        title: "Meeting 1",
        parentId: SOURCE.project,
        position: 2,
        creatorKey: ALICE.key,
        labels: ["project-alpha"],
        body: `<p>Notes</p>${DECISION}`,
        history: [{ id: "301", title: "Kick-off", body: "<p>Draft</p>" }],
      },
      {
        id: SOURCE.other,
        title: "Kick-off",
        parentId: SOURCE.home,
        position: 3,
        creatorKey: ALICE.key,
        body: "<p>Other</p>",
        history: [{ id: "401", title: "Kick-off", body: "<p>Old</p>" }],
      },
    ],
    templates: [
      {
        id: TEMPLATE.notes,
        name: "Meeting   notes",
        description: "Notes of a project meeting",
        creatorKey: ALICE.key,
        body:
          '<at:declarations><at:string at:name="Project name" /><at:list at:name="Kind"><at:option at:value="Weekly" /><at:option at:value="Review" /></at:list></at:declarations>' +
          '<h1>Meeting about <at:var at:name="Project name" /></h1><p><ac:placeholder>Who attended?</ac:placeholder></p>' +
          `<p>Kind: <at:var at:name="Kind" /></p>${DECISION}` +
          macro(
            "create-from-template",
            parameter("templateId", TEMPLATE.followUp),
            parameter("title", "@Topic@ follow-up"),
          ) +
          macro("roadmap", parameter("timeline", "true")),
      },
      { id: TEMPLATE.followUp, name: "Follow-up", creatorKey: ALICE.key, body: "<p>Next steps</p>" },
      { id: TEMPLATE.foreign, name: "Elsewhere", creatorKey: ALICE.key, body: "<p>x</p>", spaceId: "51" },
      {
        id: TEMPLATE.older,
        name: "Meeting notes (old)",
        creatorKey: ALICE.key,
        body: "<p>x</p>",
        previousVersionOf: TEMPLATE.notes,
      },
    ],
  };
}

function nodes(node: NodeJson): NodeJson[] {
  return [node, ...(node.content ?? []).flatMap(nodes)];
}

describe.skipIf(!baseUrl)("Confluence imports: space templates and reports", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);
  const harness = importHarness(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl as string);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function templatesOf(spaceId: string) {
    const result = await test.database.execute<{
      id: string;
      name: string;
      description: string;
      title: string;
      fields: unknown;
      document: NodeJson;
    }>(sql`
      select id, name, description, title, fields, document from page_templates
      where space_id = ${spaceId} order by name`);
    return result.rows;
  }

  async function documentOf(itemId: string): Promise<NodeJson> {
    const result = await test.database.execute<{ snapshot: NodeJson }>(
      sql`select snapshot from page_documents where item_id = ${itemId}`,
    );
    return result.rows[0]?.snapshot as NodeJson;
  }

  it("imports the space templates with input fields and points the buttons and reports at the imported content", async () => {
    const organization = await fixtures.organization();
    const result = await harness.imported(model("TPLX"), {
      organizationId: organization.id,
      admin: organization.owner,
      key: "TPLX",
    });
    expect(result.state).toBe("review");
    const spaceId = result.quarantineSpace?.id ?? "";
    const templates = await templatesOf(spaceId);
    expect(templates.map((template) => template.name)).toEqual(["Follow-up", "Meeting notes"]);
    const [followUp, notes] = templates;
    expect(notes?.fields).toEqual([
      { key: "projectName", label: "Project name", type: "text", required: false },
      { key: "kind", label: "Kind", type: "choice", required: false, options: ["Weekly", "Review"] },
      { key: "currentDate", label: "Date", type: "date", required: false },
    ]);
    expect(notes).toMatchObject({ description: "Notes of a project meeting", title: "Meeting notes" });
    const content = nodes(notes?.document as NodeJson);
    expect(content.filter((node) => node.type === "templateField").map((node) => node.attrs?.field)).toEqual([
      "projectName",
      "kind",
    ]);
    expect(content.find((node) => node.type === "placeholder")?.attrs).toEqual({ text: "Who attended?" });
    expect(content.find((node) => node.type === "templateButton")?.attrs).toEqual({
      templateId: followUp?.id,
      label: "",
      title: "{topic} follow-up",
    });
    expect(followUp?.fields).toEqual([{ key: "topic", label: "topic", type: "text", required: false }]);
    expect(await harness.target(result.id, "template", TEMPLATE.notes)).toBe(notes?.id);

    const project = await harness.target(result.id, "page", SOURCE.project);
    const kickOff = await harness.target(result.id, "page", SOURCE.other);
    const blocks = (await documentOf(project)).content ?? [];
    expect(blocks.map((block) => [block.type, block.attrs])).toEqual([
      [
        "templateButton",
        { templateId: notes?.id, label: "New meeting note", title: "{currentDate} Alpha notes" },
      ],
      ["templateButton", { templateId: "builtin:meeting-notes", label: "Create meeting note", title: "" }],
      [
        "taskReport",
        {
          spaceId: null,
          seriesId: null,
          pageIds: [project],
          labels: ["project-alpha"],
          assignee: null,
          assignedToViewer: false,
          due: "any",
          status: "open",
        },
      ],
      ["decisionReport", { spaceId, labels: ["project-alpha"], parentId: project, order: "newest" }],
      ["pageReport", { spaceId, labels: ["project-alpha"], sort: "modified", reverse: false, limit: 20 }],
      ["childPages", { pageId: kickOff, depth: 1, sort: "tree", reverse: false }],
    ]);
    const home = (await documentOf(await harness.target(result.id, "page", SOURCE.home))).content ?? [];
    expect(home.map((block) => [block.type, block.attrs?.name ?? block.attrs?.limit])).toEqual([
      ["pageReport", 15],
      ["unsupportedMacro", "decisionreport"],
    ]);

    const macros = await test.services.imports.macros(harness.as(organization.owner), result.id);
    expect(macros.map((entry) => entry.name).sort()).toEqual(["decisionreport", "roadmap"]);
    const entries = await test.services.imports.entries(harness.as(organization.owner), result.id, {
      macro: "roadmap",
      limit: 10,
    });
    expect(entries.entries).toEqual([
      expect.objectContaining({ item: null, template: { id: notes?.id, name: "Meeting notes" } }),
    ]);
  });

  it("resolves a child page list by a title the page had earlier only when that title is unique", async () => {
    const organization = await fixtures.organization();
    const unique = model("TPLU");
    const result = await harness.imported(
      {
        ...unique,
        pages: unique.pages.map((page) =>
          page.id === SOURCE.other
            ? { ...page, title: "Retro", history: [{ id: "401", title: "Retro", body: "<p>Old</p>" }] }
            : page,
        ),
      },
      { organizationId: organization.id, admin: organization.owner, key: "TPLU" },
    );
    const project = await harness.target(result.id, "page", SOURCE.project);
    const notes = await harness.target(result.id, "page", SOURCE.notes);
    const children = ((await documentOf(project)).content ?? []).at(-1);
    expect(children).toMatchObject({ type: "childPages", attrs: { pageId: notes } });

    const ambiguous = await harness.imported(
      {
        ...unique,
        pages: unique.pages.map((page) =>
          page.id === SOURCE.other
            ? { ...page, title: "Retro", history: [{ id: "401", title: "Kick-off", body: "<p>Old</p>" }] }
            : page,
        ),
      },
      { organizationId: organization.id, admin: organization.owner, key: "TPLA" },
    );
    const last = (
      (await documentOf(await harness.target(ambiguous.id, "page", SOURCE.project))).content ?? []
    ).at(-1);
    expect(last).toMatchObject({ type: "unsupportedMacro", attrs: { name: "children" } });
  });

  it("imports the CSV export with the same templates as the XML export", async () => {
    const organization = await fixtures.organization();
    const input = { organizationId: organization.id, admin: organization.owner };
    const xml = await harness.imported(model("TPLV"), { ...input, key: "TPLV" });
    const csv = await harness.imported(model("TPLV"), { ...input, key: "TPLW", format: "csv" });
    const shape = async (spaceId: string) =>
      (await templatesOf(spaceId)).map((template) => ({
        ...template,
        id: "ID",
        document: JSON.stringify(template.document).replace(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
          "ID",
        ),
      }));
    expect(await shape(csv.quarantineSpace?.id ?? "")).toEqual(await shape(xml.quarantineSpace?.id ?? ""));
  });

  it("continues after a crash while templates convert without creating a template twice", async () => {
    const organization = await fixtures.organization();
    const id = await harness.prepared(model("TPLC"), {
      organizationId: organization.id,
      admin: organization.owner,
      key: "TPLC",
    });
    await test.services.imports.start(harness.as(organization.owner), id);
    const failing = new ConfluenceXmlReader();
    const original = failing.pagesByTitle.bind(failing);
    let crashed = false;
    failing.pagesByTitle = async (context, titles) => {
      const phase = await test.database.execute<{ phase: string }>(
        sql`select phase from imports where id = ${id}`,
      );
      if (!crashed && phase.rows[0]?.phase === "templates") {
        crashed = true;
        throw new Error("Simulated crash");
      }
      return original(context, titles);
    };
    const { services, database, encryption, settings, pool } = test;
    const crashing = new ImportWorker({
      database,
      pool,
      audit: services.audit,
      authorization: services.authorization,
      notifications: services.notifications,
      encryption,
      atlassian: new AtlassianDirectory(),
      uploads: services.importUploads,
      readers: new ImportReaderRegistry().register(failing, new ConfluenceCsvReader()),
      pipeline: new ImportPipeline({
        database,
        files: services.files,
        settings,
        audit: services.audit,
        versions: services.versions,
        trash: services.trash,
      }),
      folder: services.imports.folder,
      jobs: undefined,
      logger: createLogger({ service: "test", level: "silent" }),
    });
    for (let run = 0; run < 50 && !crashed; run += 1) {
      await crashing.work(testJobContext("imports.work", { importId: id })).catch(() => undefined);
    }
    expect(crashed).toBe(true);
    await harness.drive(id);
    const result = await test.services.imports.get(harness.as(organization.owner), id);
    expect(result.state).toBe("review");
    const templates = await templatesOf(result.quarantineSpace?.id ?? "");
    expect(templates.map((template) => template.name)).toEqual(["Follow-up", "Meeting notes"]);
    expect(nodes(templates[1]?.document as NodeJson).some((node) => node.type === "templateField")).toBe(
      true,
    );
  });

  it("deletes the imported templates with the quarantine space when the import is discarded", async () => {
    const organization = await fixtures.organization();
    const result = await harness.imported(model("TPLD"), {
      organizationId: organization.id,
      admin: organization.owner,
      key: "TPLD",
    });
    const spaceId = result.quarantineSpace?.id ?? "";
    await test.services.imports.discard(harness.as(organization.owner), result.id, "TPLD");
    await harness.drive(result.id);
    expect(await templatesOf(spaceId)).toEqual([]);
  });
});
