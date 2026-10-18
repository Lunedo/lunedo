import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { type DocumentJson, editorSchemaVersion } from "@pagehall/editor-schema";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import yazl from "yazl";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { writeTemplateArchive } from "./archive.js";
import { builtInTemplates } from "./builtin/index.js";
import { fileReference, sha256, TEMPLATE_FORMAT_VERSION } from "./format.js";
import type { TemplateScope } from "./templates.js";
import type { ImportedTemplate } from "./transfer.js";

const baseUrl = testDatabaseBaseUrl();
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DATABASE_ID = /[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/;

function png(): Buffer {
  return Buffer.concat([PNG, randomBytes(64)]);
}

function doc(...content: unknown[]): DocumentJson {
  return { type: "doc", content } as DocumentJson;
}

function paragraph(...content: unknown[]) {
  return { type: "paragraph", content };
}

function text(value: string, marks?: unknown[]) {
  return { type: "text", text: value, ...(marks ? { marks } : {}) };
}

function image(attachmentId: string | null, alt = "") {
  return { type: "image", attrs: { attachmentId, alt, width: null, align: "center" } };
}

interface FileSpec {
  bytes: Buffer;
  mediaType: string;
  extension: string;
  name?: string;
}

function fileEntry(spec: FileSpec) {
  const hash = sha256(spec.bytes);
  return {
    path: `files/${hash}.${spec.extension}`,
    mediaType: spec.mediaType,
    size: spec.bytes.length,
    sha256: hash,
    name: spec.name ?? `image.${spec.extension}`,
  };
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    name: "Retro",
    description: "Team retrospective",
    category: "meetings",
    language: "en",
    titlePattern: "Retro {date}",
    fields: [{ key: "date", label: "Date", type: "date", required: false }],
    series: null,
    files: [],
    document: doc(paragraph(text("What went well?"))),
    ...overrides,
  };
}

function manifest(templates: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    format: "pagehall-template",
    formatVersion: TEMPLATE_FORMAT_VERSION,
    schemaVersion: editorSchemaVersion,
    pagehallVersion: "1.0.0",
    templates,
    ...overrides,
  };
}

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

async function zip(value: unknown, files: FileSpec[] = []): Promise<Buffer> {
  return writeTemplateArchive(
    JSON.stringify(value),
    new Map(files.map((file) => [fileEntry(file).path, file.bytes])),
  );
}

