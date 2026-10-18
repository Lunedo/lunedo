import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import type { DocumentJson } from "@pagehall/editor-schema";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { createLogger } from "../logging/logger.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { drawingSceneOf, pageWithDrawing } from "../whiteboards/scene.testing.js";

const baseUrl = testDatabaseBaseUrl();

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function png(): Buffer {
  return Buffer.concat([PNG, randomBytes(64)]);
}

function image(attachmentId: string | null, alt = "") {
  return { type: "image", attrs: { attachmentId, alt, width: null, align: "center" } };
}

function doc(...content: unknown[]): DocumentJson {
  return { type: "doc", content } as DocumentJson;
}

function imageIds(document: DocumentJson | undefined): (string | null)[] {
  return (document?.content ?? [])
    .filter((node) => node.type === "image")
    .map((node) => (node.attrs?.attachmentId as string | null) ?? null);
}

describe.skipIf(!baseUrl)("template files", () => {
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
    const adminId = org.owner;
    const created = await space(org.id, adminId);
    return { org, as: accountPrincipal(adminId), adminId, space: created };
  }

  function upload(actor: Principal, itemId: string, name: string, bytes: Buffer) {
    return test.services.attachments.upload(actor, itemId, {
      name,
      body: Readable.from([bytes]),
      contentLength: bytes.length,
    });
  }

  async function pageWithImage(actor: Principal, spaceId: string, mode: "live" | "publish" = "live") {
    const page = await test.services.tree.create(actor, spaceId, {
      kind: "page",
      title: `Runbook ${uuidv7().slice(-6)}`,
      mode,
      placement: { parentId: null },
    });
    const bytes = png();
    const attachment = await upload(actor, page.id, "network.png", bytes);
    await test.services.documents.replace(actor, page.id, doc(image(attachment.id, "Network")));
    return { page, attachment, bytes };
  }

  async function templateFiles(templateId: string) {
    const result = await test.database.execute<{ id: string; file_id: string; name: string }>(
      sql`select id, file_id, name from template_files where template_id = ${templateId} order by name`,
    );
    return result.rows;
  }

  async function read(fileId: string): Promise<Buffer> {
    return test.services.files.readAll(fileId, 10 * 1024 * 1024);
  }

  it("copies the images of a page into the template when it is saved as a template", async () => {
    const { as, space: wiki } = await setup();
    const { page, attachment, bytes } = await pageWithImage(as, wiki.id);
    const template = await test.services.templates.saveFromPage(as, wiki.id, page.id, {
      name: "Runbook",
      description: "",
      category: "operations",
    });
    const files = await templateFiles(template.id);
    expect(files).toHaveLength(1);
    expect(imageIds(template.document)).toEqual([files[0]?.id]);
    expect(files[0]?.id).not.toBe(attachment.id);
    const content = await test.services.templates.files.content(template.id, files[0]?.id ?? "");
    expect(await read(content?.fileId ?? "")).toEqual(bytes);

    await test.services.attachments.delete(as, attachment.id);
    await test.services.trash.deleteImmediately(
      as,
      (await test.services.trash.deleteItem(as, page.id)).id,
      "Test",
    );
    await test.services.files.deleteOrphaned();
    const purged = await test.database.execute(sql`select 1 from attachments where id = ${attachment.id}`);
    expect(purged.rows).toEqual([]);
    expect(await read(content?.fileId ?? "")).toEqual(bytes);
  });

  it("tells when the page is restricted so the dialog can warn that its images are shared", async () => {
    const { as, space: wiki } = await setup();
    const { page } = await pageWithImage(as, wiki.id);
    expect(await test.services.templates.pageFiles(wiki.id, page.id)).toEqual({
      files: 1,
      restricted: false,
    });
    await test.services.pageAccess.change(as, page.id, [{ action: "restrict", kind: "view" }]);
    expect(await test.services.templates.pageFiles(wiki.id, page.id)).toEqual({ files: 1, restricted: true });
  });

  it("saves a restricted page as a template only when confirmed, and audits it", async () => {
    const { as, space: wiki } = await setup();
    const parent = await test.services.tree.create(as, wiki.id, {
      kind: "page",
      title: "HR",
      mode: "live",
      placement: { parentId: null },
    });
    const page = await test.services.tree.create(as, wiki.id, {
      kind: "page",
      title: "Salary bands",
      mode: "live",
      placement: { parentId: parent.id },
    });
    await test.services.pageAccess.change(as, parent.id, [{ action: "restrict", kind: "view" }]);
    const count = async () =>
      (
        await test.database.execute(
          sql`select 1 from page_templates where space_id = ${wiki.id} and name = 'Salary bands'`,
        )
      ).rows.length;
    await expect(
      test.services.templates.saveFromPage(as, wiki.id, page.id, {
        name: "Salary bands",
        description: "",
        category: "teams",
      }),
    ).rejects.toMatchObject({ code: "templateFromRestrictedPage" });
    await expect(
      test.services.templates.saveFromPage(as, wiki.id, page.id, {
        name: "Salary bands",
        description: "",
        category: "teams",
        confirmRestricted: false,
      }),
    ).rejects.toMatchObject({ code: "templateFromRestrictedPage" });
    expect(await count()).toBe(0);

    const template = await test.services.templates.saveFromPage(as, wiki.id, page.id, {
      name: "Salary bands",
      description: "",
      category: "teams",
      confirmRestricted: true,
    });
    expect(await count()).toBe(1);
    const audited = await test.database.execute<{ fields: Record<string, unknown> }>(sql`
      select fields from audit_events
      where name = 'template.createdFromRestrictedPage' and target_id = ${page.id}`);
    expect(audited.rows).toHaveLength(1);
    expect(audited.rows[0]?.fields).toMatchObject({
      spaceId: wiki.id,
      title: "Salary bands",
      templateId: template.id,
      templateName: "Salary bands",
    });
  });

  it("does not audit saving an unrestricted page as a template", async () => {
    const { as, space: wiki } = await setup();
    const page = await test.services.tree.create(as, wiki.id, {
      kind: "page",
      title: "Open runbook",
      mode: "live",
      placement: { parentId: null },
    });
    await test.services.templates.saveFromPage(as, wiki.id, page.id, {
      name: "Open runbook",
      description: "",
      category: "operations",
    });
    const audited = await test.database.execute(sql`
      select 1 from audit_events where name = 'template.createdFromRestrictedPage' and target_id = ${page.id}`);
    expect(audited.rows).toEqual([]);
  });

  it("does not take files from other pages into a template saved from a page", async () => {
    const { as, space: wiki } = await setup();
    const { attachment: foreign } = await pageWithImage(as, wiki.id);
    const page = await test.services.tree.create(as, wiki.id, {
      kind: "page",
      title: "Borrowing",
      mode: "live",
      placement: { parentId: null },
    });
    await test.services.documents.replace(as, page.id, doc(image(foreign.id)));
    const template = await test.services.templates.saveFromPage(as, wiki.id, page.id, {
      name: "Borrowing",
      description: "",
      category: "knowledge",
    });
    expect(await templateFiles(template.id)).toEqual([]);
    expect(imageIds(template.document)).toEqual([null]);
  });

  it("gives a page created from a template its own copies of the template's files", async () => {
    const { as, space: wiki } = await setup();
    const { page, bytes } = await pageWithImage(as, wiki.id);
    const template = await test.services.templates.saveFromPage(as, wiki.id, page.id, {
      name: "Runbook copy",
      description: "",
      category: "operations",
    });
    const [file] = await templateFiles(template.id);
    for (const mode of ["live", "publish"] as const) {
      const created = await test.services.templates.instantiate(as, wiki.id, {
        templateId: template.id,
        values: {},
        placement: { parentId: null },
        mode,
      });
      const attachments = await test.services.attachments.list(as, created.id, "draft");
      expect(attachments).toHaveLength(1);
      expect(attachments[0]?.name).toBe("network.png");
      const document = (await test.services.documents.snapshot(created.id))?.document;
      expect(imageIds(document)).toEqual([attachments[0]?.id]);
      expect(attachments[0]?.id).not.toBe(file?.id);
      const content = await test.services.attachments.content(attachments[0]?.id ?? "", "draft");
      expect(await read(content?.fileId ?? "")).toEqual(bytes);
      const published = await test.services.attachments.content(attachments[0]?.id ?? "", "published");
      expect(published !== null).toBe(mode === "live");
    }
  });

  it("takes the images inside a drawing into the template and into pages made from it", async () => {
    const { org, as, space: wiki } = await setup();
    const source = await test.services.tree.create(as, wiki.id, {
      kind: "page",
      title: "Floor plan",
      mode: "live",
      placement: { parentId: null },
    });
    const image = await upload(as, source.id, "router.png", png());
    const blockId = "01929b1e-0000-7000-8000-00000000d0b1";
    await pageWithDrawing(test, as, source.id, blockId, image.id);
    const template = await test.services.templates.saveFromPage(as, wiki.id, source.id, {
      name: "Floor plan template",
      description: "",
      category: "operations",
    });
    const files = await templateFiles(template.id);
    const router = files.find((file) => file.name === "router.png");
    const sceneFile = await test.database.execute<{ file_id: string }>(sql`
      select tf.file_id from template_files tf where tf.template_id = ${template.id}
        and tf.id = ${String((template.document.content?.[0]?.attrs ?? {}).sceneId)}`);
    const templateScene = JSON.parse(
      (await test.services.files.readAll(sceneFile.rows[0]?.file_id ?? "", 1024 * 1024)).toString("utf8"),
    ) as { files: Record<string, { attachmentId: string }> };
    expect(Object.values(templateScene.files).map((file) => file.attachmentId)).toEqual([router?.id]);

    await test.services.templates.update(as, template.id, { ...template, document: template.document });
    expect((await templateFiles(template.id)).map((file) => file.name).sort()).toEqual(
      files.map((file) => file.name).sort(),
    );
    const created = await test.services.templates.instantiate(as, wiki.id, {
      templateId: template.id,
      values: {},
      placement: { parentId: null },
      mode: "live",
    });
    const copied = await drawingSceneOf(test, created.id);
    const own = (await test.services.attachments.list(as, created.id, "draft")).map((file) => file.id);
    expect(copied.images).toHaveLength(1);
    expect(own).toContain(copied.images[0]);
    expect(copied.images).not.toContain(image.id);
    const reader = await member(org.id);
    await test.services.spacePermissions.apply(as, wiki.id, {
      action: "grant",
      principalKind: "account",
      principalId: reader,
      role: "reader",
    });
    await test.services.pageAccess.change(as, source.id, [{ action: "restrict", kind: "view" }]);
    const sees = async (id: string) =>
      (
        await test.services.authorization.explain(accountPrincipal(reader), "attachment.view", {
          type: "attachment",
          id,
        })
      ).allowed;
    expect(await sees(copied.images[0] ?? "")).toBe(true);
    expect(await sees(image.id)).toBe(false);
    await expect(
      test.services.drawings.saveScene(as, created.id, {
        blockId,
        body: Readable.from([Buffer.from(copied.text)]),
      }),
    ).resolves.toMatchObject({ sceneVersion: 2 });
  });

  it("lets the template editor add images, keeps only the template's own files and removes unused ones", async () => {
    const { as, space: wiki } = await setup();
    const { attachment: pageImage } = await pageWithImage(as, wiki.id);
    const template = await test.services.templates.create(
      as,
      { level: "space", spaceId: wiki.id },
      {
        name: "Poster",
        description: "",
        category: "teams",
        title: "Poster",
        fields: [],
        document: doc(image(pageImage.id)),
      },
    );
    expect(imageIds(template.document)).toEqual([null]);
    const first = await test.services.templates.files.upload(as, template.id, {
      name: "first.png",
      body: Readable.from([png()]),
    });
    const second = await test.services.templates.files.upload(as, template.id, {
      name: "second.png",
      body: Readable.from([png()]),
    });
    expect(first.contentType).toBe("image/png");
    const updated = await test.services.templates.update(as, template.id, {
      name: "Poster",
      description: "",
      category: "teams",
      title: "Poster",
      fields: [],
      document: doc(image(first.id), image(pageImage.id)),
    });
    expect(imageIds(updated.document)).toEqual([first.id, null]);
    expect((await templateFiles(template.id)).map((file) => file.id)).toEqual([first.id]);
    expect(await test.services.templates.files.content(template.id, second.id)).toBeNull();
  });

  it("accepts only images in the template editor and cleans SVG images", async () => {
    const { as, space: wiki } = await setup();
    const template = await test.services.templates.create(
      as,
      { level: "space", spaceId: wiki.id },
      {
        name: "Svg",
        description: "",
        category: "teams",
        title: "Svg",
        fields: [],
        document: doc({ type: "paragraph" }),
      },
    );
    await expect(
      test.services.templates.files.upload(as, template.id, {
        name: "notes.txt",
        body: Readable.from([Buffer.from("plain text")]),
      }),
    ).rejects.toMatchObject({ code: "unsupportedTemplateFile" });
    const svg = await test.services.templates.files.upload(as, template.id, {
      name: "logo.svg",
      body: Readable.from([
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>',
        ),
      ]),
    });
    const content = await test.services.templates.files.content(template.id, svg.id);
    const stored = (await read(content?.fileId ?? "")).toString("utf8");
    expect(stored).toContain("<rect");
    expect(stored).not.toContain("script");
  });

  it("deletes the files of a deleted template", async () => {
    const { as, space: wiki } = await setup();
    const template = await test.services.templates.create(
      as,
      { level: "space", spaceId: wiki.id },
      {
        name: "Gone",
        description: "",
        category: "teams",
        title: "Gone",
        fields: [],
        document: doc({ type: "paragraph" }),
      },
    );
    const file = await test.services.templates.files.upload(as, template.id, {
      name: "gone.png",
      body: Readable.from([png()]),
    });
    const content = await test.services.templates.files.content(template.id, file.id);
    await test.services.templates.delete(as, template.id);
    expect(await templateFiles(template.id)).toEqual([]);
    await test.services.files.deleteOrphaned();
    const left = await test.database.execute(
      sql`select 1 from stored_files where id = ${content?.fileId ?? ""}`,
    );
    expect(left.rows).toEqual([]);
  });

  it("takes over the files existing templates show, and empties images whose file is gone or hidden", async () => {
    const { org, as, adminId, space: wiki } = await setup();
    const { attachment, bytes } = await pageWithImage(as, wiki.id);
    const { page: hiddenPage, attachment: hidden } = await pageWithImage(as, wiki.id);
    const otherSpace = await space(org.id, adminId);
    const { attachment: elsewhere } = await pageWithImage(as, otherSpace.id);
    const restricted = await member(org.id);
    await test.services.spacePermissions.apply(as, wiki.id, {
      action: "grant",
      principalKind: "account",
      principalId: restricted,
      role: "reader",
    });
    await test.services.pageAccess.change(as, hiddenPage.id, [{ action: "restrict", kind: "view" }]);
    const templateId = uuidv7();
    const missing = uuidv7();
    await test.database.execute(sql`
      insert into page_templates (id, level, space_id, name, category, title, document, schema_version, fields,
        files_adopted, created_by)
      values (${templateId}, 'space', ${wiki.id}, 'Old template', 'teams', 'Old', ${JSON.stringify(
        doc(image(attachment.id), image(missing), image(hidden.id), image(elsewhere.id)),
      )}::jsonb, 10, '[]'::jsonb, false, ${restricted})`);
    const info = vi.fn();
    const logger = { ...createLogger({ service: "test", level: "silent" }), info } as never;
    expect(await test.services.templates.hasPendingFiles()).toBe(true);
    await test.services.templates.adoptPendingFiles(logger);
    expect(await test.services.templates.hasPendingFiles()).toBe(false);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ templates: 1, files: 1, emptied: 3 }),
      expect.any(String),
    );
    const template = await test.services.templates.get(templateId);
    const files = await templateFiles(templateId);
    expect(imageIds(template?.document)).toEqual([files[0]?.id, null, null, null]);
    const content = await test.services.templates.files.content(templateId, files[0]?.id ?? "");
    expect(await read(content?.fileId ?? "")).toEqual(bytes);
  });

  it("takes over files only when everyone who wrote the template can open them, and no restricted pages above a space", async () => {
    const { org, as, adminId, space: wiki } = await setup();
    const open = await space(org.id, adminId, { visibility: "organization" });
    const { attachment } = await pageWithImage(as, wiki.id);
    const { attachment: openImage } = await pageWithImage(as, open.id);
    const { page: restrictedPage, attachment: restrictedImage } = await pageWithImage(as, open.id);
    await test.services.pageAccess.change(as, restrictedPage.id, [{ action: "restrict", kind: "view" }]);
    const outsider = await member(org.id);
    const insert = async (level: "space" | "organization", updatedBy: string, ...ids: string[]) => {
      const id = uuidv7();
      await test.database.execute(sql`
        insert into page_templates (id, level, space_id, organization_id, name, category, title, document,
          schema_version, fields, files_adopted, created_by, updated_by)
        values (${id}, ${level}, ${level === "space" ? wiki.id : null}, ${level === "organization" ? org.id : null},
          ${`Old ${id.slice(-6)}`}, 'teams', 'Old', ${JSON.stringify(doc(...ids.map((value) => image(value))))}::jsonb,
          10, '[]'::jsonb, false, ${adminId}, ${updatedBy})`);
      return id;
    };
    const changedByOutsider = await insert("space", outsider, attachment.id);
    const organizationLevel = await insert("organization", adminId, openImage.id, restrictedImage.id);
    await test.services.templates.adoptPendingFiles(createLogger({ service: "test", level: "silent" }));
    expect(imageIds((await test.services.templates.get(changedByOutsider))?.document)).toEqual([null]);
    const files = await templateFiles(organizationLevel);
    expect(imageIds((await test.services.templates.get(organizationLevel))?.document)).toEqual([
      files[0]?.id,
      null,
    ]);
  });

  it("takes over files for organization and instance templates only from pages every user of the template can read", async () => {
    const { org, as, adminId } = await setup();
    const open = await space(org.id, adminId, { visibility: "organization" });
    const closed = await space(org.id, adminId);
    const council = await test.services.spaces.create(
      as,
      org.id,
      {
        name: "Works council",
        key: `C${uuidv7().slice(-6).toUpperCase()}`,
        confidential: true,
        visibility: "private",
        grants: [],
      },
      test.services.spacePermissions.holders,
    );
    const foreignOrg = await organization();
    const foreignAdmin = accountPrincipal(foreignOrg.owner);
    const foreign = await space(foreignOrg.id, foreignOrg.owner, { visibility: "instance" });
    const { attachment: shared } = await pageWithImage(as, open.id);
    const { attachment: privateImage } = await pageWithImage(as, closed.id);
    const { attachment: councilImage } = await pageWithImage(as, council.id);
    const { attachment: foreignImage } = await pageWithImage(foreignAdmin, foreign.id);
    const insert = async (level: "organization" | "instance", ...ids: string[]) => {
      const id = uuidv7();
      await test.database.execute(sql`
        insert into page_templates (id, level, organization_id, name, category, title, document, schema_version,
          fields, files_adopted, created_by)
        values (${id}, ${level}, ${level === "organization" ? org.id : null}, ${`Old ${id.slice(-6)}`}, 'teams',
          'Old', ${JSON.stringify(doc(...ids.map((value) => image(value))))}::jsonb, 10, '[]'::jsonb, false,
          ${adminId})`);
      return id;
    };
    const organizationLevel = await insert("organization", shared.id, privateImage.id, councilImage.id);
    const instanceLevel = await insert("instance", shared.id, foreignImage.id);
    const info = vi.fn();
    const logger = { ...createLogger({ service: "test", level: "silent" }), info } as never;
    await test.services.templates.adoptPendingFiles(logger);
    const files = await templateFiles(organizationLevel);
    expect(files).toHaveLength(1);
    expect(imageIds((await test.services.templates.get(organizationLevel))?.document)).toEqual([
      files[0]?.id,
      null,
      null,
    ]);
    expect(await templateFiles(instanceLevel)).toEqual([]);
    expect(imageIds((await test.services.templates.get(instanceLevel))?.document)).toEqual([null, null]);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ templates: 2, files: 1, emptied: 4 }),
      expect.any(String),
    );
    const audited = await test.database.execute<{ target_id: string; dropped: number }>(sql`
      select target_id, (fields ->> 'dropped')::int as dropped from audit_events
      where name = 'template.filesDropped' and target_id in (${organizationLevel}, ${instanceLevel})
      order by (fields ->> 'dropped')::int`);
    expect(audited.rows).toHaveLength(2);
    expect(audited.rows).toEqual(
      expect.arrayContaining([
        { target_id: organizationLevel, dropped: 2 },
        { target_id: instanceLevel, dropped: 2 },
      ]),
    );
  });

  it("refuses to add template files when the storage is almost full", async () => {
    const { as, space: wiki } = await setup();
    const { page } = await pageWithImage(as, wiki.id);
    const template = await test.services.templates.saveFromPage(as, wiki.id, page.id, {
      name: "Full",
      description: "",
      category: "teams",
    });
    vi.spyOn(test.services.files.store, "capacity").mockResolvedValue({ free: 1, total: 1000 });
    await expect(
      test.services.templates.files.upload(as, template.id, {
        name: "more.png",
        body: Readable.from([png()]),
      }),
    ).rejects.toMatchObject({ refusal: "upload" });
    await expect(
      test.services.templates.saveFromPage(as, wiki.id, page.id, {
        name: "Full 2",
        description: "",
        category: "teams",
      }),
    ).rejects.toMatchObject({ refusal: "upload" });
    await expect(
      test.services.templates.instantiate(as, wiki.id, {
        templateId: template.id,
        values: {},
        placement: { parentId: null },
      }),
    ).rejects.toMatchObject({ refusal: "upload" });
    vi.restoreAllMocks();
  });
});