async function rawZip(entries: { name: string; bytes: Buffer; mode?: number; compress?: boolean }[]) {
  const archive = new yazl.ZipFile();
  for (const item of entries) {
    archive.addBuffer(item.bytes, item.name, {
      mtime: new Date(Date.UTC(2000, 0, 1)),
      mode: item.mode ?? 0o100644,
      compress: item.compress ?? true,
    });
  }
  archive.end();
  const parts: Buffer[] = [];
  for await (const chunk of archive.outputStream) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

function renamed(archive: Buffer, from: string, to: string): Buffer {
  expect(Buffer.byteLength(from)).toBe(Buffer.byteLength(to));
  const source = Buffer.from(from, "utf8");
  const target = Buffer.from(to, "utf8");
  const copy = Buffer.from(archive);
  let at = copy.indexOf(source);
  while (at !== -1) {
    target.copy(copy, at);
    at = copy.indexOf(source, at + source.length);
  }
  return copy;
}

describe.skipIf(!baseUrl)("template files for transfer", () => {
  let test: TestServices;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query(
      "insert into instance (id, setup_completed_at) values (1, now()) on conflict do nothing",
    );
  });

  afterAll(async () => {
    await test?.close();
  });

  async function setup() {
    const org = await organization();
    const created = await space(org.id, org.owner);
    return {
      org,
      as: accountPrincipal(org.owner),
      space: created,
      scope: { level: "space", spaceId: created.id } as TemplateScope,
    };
  }

  function preview(
    actor: Principal,
    scope: TemplateScope,
    bytes: Buffer,
    fileName = "retro.pagehall-template.zip",
  ) {
    return test.services.templateTransfers.preview(actor, scope, {
      fileName,
      body: Readable.from([bytes]),
      contentLength: bytes.length,
    });
  }

  async function only(actor: Principal, scope: TemplateScope, bytes: Buffer): Promise<ImportedTemplate> {
    const result = await preview(actor, scope, bytes);
    expect(result.templates).toHaveLength(1);
    return result.templates[0] as ImportedTemplate;
  }

  async function exportOf(actor: Principal, scope: TemplateScope, templateIds: string[] | null = null) {
    return test.services.templateTransfers.exportTemplates(actor, { scope }, templateIds, "1.2.3");
  }

  async function templateWithImage(actor: Principal, scope: TemplateScope, name: string, bytes = png()) {
    const template = await test.services.templates.create(actor, scope, {
      name,
      description: "With a picture",
      category: "teams",
      title: `${name} {team}`,
      fields: [{ key: "team", label: "Team", type: "text", required: true }],
      document: doc(paragraph(text("Draft")), { type: "paragraph" }),
    });
    const file = await test.services.templates.files.upload(actor, template.id, {
      name: "team.png",
      body: Readable.from([bytes]),
    });
    return test.services.templates.update(actor, template.id, {
      name,
      description: "With a picture",
      category: "teams",
      title: `${name} {team}`,
      fields: [{ key: "team", label: "Team", type: "text", required: true }],
      document: doc(
        paragraph(text("Welcome "), { type: "templateField", attrs: { field: "team" } }),
        image(file.id, "Team photo"),
      ),
    });
  }

  describe("round trip", () => {
    it("imports a template exported from another organization with its image", async () => {
      const source = await setup();
      const bytes = png();
      const original = await templateWithImage(source.as, source.scope, "Team page", bytes);
      const exported = await exportOf(source.as, source.scope, [original.id]);
      expect(exported.contentType).toBe("application/zip");
      expect(exported.fileName).toBe("team-page.pagehall-template.zip");

      const target = await setup();
      const result = await preview(target.as, target.scope, exported.body, exported.fileName);
      const imported = result.templates[0];
      expect(imported?.valid).toBe(true);
      expect(imported?.files).toHaveLength(1);
      const confirmed = await test.services.templateTransfers.confirm(target.as, target.scope, result.id, {
        decisions: [],
        skipInvalid: false,
      });
      const copy = confirmed.created[0];
      expect(copy).toMatchObject({
        name: original.name,
        description: original.description,
        category: original.category,
        title: original.title,
        fields: original.fields,
        level: "space",
        spaceId: target.space.id,
      });
      const imageNode = copy?.document.content?.[1];
      expect(imageNode?.attrs?.alt).toBe("Team photo");
      const fileId = String(imageNode?.attrs?.attachmentId);
      expect(fileId).not.toBe(original.document.content?.[1]?.attrs?.attachmentId);
      const content = await test.services.templates.files.content(copy?.id ?? "", fileId);
      expect(await test.services.files.readAll(content?.fileId ?? "", 1024 * 1024)).toEqual(bytes);
      expect(copy?.document.content?.[0]).toEqual(original.document.content?.[0]);
    });

    it("exports built-in templates in the chosen language as JSON without files", async () => {
      const { as } = await setup();
      const exported = await test.services.templateTransfers.exportTemplates(
        as,
        { builtIn: "de" },
        null,
        "1.2.3",
      );
      expect(exported.contentType).toBe("application/json");
      expect(exported.fileName).toBe("templates.pagehall-template.json");
      const parsed = JSON.parse(exported.body.toString("utf8"));
      expect(parsed).toMatchObject({
        format: "pagehall-template",
        formatVersion: 1,
        pagehallVersion: "1.2.3",
      });
      expect(parsed.templates.map((item: { name: string }) => item.name)).toEqual(
        builtInTemplates.map((template) => template.text.de.name),
      );
      expect(parsed.templates.every((item: { language: string }) => item.language === "de")).toBe(true);
      expect(exported.body.toString("utf8")).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
    });

    it("writes several templates into one file and imports all of them", async () => {
      const source = await setup();
      const first = await templateWithImage(source.as, source.scope, "First");
      const second = await test.services.templates.create(source.as, source.scope, {
        name: "Second",
        description: "",
        category: "knowledge",
        title: "Second",
        fields: [],
        document: doc(paragraph(text("Plain"))),
      });
      const exported = await exportOf(source.as, source.scope, [first.id, second.id]);
      expect(exported.templates.map((item) => item.name)).toEqual(["First", "Second"]);
      const target = await setup();
      const result = await preview(target.as, target.scope, exported.body);
      const confirmed = await test.services.templateTransfers.confirm(target.as, target.scope, result.id, {
        decisions: [],
        skipInvalid: false,
      });
      expect(confirmed.created.map((template) => template.name).sort()).toEqual(["First", "Second"]);
    });

    it("writes the same file for the same templates so it gives clean diffs", async () => {
      const { as, scope } = await setup();
      await test.services.templates.create(as, scope, {
        name: "Stable",
        description: "",
        category: "knowledge",
        title: "Stable",
        fields: [],
        document: doc(paragraph(text("Same"))),
      });
      const first = await exportOf(as, scope);
      const second = await exportOf(as, scope);
      expect(first.body.equals(second.body)).toBe(true);
    });
  });

  describe("export", () => {
    it("removes every reference to this instance and lists what it removed", async () => {
      const { org, as, scope, space: wiki } = await setup();
      const personId = await member(org.id, "member", "Erika Mustermann");
      const target = await test.services.tree.create(as, wiki.id, {
        kind: "page",
        title: "Secret salaries",
        mode: "live",
        placement: { parentId: null },
      });
      const template = await test.services.templates.create(as, scope, {
        name: "Linked",
        description: "",
        category: "knowledge",
        title: "Linked",
        fields: [],
        document: doc(
          paragraph(
            { type: "pageLink", attrs: { pageId: target.id, spaceId: wiki.id, title: null } },
            text(" and "),
            { type: "pageLink", attrs: { pageId: target.id, spaceId: wiki.id, title: null } },
            { type: "mention", attrs: { id: personId } },
            text("internal", [{ type: "link", attrs: { href: `/spaces/${wiki.key}/pages/${target.id}` } }]),
            text("external", [{ type: "link", attrs: { href: "https://example.org/guide" } }]),
          ),
          { type: "includePage", attrs: { pageId: target.id } },
          { type: "whiteboard", attrs: { whiteboardId: uuidv7() } },
          { type: "templateButton", attrs: { templateId: uuidv7(), label: "More" } },
          { type: "taskReport", attrs: { spaceId: wiki.id, assignee: personId } },
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { id: uuidv7(), assignee: personId, dueDate: null },
                content: [paragraph(text("Do it"))],
              },
            ],
          },
          { type: "embed", attrs: { url: "https://www.youtube.com/watch?v=abc" } },
        ),
      });
      const summary = await test.services.templateTransfers.exportSummary({ scope }, [template.id]);
      expect(summary[0]?.removed).toEqual({
        pageLink: 3,
        mention: 1,
        include: 1,
        whiteboard: 1,
        templateButton: 1,
        report: 1,
        person: 1,
      });
      const exported = await exportOf(as, scope, [template.id]);
      expect(exported.templates[0]?.removed).toEqual(summary[0]?.removed);
      const output = exported.body.toString("utf8");
      expect(output).not.toMatch(DATABASE_ID);
      for (const value of ["Erika", "Mustermann", "Secret salaries", wiki.key, wiki.name, org.id]) {
        expect(output).not.toContain(value);
      }
      expect(output).toContain("https://example.org/guide");
      expect(output).toContain("https://www.youtube.com/watch?v=abc");
      const audit = await test.database.execute<{ fields: Record<string, unknown> }>(sql`
        select fields from audit_events where name = 'template.exported' and actor_id = ${org.owner}`);
      expect(audit.rows.at(-1)?.fields).toMatchObject({
        level: "space",
        spaceId: wiki.id,
        templates: 1,
        builtIn: false,
        removed: summary[0]?.removed,
      });
    });

    it("removes links to the instance's own address", async () => {
      const { as, scope } = await setup();
      await test.services.instanceAddress.change(as, "https://wiki.example.net");
      const template = await test.services.templates.create(as, scope, {
        name: "Absolute",
        description: "",
        category: "knowledge",
        title: "Absolute",
        fields: [],
        document: doc(
          paragraph(text("here", [{ type: "link", attrs: { href: "https://wiki.example.net/spaces/A" } }])),
        ),
      });
      const exported = await exportOf(as, scope, [template.id]);
      expect(exported.body.toString("utf8")).not.toContain("wiki.example.net");
      expect(exported.templates[0]?.removed).toEqual({ pageLink: 1 });
    });
  });

  describe("import validation", () => {
    it("refuses an upload above 20 MB", async () => {
      const { as, scope } = await setup();
      await expect(preview(as, scope, Buffer.alloc(20 * 1024 * 1024 + 1, 32))).rejects.toMatchObject({
        name: "FileTooLargeError",
        limit: 20 * 1024 * 1024,
      });
    });

    it("refuses a file inside the archive above 5 MB", async () => {
      const { as, scope } = await setup();
      const big = {
        bytes: Buffer.concat([PNG, randomBytes(5 * 1024 * 1024)]),
        mediaType: "image/png",
        extension: "png",
      };
      const archive = await zip(manifest([entry({ files: [fileEntry(big)] })]), [big]);
      await expect(preview(as, scope, archive)).rejects.toMatchObject({ code: "templateArchiveTooLarge" });
    });

    it("refuses more than 50 templates", async () => {
      const { as, scope } = await setup();
      const templates = Array.from({ length: 51 }, (_, index) => entry({ name: `T${index}` }));
      await expect(preview(as, scope, json(manifest(templates)))).rejects.toMatchObject({
        code: "tooManyTemplates",
        message: expect.stringContaining("50"),
      });
    });

    it("refuses more entries than allowed", async () => {
      const { as, scope } = await setup();
      const entries = Array.from({ length: 205 }, (_, index) => ({
        name: `files/${sha256(Buffer.from(String(index)))}.png`,
        bytes: Buffer.from(String(index)),
      }));
      const archive = await rawZip([{ name: "template.json", bytes: json(manifest([entry()])) }, ...entries]);
      await expect(preview(as, scope, archive)).rejects.toMatchObject({ code: "tooManyTemplateFiles" });
    });

    it("refuses a path that leaves the archive", async () => {
      const { as, scope } = await setup();
      const archive = await rawZip([
        { name: "template.json", bytes: json(manifest([entry()])) },
        { name: "xx/evil.png", bytes: png() },
      ]);
      await expect(preview(as, scope, renamed(archive, "xx/evil.png", "../evil.png"))).rejects.toMatchObject({
        code: "unsafeTemplateArchive",
      });
    });

    it("refuses an absolute path", async () => {
      const { as, scope } = await setup();
      const archive = await rawZip([
        { name: "template.json", bytes: json(manifest([entry()])) },
        { name: "x/evil.png", bytes: Buffer.from("root") },
      ]);
      await expect(preview(as, scope, renamed(archive, "x/evil.png", "/xevil.png"))).rejects.toMatchObject({
        code: "unsafeTemplateArchive",
      });
    });

    it("refuses a link inside the archive", async () => {
      const { as, scope } = await setup();
      const hash = sha256(Buffer.from("/etc/passwd"));
      const archive = await rawZip([
        { name: "template.json", bytes: json(manifest([entry()])) },
        { name: `files/${hash}.png`, bytes: Buffer.from("/etc/passwd"), mode: 0o120777 },
      ]);
      await expect(preview(as, scope, archive)).rejects.toMatchObject({ code: "unsafeTemplateArchive" });
    });

    it("refuses an archive inside the archive", async () => {
      const { as, scope } = await setup();
      const inner = await rawZip([{ name: "template.json", bytes: json(manifest([entry()])) }]);
      const archive = await rawZip([
        { name: "template.json", bytes: json(manifest([entry()])) },
        { name: `files/${sha256(inner)}.png`, bytes: inner },
      ]);
      await expect(preview(as, scope, archive)).rejects.toMatchObject({ code: "nestedTemplateArchive" });
      const named = await rawZip([
        { name: "template.json", bytes: json(manifest([entry()])) },
        { name: "files/more.zip", bytes: Buffer.from("x") },
      ]);
      await expect(preview(as, scope, named)).rejects.toMatchObject({ code: "nestedTemplateArchive" });
    });

    it("refuses a file compressed far more than images are", async () => {
      const { as, scope } = await setup();
      const zeros = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
      const archive = await rawZip([
        { name: "template.json", bytes: json(manifest([entry()])) },
        { name: `files/${sha256(zeros)}.png`, bytes: zeros },
      ]);
      await expect(preview(as, scope, archive)).rejects.toMatchObject({ code: "templateArchiveCompression" });
    });

    it("refuses other files than template.json and files/<hash>.<extension>", async () => {
      const { as, scope } = await setup();
      const archive = await rawZip([
        { name: "template.json", bytes: json(manifest([entry()])) },
        { name: "readme.txt", bytes: Buffer.from("hello") },
      ]);
      await expect(preview(as, scope, archive)).rejects.toMatchObject({ code: "unexpectedTemplateEntry" });
    });

    it("names the template and the place of an unknown key", async () => {
      const { as, scope } = await setup();
      const imported = await only(as, scope, json(manifest([entry({ owner: "Erika" })])));
      expect(imported.valid).toBe(false);
      expect(imported.problems[0]?.message).toBe("Template 'Retro': unknown key owner");
      const field = await only(
        as,
        scope,
        json(
          manifest([
            entry({ fields: [{ key: "date", label: "Date", type: "date", required: false, color: 1 }] }),
          ]),
        ),
      );
      expect(field.problems[0]?.message).toBe("Template 'Retro', field 1: unknown key color");
    });

    it("refuses unknown keys at the top of template.json", async () => {
      const { as, scope } = await setup();
      await expect(preview(as, scope, json(manifest([entry()], { instance: "x" })))).rejects.toMatchObject({
        code: "invalidTemplateFile",
      });
    });

    it("refuses unknown nodes, marks and attributes", async () => {
      const { as, scope } = await setup();
      for (const content of [
        { type: "script", attrs: {} },
        paragraph(text("x", [{ type: "blink" }])),
        { type: "paragraph", attrs: { onclick: "alert(1)" } },
      ]) {
        const imported = await only(as, scope, json(manifest([entry({ document: doc(content) })])));
        expect(imported.valid).toBe(false);
        expect(imported.problems[0]?.message).toMatch(/^Template 'Retro', content at /);
      }
    });

    it("refuses javascript: links like the editor", async () => {
      const { as, scope } = await setup();
      const imported = await only(
        as,
        scope,
        json(
          manifest([
            entry({
              document: doc(paragraph(text("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))),
            }),
          ]),
        ),
      );
      expect(imported.valid).toBe(false);
    });

    it("refuses newer format and schema versions with a message that names them", async () => {
      const { as, scope } = await setup();
      await expect(preview(as, scope, json(manifest([entry()], { formatVersion: 2 })))).rejects.toMatchObject(
        {
          code: "newerTemplateFormat",
          message: expect.stringContaining("version 2; this Pagehall reads version 1"),
        },
      );
      await expect(
        preview(as, scope, json(manifest([entry()], { schemaVersion: editorSchemaVersion + 1 }))),
      ).rejects.toMatchObject({
        code: "newerTemplateFormat",
        message: expect.stringContaining(`version ${editorSchemaVersion + 1}`),
      });
    });

    it("migrates documents of an older schema version", async () => {
      const { as, scope } = await setup();
      const old = doc({
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: true }, content: [paragraph(text("Old task"))] }],
      });
      const imported = await only(
        as,
        scope,
        json(manifest([entry({ document: old })], { schemaVersion: 1 })),
      );
      expect(imported.valid).toBe(true);
      expect(imported.document?.content?.[0]?.content?.[0]?.attrs).not.toHaveProperty("checked");
    });

    it("cleans SVG images of scripts", async () => {
      const { as, scope } = await setup();
      const svg = {
        bytes: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" onload="alert(1)"><script>alert(2)</script><rect width="4" height="4"/></svg>',
        ),
        mediaType: "image/svg+xml",
        extension: "svg",
      };
      const reference = fileReference(sha256(svg.bytes));
      const archive = await zip(
        manifest([entry({ files: [fileEntry(svg)], document: doc(image(reference)) })]),
        [svg],
      );
      const result = await preview(as, scope, archive);
      const file = result.templates[0]?.files[0];
      const content = await test.services.templateTransfers.fileContent(as, scope, result.id, file?.id ?? "");
      const stored = (
        await test.services.files.readAll(content?.fileId ?? "", 1024 * 1024, { staged: true })
      ).toString("utf8");
      expect(stored).toContain("<rect");
      expect(stored).not.toMatch(/script|onload/);
    });

    it("refuses a file whose content does not match its extension or hash", async () => {
      const { as, scope } = await setup();
      const fake = { bytes: Buffer.from("GIF89a-not-a-png"), mediaType: "image/png", extension: "png" };
      const reference = fileReference(sha256(fake.bytes));
      const wrongType = await only(
        as,
        scope,
        await zip(manifest([entry({ files: [fileEntry(fake)], document: doc(image(reference)) })]), [fake]),
      );
      expect(wrongType.valid).toBe(false);
      expect(wrongType.problems[0]?.message).toContain(
        "is declared as image/png but its content is image/gif",
      );
      const real = { bytes: png(), mediaType: "image/png", extension: "png" };
      const declared = fileEntry(real);
      const tampered = await rawZip([
        {
          name: "template.json",
          bytes: json(
            manifest([entry({ files: [declared], document: doc(image(fileReference(declared.sha256))) })]),
          ),
        },
        { name: declared.path, bytes: Buffer.concat([PNG, randomBytes(64)]) },
      ]);
      const wrongHash = await only(as, scope, tampered);
      expect(wrongHash.problems[0]?.message).toContain("does not match its SHA-256 hash");
    });

    it("clears IDs that point to pages, accounts and attachments of this instance", async () => {
      const { org, as, scope, space: wiki } = await setup();
      const page = await test.services.tree.create(as, wiki.id, {
        kind: "page",
        title: "Existing",
        mode: "live",
        placement: { parentId: null },
      });
      const attachment = await test.services.attachments.upload(as, page.id, {
        name: "existing.png",
        body: Readable.from([png()]),
      });
      const document = doc(
        paragraph(
          { type: "pageLink", attrs: { pageId: page.id, spaceId: wiki.id, title: null } },
          { type: "mention", attrs: { id: org.owner } },
        ),
        image(attachment.id),
        { type: "includePage", attrs: { pageId: page.id } },
        { type: "childPages", attrs: { pageId: page.id } },
      );
      const imported = await only(as, scope, json(manifest([entry({ document })])));
      expect(imported.valid).toBe(true);
      const serialized = JSON.stringify(imported.document);
      for (const id of [page.id, wiki.id, org.owner, attachment.id]) expect(serialized).not.toContain(id);
      expect(imported.removed).toMatchObject({ pageLink: 1, mention: 1, include: 1, report: 1, file: 1 });
    });

    it("lists embeds this instance does not allow and keeps them", async () => {
      const { as, scope } = await setup();
      const imported = await only(
        as,
        scope,
        json(
          manifest([
            entry({ document: doc({ type: "embed", attrs: { url: "https://unknown.example.com/x" } }) }),
          ]),
        ),
      );
      expect(imported.valid).toBe(true);
      expect(imported.blockedEmbeds).toEqual(["https://unknown.example.com/x"]);
    });

    it("refuses the import when storage is almost full", async () => {
      const { as, scope } = await setup();
      vi.spyOn(test.services.files.store, "capacity").mockResolvedValue({ free: 1, total: 1000 });
      await expect(preview(as, scope, json(manifest([entry()])))).rejects.toMatchObject({
        refusal: "upload",
      });
      vi.restoreAllMocks();
    });

    it("imports the valid templates of a file only when asked to", async () => {
      const { as, scope } = await setup();
      const result = await preview(
        as,
        scope,
        json(manifest([entry({ name: "Good" }), entry({ name: "Bad", category: "unknown" })])),
      );
      expect(result.templates.map((template) => template.valid)).toEqual([true, false]);
      expect(result.templates[1]?.problems[0]?.message).toMatch(/^Template 'Bad', category: /);
      await expect(
        test.services.templateTransfers.confirm(as, scope, result.id, { decisions: [], skipInvalid: false }),
      ).rejects.toMatchObject({ code: "invalidTemplatesInFile" });
      const done = await test.services.templateTransfers.confirm(as, scope, result.id, {
        decisions: [],
        skipInvalid: true,
      });
      expect(done.created.map((template) => template.name)).toEqual(["Good"]);
      expect(done.skipped).toBe(1);
    });
  });

  describe("name conflicts", () => {
    it("replaces an existing template and keeps its ID", async () => {
      const { as, scope } = await setup();
      const existing = await test.services.templates.create(as, scope, {
        name: "Retro",
        description: "Old",
        category: "meetings",
        title: "Old",
        fields: [],
        document: doc(paragraph(text("Old"))),
      });
      const result = await preview(as, scope, json(manifest([entry()])));
      expect(result.templates[0]?.conflict).toEqual({
        templateId: existing.id,
        suggestedName: "Retro (imported)",
      });
      const done = await test.services.templateTransfers.confirm(as, scope, result.id, {
        decisions: [{ index: 0, action: "replace" }],
        skipInvalid: false,
      });
      expect(done.replaced[0]?.id).toBe(existing.id);
      expect(done.replaced[0]?.description).toBe("Team retrospective");
      expect(await test.services.templates.list(scope)).toHaveLength(1);
      const audit = await test.database.execute<{ fields: Record<string, unknown> }>(sql`
        select fields from audit_events where name = 'template.imported' and actor_id = ${as.type === "account" ? as.id : ""}`);
      expect(audit.rows.at(-1)?.fields).toMatchObject({ level: "space", created: [], replaced: ["Retro"] });
    });

    it("suggests a new name in the person's language and takes an edited one", async () => {
      const { as, scope } = await setup();
      await test.services.templates.create(as, scope, {
        name: "Retro",
        description: "",
        category: "meetings",
        title: "Old",
        fields: [],
        document: doc(paragraph(text("Old"))),
      });
      const result = await preview(as, scope, json(manifest([entry()])));
      await expect(
        test.services.templateTransfers.confirm(as, scope, result.id, {
          decisions: [{ index: 0, action: "create" }],
          skipInvalid: false,
        }),
      ).rejects.toMatchObject({ code: "templateNameTaken" });
      const done = await test.services.templateTransfers.confirm(as, scope, result.id, {
        decisions: [{ index: 0, action: "create", name: "Retro for team B" }],
        skipInvalid: false,
      });
      expect(done.created[0]?.name).toBe("Retro for team B");
      expect((await test.services.templates.list(scope)).map((template) => template.name).sort()).toEqual([
        "Retro",
        "Retro for team B",
      ]);
    });
  });
});
