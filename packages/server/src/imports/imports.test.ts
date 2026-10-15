import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { NodeJson } from "@pagehall/editor-schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
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
import { createCsvExport, createXmlExport, type SyntheticExport } from "./testing/confluence-export.js";
import { ALICE, BOB, largeExport, PAGE, STRANGER_ACCOUNT, syntheticExport } from "./testing/fixture.js";
import { combinedDigest } from "./uploads.js";
import { ImportWorker } from "./worker.js";

const baseUrl = testDatabaseBaseUrl();
const logger = createLogger({ service: "test", level: "silent" });

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function nodes(node: NodeJson): NodeJson[] {
  return [node, ...(node.content ?? []).flatMap(nodes)];
}

describe.skipIf(!baseUrl)("Confluence imports", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);
  let organizationId: string;
  let admin: string;
  let reviewer: string;
  let outsider: string;
  let otherAdmin: string;

  beforeAll(async () => {
    test = await createTestServices(baseUrl as string);
    const organization = await fixtures.organization();
    organizationId = organization.id;
    admin = organization.owner;
    reviewer = await fixtures.member(organizationId);
    outsider = await fixtures.member(organizationId);
    otherAdmin = await fixtures.member(organizationId);
    const role = await test.database.execute<{ id: string }>(sql`
      insert into role_assignments (id, scope, organization_id, principal_kind, principal_id, built_in_role)
      values (gen_random_uuid(), 'organization', ${organizationId}, 'account', ${otherAdmin}, 'administrator')
      returning id`);
    expect(role.rows).toHaveLength(1);
  });

  afterAll(async () => {
    await test?.close();
  });

  const as = (id: string) => accountPrincipal(id);

  function worker(segmentMs?: number, readers = new ImportReaderRegistry()) {
    const services = test.services;
    return new ImportWorker({
      database: test.database,
      pool: test.pool,
      audit: services.audit,
      authorization: services.authorization,
      notifications: services.notifications,
      encryption: test.encryption,
      atlassian: new AtlassianDirectory(),
      uploads: services.importUploads,
      readers:
        readers ?? new ImportReaderRegistry().register(new ConfluenceXmlReader(), new ConfluenceCsvReader()),
      pipeline: new ImportPipeline({
        database: test.database,
        files: services.files,
        settings: test.settings,
        audit: services.audit,
        versions: services.versions,
        trash: services.trash,
      }),
      folder: services.imports.folder,
      jobs: undefined,
      logger,
      ...(segmentMs === undefined ? {} : { segmentMs }),
    });
  }

  const defaultReaders = () =>
    new ImportReaderRegistry().register(new ConfluenceXmlReader(), new ConfluenceCsvReader());

  async function drive(importId: string, runner = worker(undefined, defaultReaders())): Promise<number> {
    let runs = 0;
    for (; runs < 500; runs++) {
      const state = await test.database.execute<{ state: string }>(
        sql`select state from imports where id = ${importId}`,
      );
      if (!["analyzing", "running", "stopping", "discarding"].includes(state.rows[0]?.state ?? "")) break;
      await runner.work(testJobContext("imports.work", { importId }));
    }
    return runs;
  }

  async function upload(owner: string, archive: Buffer): Promise<string> {
    const services = test.services.importUploads;
    const created = await services.create(as(owner), organizationId, {
      name: "export.zip",
      size: archive.length,
    });
    const digests: string[] = [];
    for (let number = 1; number <= created.partCount; number += 1) {
      const part = archive.subarray((number - 1) * created.partSize, number * created.partSize);
      digests.push(sha256(part));
      await services.putPart(as(owner), created.id, number, {
        body: Readable.from([part]),
        sha256: sha256(part),
        contentLength: part.length,
      });
    }
    await services.complete(as(owner), created.id, { sha256: combinedDigest(digests) });
    return created.id;
  }

  async function prepared(
    model: SyntheticExport,
    options: { format?: "xml" | "csv"; key: string; reviewers?: string[]; archived?: boolean },
  ) {
    const imports = test.services.imports;
    const format = options.format ?? "xml";
    const created = await imports.create(as(admin), organizationId, {
      source: format === "xml" ? "confluence-xml" : "confluence-csv",
    });
    const uploadId = await upload(admin, format === "xml" ? createXmlExport(model) : createCsvExport(model));
    await imports.update(as(admin), created.id, { file: { kind: "upload", uploadId } });
    await drive(created.id);
    await imports.update(as(admin), created.id, {
      spaceName: `Imported ${options.key}`,
      spaceKey: options.key,
      archived: options.archived ?? false,
      sourceUrl: "https://example.atlassian.net/wiki",
    });
    if (options.reviewers) await imports.setReviewers(as(admin), created.id, options.reviewers);
    await imports.setPeopleSource(as(admin), created.id, { kind: "skip", confirmed: true });
    return created.id;
  }

  async function imported(model: SyntheticExport, options: Parameters<typeof prepared>[1]) {
    const id = await prepared(model, options);
    await test.services.imports.start(as(admin), id);
    await drive(id);
    return test.services.imports.get(as(admin), id);
  }

  async function itemFor(importId: string, sourceId: string): Promise<string> {
    const result = await test.database.execute<{ target_id: string }>(sql`
      select target_id from import_items where import_id = ${importId} and kind = 'page' and source_id = ${sourceId}`);
    return result.rows[0]?.target_id ?? "";
  }

  async function documentOf(itemId: string): Promise<NodeJson> {
    const result = await test.database.execute<{ snapshot: NodeJson }>(
      sql`select snapshot from page_documents where item_id = ${itemId}`,
    );
    return result.rows[0]?.snapshot as NodeJson;
  }

  async function allowed(account: string, action: string, resource: { type: string; id: string }) {
    return (await test.services.authorization.explain(as(account), action, resource)).allowed;
  }

  it("reads the export first and suggests the space from it", async () => {
    const imports = test.services.imports;
    const created = await imports.create(as(admin), organizationId, { source: "confluence-xml" });
    const uploadId = await upload(admin, createXmlExport(syntheticExport()));
    const analyzing = await imports.update(as(admin), created.id, { file: { kind: "upload", uploadId } });
    expect(analyzing.state).toBe("analyzing");
    await drive(created.id);
    const ready = await imports.get(as(admin), created.id);
    expect(ready.state).toBe("ready");
    expect(ready.found).toMatchObject({
      pages: 8,
      attachments: 3,
      people: 3,
      macroKinds: 8,
      spaceKey: "SYN",
    });
    expect(ready.spaceName).toBe("Synthetic space");
    expect(ready.spaceKey).toBe("SYN");
  });

  it.each(["xml", "csv"] as const)(
    "counts the people at the check step the way the report counts them afterwards (%s)",
    async (format) => {
      const id = await prepared(syntheticExport(), { format, key: `CNT${format.toUpperCase()}` });
      const before = await test.services.imports.get(as(admin), id);
      expect(before.found?.people).toBe(3);
      await test.services.imports.start(as(admin), id);
      await drive(id);
      const after = await test.services.imports.get(as(admin), id);
      expect(after.counts.people).toBe(before.found?.people);
      expect((after.counts.people ?? 0) - (after.counts.peopleMatched ?? 0)).toBe(3);
    },
  );

  it("reports an export of the other format at the file step", async () => {
    const imports = test.services.imports;
    const created = await imports.create(as(admin), organizationId, { source: "confluence-xml" });
    const uploadId = await upload(admin, createCsvExport(syntheticExport()));
    await imports.update(as(admin), created.id, { file: { kind: "upload", uploadId } });
    await drive(created.id);
    const result = await imports.get(as(admin), created.id);
    expect(result).toMatchObject({ state: "draft", errorCode: "wrongFormat" });
  });

  it("imports the space, the page tree, content, attachments, labels and people into a quarantine space", async () => {
    const result = await imported(syntheticExport(), { key: "SYNA", reviewers: [reviewer] });
    expect(result.state).toBe("review");
    const spaceId = result.quarantineSpace?.id ?? "";
    const roots = await test.services.tree.children(as(admin), spaceId, null);
    expect(roots.items.map((item) => item.title)).toEqual(
      expect.arrayContaining(["Beta", "Alpha", "Aardvark", "Zeta", "Orphan"]),
    );
    const order = roots.items
      .map((item) => item.title)
      .filter((title) => ["Beta", "Alpha", "Aardvark", "Zeta"].includes(title));
    expect(order).toEqual(["Beta", "Alpha", "Aardvark", "Zeta"]);
    const alpha = await itemFor(result.id, PAGE.alpha);
    const child = await test.services.tree.children(as(admin), spaceId, alpha);
    expect(child.items.map((item) => item.title)).toEqual(["Child of alpha"]);
    const document = await documentOf(alpha);
    const all = nodes(document);
    const beta = await itemFor(result.id, PAGE.beta);
    expect(all.filter((node) => node.type === "pageLink").map((node) => node.attrs?.pageId)).toEqual([beta]);
    const images = all.filter((node) => node.type === "image");
    expect(images).toHaveLength(1);
    const versions = await test.database.execute<{ name: string; versions: number }>(sql`
      select a.name, count(v.id)::int as versions from attachments a join attachment_versions v on v.attachment_id = a.id
      where a.item_id = ${alpha} group by a.name order by a.name`);
    expect(versions.rows).toEqual([
      { name: "diagram.png", versions: 2 },
      { name: "report.pdf", versions: 1 },
    ]);
    const image = await test.database.execute<{ name: string }>(
      sql`select name from attachments where id = ${images[0]?.attrs?.attachmentId as string}`,
    );
    expect(image.rows[0]?.name).toBe("diagram.png");
    const labels = await test.database.execute<{ label: string }>(
      sql`select label from page_labels where item_id = ${alpha} order by label`,
    );
    expect(labels.rows.map((row) => row.label)).toEqual(["howto", "important"]);
    const placeholders = await test.database.execute<{ external_id: string; state: string }>(sql`
      select e.external_id, a.state from account_external_ids e join accounts a on a.id = e.account_id
      where e.organization_id = ${organizationId} and e.external_id in (${ALICE.accountId}, ${BOB.accountId}, ${STRANGER_ACCOUNT})
      order by e.external_id`);
    expect(placeholders.rows.map((row) => row.state)).toEqual(["placeholder", "placeholder", "placeholder"]);
    const mentions = all.filter((node) => node.type === "mention").map((node) => node.attrs?.id);
    expect(mentions).toHaveLength(3);
    expect(mentions[2]).toBe(mentions[0]);
    const tasks = await test.database.execute<{ done: boolean }>(
      sql`select done from tasks where item_id = ${alpha} and published order by position`,
    );
    expect(tasks.rows.map((row) => row.done)).toEqual([true, false]);
    const overview = await test.database.execute<{ overview_item_id: string }>(
      sql`select overview_item_id from spaces where id = ${spaceId}`,
    );
    const home = nodes(await documentOf(overview.rows[0]?.overview_item_id ?? ""));
    expect(home.some((node) => node.text === "Welcome home")).toBe(true);
    expect(await itemFor(result.id, PAGE.home)).toBe(overview.rows[0]?.overview_item_id);
    const report = await test.services.imports.report(as(admin), result.id);
    const codes = Object.fromEntries(report.categories.map((row) => [row.code, row.count]));
    expect(codes).toMatchObject({
      unsupportedMacro: 1,
      externalPageLink: 1,
      missingAttachment: 1,
      attachmentFileMissing: 1,
      invalidLink: 1,
    });
    const macros = await test.services.imports.macros(as(admin), result.id);
    expect(macros.map((macro) => macro.name)).toEqual(["roadmap"]);
    const converted = all.filter((node) =>
      [
        "status",
        "callout",
        "codeBlock",
        "tableOfContents",
        "childPages",
        "attachmentList",
        "file",
        "decision",
      ].includes(node.type),
    );
    expect(converted.map((node) => node.type).sort()).toEqual([
      "attachmentList",
      "callout",
      "childPages",
      "codeBlock",
      "codeBlock",
      "decision",
      "decision",
      "file",
      "status",
      "tableOfContents",
    ]);
    const decisions = await test.database.execute<{ text: string; published: boolean }>(
      sql`select text, published from decisions where item_id = ${alpha} order by published, text`,
    );
    expect(decisions.rows).toEqual([
      { text: "", published: false },
      { text: "Use the new VPN", published: true },
    ]);
    const external = await test.services.imports.entries(as(admin), result.id, {
      code: "externalPageLink",
      limit: 10,
    });
    expect(external.entries[0]).toMatchObject({
      item: { id: alpha, title: "Alpha" },
      details: { title: "Elsewhere" },
    });
  });

  it.each(["xml", "csv"] as const)(
    "gives imported items their author as owner and maps the page status from the %s export",
    async (format) => {
      const model = syntheticExport();
      const withStatus: SyntheticExport = {
        ...model,
        pages: model.pages.map((page) =>
          page.id === PAGE.alpha
            ? {
                ...page,
                pageStatus: '{"contentState":{"id":5,"name":"verified","color":"#57D9A3"},"version":3}',
              }
            : page.id === PAGE.beta
              ? { ...page, pageStatus: '{"name":"Needs legal review","color":"#FF5630"}' }
              : page.id === PAGE.zeta
                ? { ...page, pageStatus: "not json" }
                : page,
        ),
      };
      const result = await imported(withStatus, { key: format === "xml" ? "OWNX" : "OWNC", format });
      const spaceId = result.quarantineSpace?.id ?? "";
      const owners = await test.database.execute<{
        id: string;
        owner_id: string | null;
        state: string | null;
      }>(sql`
        select t.id, t.owner_id, a.state from tree_items t left join accounts a on a.id = t.owner_id
        where t.space_id = ${spaceId}`);
      expect(owners.rows.length).toBeGreaterThan(5);
      expect(owners.rows.filter((row) => row.owner_id === admin)).toEqual([]);
      expect(owners.rows.every((row) => row.state === "placeholder")).toBe(true);
      const alice = await test.database.execute<{ account_id: string }>(sql`
        select account_id from account_external_ids
        where organization_id = ${organizationId} and external_id = ${ALICE.accountId}`);
      const alpha = await itemFor(result.id, PAGE.alpha);
      expect(owners.rows.find((row) => row.id === alpha)?.owner_id).toBe(alice.rows[0]?.account_id);
      const home = await itemFor(result.id, PAGE.home);
      expect(owners.rows.find((row) => row.id === home)?.owner_id).toBe(alice.rows[0]?.account_id);

      const status = async (sourceId: string) =>
        (await test.services.tree.get(as(admin), await itemFor(result.id, sourceId)))?.status ?? null;
      expect(await status(PAGE.alpha)).toMatchObject({ builtIn: "verified", name: null, color: "success" });
      expect(await status(PAGE.beta)).toMatchObject({
        builtIn: null,
        name: "Needs legal review",
        color: "danger",
      });
      expect(await status(PAGE.zeta)).toBeNull();
      expect(await status(PAGE.aardvark)).toBeNull();
      const values = await test.services.pageStatus.values(SYSTEM, spaceId);
      expect(values.map((value) => value.builtIn ?? value.name)).toEqual([
        "roughDraft",
        "inProgress",
        "readyForReview",
        "verified",
        "Needs legal review",
      ]);
      const unowned = await test.services.ownership.spaceUnowned(as(admin), spaceId);
      expect(unowned.items).toEqual([]);
    },
  );

  it("imports the CSV export with the same result as the XML export", async () => {
    const xml = await imported(syntheticExport(), { key: "SYNX" });
    const csv = await imported(syntheticExport(), { key: "SYNC", format: "csv" });
    const shape = async (importId: string, spaceId: string) => {
      const items = await test.database.execute<{ title: string; parent: string | null }>(sql`
        select t.title, p.title as parent from tree_items t left join tree_items p on p.id = t.parent_id
        where t.space_id = ${spaceId} and t.title not like 'Imported %' order by t.title`);
      const documents = await test.database.execute<{ title: string; text: string }>(sql`
        select t.title, d.snapshot::text as text from tree_items t join page_documents d on d.item_id = t.id
        where t.space_id = ${spaceId} order by t.title`);
      const report = await test.services.imports.report(as(admin), importId);
      return {
        items: items.rows,
        documents: documents.rows.map((row) => ({
          title: row.title,
          text: row.text
            .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "ID")
            .replaceAll(/SYN[XC]/g, "KEY"),
        })),
        report: report.categories,
      };
    };
    const left = await shape(xml.id, xml.quarantineSpace?.id ?? "");
    const right = await shape(csv.id, csv.quarantineSpace?.id ?? "");
    expect(right.items).toEqual(left.items.map((item) => item));
    expect(right.documents.filter((doc) => !doc.title.startsWith("Imported"))).toEqual(
      left.documents.filter((doc) => !doc.title.startsWith("Imported")),
    );
    expect(right.report).toEqual(left.report);
  });

  it("shows the quarantine space only to the importer and the reviewers", async () => {
    const result = await imported(syntheticExport(), { key: "SYNQ", reviewers: [reviewer] });
    const spaceId = result.quarantineSpace?.id ?? "";
    const alpha = await itemFor(result.id, PAGE.alpha);
    for (const viewer of [outsider, otherAdmin]) {
      expect(await allowed(viewer, "space.view", { type: "space", id: spaceId })).toBe(false);
      expect(await allowed(viewer, "item.view", { type: "item", id: alpha })).toBe(false);
      expect(await allowed(viewer, "import.view", { type: "import", id: result.id })).toBe(false);
      const spaces = await test.services.spaces.list(as(viewer), { organizationId });
      expect(spaces.items.some((space) => space.id === spaceId)).toBe(false);
      const found = await test.services.tree.search(as(viewer), { query: "Alpha" });
      expect(found.some((item) => item.spaceId === spaceId)).toBe(false);
      const list = await test.services.imports.list(as(viewer), organizationId);
      expect(list.some((entry) => entry.id === result.id)).toBe(false);
      await expect(test.services.imports.get(as(viewer), result.id)).rejects.toThrow();
      await expect(test.services.imports.report(as(viewer), result.id)).rejects.toThrow();
    }
    const withoutAdministrator = await test.services.spaces.withoutAdministrator(organizationId);
    expect(withoutAdministrator.items.some((space) => space.id === spaceId)).toBe(false);
    for (const viewer of [admin, reviewer]) {
      expect(await allowed(viewer, "space.view", { type: "space", id: spaceId })).toBe(true);
      expect(await allowed(viewer, "item.view", { type: "item", id: alpha })).toBe(true);
      expect(await allowed(viewer, "item.edit", { type: "item", id: alpha })).toBe(false);
      expect(await allowed(viewer, "item.comment", { type: "item", id: alpha })).toBe(false);
      expect(await allowed(viewer, "item.share", { type: "item", id: alpha })).toBe(false);
      expect(await allowed(viewer, "space.manage", { type: "space", id: spaceId })).toBe(false);
    }
    expect(
      (await test.services.imports.list(as(reviewer), organizationId)).map((entry) => entry.id),
    ).toContain(result.id);
    await expect(test.services.imports.report(as(reviewer), result.id)).resolves.toBeDefined();
    await expect(
      test.services.imports.accept(as(reviewer), result.id, { visibility: "private", grants: [] }),
    ).rejects.toThrow();
    await expect(test.services.imports.discard(as(reviewer), result.id, "SYNQ")).rejects.toThrow();
    await expect(test.services.imports.setReviewers(as(reviewer), result.id, [])).rejects.toThrow();
    await expect(
      test.database.execute(sql`
        insert into space_permissions (id, space_id, principal_kind, principal_id, role)
        values (gen_random_uuid(), ${spaceId}, 'organizationMembers', null, 'reader')`),
    ).rejects.toThrow();
    await expect(
      test.database.execute(sql`update spaces set visibility = 'organization' where id = ${spaceId}`),
    ).rejects.toThrow();
  });

  it("gives removed reviewers no access and new reviewers access at once", async () => {
    const result = await imported(syntheticExport(), { key: "SYNR", reviewers: [reviewer] });
    const spaceId = result.quarantineSpace?.id ?? "";
    await test.services.imports.setReviewers(as(admin), result.id, [outsider]);
    expect(await allowed(reviewer, "space.view", { type: "space", id: spaceId })).toBe(false);
    expect(await allowed(outsider, "space.view", { type: "space", id: spaceId })).toBe(true);
    const audit = await test.database.execute<{ name: string }>(
      sql`select name from audit_events where target_id = ${result.id} and name = 'import.reviewersChanged'`,
    );
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it("turns the quarantine space into a regular space when accepted", async () => {
    const result = await imported(syntheticExport(), { key: "SYNOK", reviewers: [reviewer] });
    const spaceId = result.quarantineSpace?.id ?? "";
    await expect(
      test.services.imports.accept(as(admin), result.id, {
        visibility: "organization",
        grants: [
          { principalKind: "organizationMembers", principalId: null, role: "reader" },
          { principalKind: "account", principalId: reviewer, role: "admin" },
        ],
      }),
    ).resolves.toMatchObject({ state: "accepted" });
    const space = await test.database.execute<{ quarantined: boolean; archived: boolean }>(
      sql`select quarantined, archived_at is not null as archived from spaces where id = ${spaceId}`,
    );
    expect(space.rows[0]).toEqual({ quarantined: false, archived: false });
    expect(await allowed(outsider, "space.view", { type: "space", id: spaceId })).toBe(true);
    expect(await allowed(outsider, "space.edit", { type: "space", id: spaceId })).toBe(false);
    expect(await allowed(reviewer, "space.manage", { type: "space", id: spaceId })).toBe(true);
    expect(await allowed(admin, "space.manage", { type: "space", id: spaceId })).toBe(true);
    const staging = await test.database.execute<{ count: number }>(
      sql`select count(*)::int as count from import_records where import_id = ${result.id}`,
    );
    expect(staging.rows[0]?.count).toBe(0);
    const mapping = await test.database.execute<{ count: number }>(
      sql`select count(*)::int as count from import_items where import_id = ${result.id} and kind = 'page'`,
    );
    expect(mapping.rows[0]?.count).toBe(8);
    await expect(
      test.services.imports.accept(as(admin), result.id, { visibility: "private", grants: [] }),
    ).rejects.toMatchObject({ code: "importNotInReview" });
  });

  it("accepts an archived import as an archived space", async () => {
    const result = await imported(syntheticExport(), { key: "SYNAR", archived: true });
    await test.services.imports.accept(as(admin), result.id, { visibility: "organization", grants: [] });
    const space = await test.database.execute<{ archived: boolean }>(
      sql`select archived_at is not null as archived from spaces where id = ${result.quarantineSpace?.id ?? ""}`,
    );
    expect(space.rows[0]?.archived).toBe(true);
  });

  it("discards an import with everything in it after the key was typed", async () => {
    const result = await imported(syntheticExport(), { key: "SYND" });
    const spaceId = result.quarantineSpace?.id ?? "";
    await expect(test.services.imports.discard(as(admin), result.id, "WRONG")).rejects.toMatchObject({
      code: "confirmationMismatch",
    });
    await test.services.imports.discard(as(admin), result.id, "synd");
    await drive(result.id);
    const after = await test.services.imports.get(as(admin), result.id);
    expect(after.state).toBe("discarded");
    const left = await test.database.execute<{ items: number; spaces: number }>(sql`
      select (select count(*)::int from tree_items where space_id = ${spaceId}) as items,
        (select count(*)::int from spaces where id = ${spaceId}) as spaces`);
    expect(left.rows[0]).toEqual({ items: 0, spaces: 0 });
    const files = await test.database.execute<{ count: number }>(sql`
      select count(*)::int as count from stored_files f
      where f.state = 'ready' and not exists (select 1 from attachment_versions v where v.file_id = f.id)
        and not exists (select 1 from import_upload_parts p where p.file_id = f.id)`);
    expect(files.rows[0]?.count).toBe(0);
  });

  it("stops a running import and deletes what was imported so far", async () => {
    const id = await prepared(largeExport(60, 5), { key: "BIGS" });
    await test.services.imports.start(as(admin), id);
    const slow = worker(0, defaultReaders());
    for (let index = 0; index < 4; index += 1)
      await slow.work(testJobContext("imports.work", { importId: id }));
    const running = await test.services.imports.get(as(admin), id);
    expect(running.state).toBe("running");
    const spaceId = running.quarantineSpace?.id ?? "";
    await test.services.imports.stop(as(admin), id, "BIGS");
    await drive(id);
    expect((await test.services.imports.get(as(admin), id)).state).toBe("stopped");
    const left = await test.database.execute<{ count: number }>(
      sql`select count(*)::int as count from spaces where id = ${spaceId}`,
    );
    expect(left.rows[0]?.count).toBe(0);
  });

  it("resumes after an interruption in every phase without duplicates", async () => {
    const id = await prepared(largeExport(120, 30), { key: "BIGR" });
    await test.services.imports.start(as(admin), id);
    const runs = await drive(id, worker(0, defaultReaders()));
    const result = await test.services.imports.get(as(admin), id);
    expect(result.state).toBe("review");
    expect(runs).toBeGreaterThan(12);
    const spaceId = result.quarantineSpace?.id ?? "";
    const counts = await test.database.execute<{
      pages: number;
      titles: number;
      attachments: number;
      versions: number;
    }>(sql`
      select (select count(*)::int from tree_items where space_id = ${spaceId}) as pages,
        (select count(distinct title)::int from tree_items where space_id = ${spaceId}) as titles,
        (select count(*)::int from attachments a join tree_items t on t.id = a.item_id where t.space_id = ${spaceId}) as attachments,
        (select count(*)::int from attachment_versions v join attachments a on a.id = v.attachment_id
          join tree_items t on t.id = a.item_id where t.space_id = ${spaceId}) as versions`);
    expect(counts.rows[0]).toEqual({ pages: 121, titles: 121, attachments: 30, versions: 60 });
    const firstVersions = await test.database.execute<{ count: number }>(sql`
      select count(*)::int as count from page_versions v join tree_items t on t.id = v.item_id
      where t.space_id = ${spaceId}`);
    expect(firstVersions.rows[0]?.count).toBe(121);
  });

  it("continues after a crash in the middle of a phase", async () => {
    const id = await prepared(largeExport(40, 4), { key: "BIGC" });
    await test.services.imports.start(as(admin), id);
    const failing = new ConfluenceXmlReader();
    let calls = 0;
    const original = failing.bodies.bind(failing);
    failing.bodies = async (context, pageIds) => {
      calls += 1;
      if (calls === 2) throw new Error("Simulated crash");
      return original(context, pageIds);
    };
    const crashing = worker(
      undefined,
      new ImportReaderRegistry().register(failing, new ConfluenceCsvReader()),
    );
    await expect(crashing.work(testJobContext("imports.work", { importId: id }))).rejects.toThrow(
      "Simulated crash",
    );
    await drive(id);
    const result = await test.services.imports.get(as(admin), id);
    expect(result.state).toBe("review");
    const pages = await test.database.execute<{ count: number }>(sql`
      select count(*)::int as count from tree_items where space_id = ${result.quarantineSpace?.id ?? ""}`);
    expect(pages.rows[0]?.count).toBe(41);
  });

  it("lets only one worker run an import at a time", async () => {
    const id = await prepared(largeExport(20, 2), { key: "BIGL" });
    await test.services.imports.start(as(admin), id);
    const first = worker(undefined, defaultReaders());
    const second = worker(undefined, defaultReaders());
    await Promise.all([
      first.work(testJobContext("imports.work", { importId: id })),
      second.work(testJobContext("imports.work", { importId: id })),
    ]);
    await drive(id);
    const result = await test.services.imports.get(as(admin), id);
    const pages = await test.database.execute<{ count: number }>(sql`
      select count(*)::int as count from tree_items where space_id = ${result.quarantineSpace?.id ?? ""}`);
    expect(pages.rows[0]?.count).toBe(21);
  });

  it("keeps a crafted export inside the quarantine space and creates only placeholders", async () => {
    const victim = await fixtures.space(organizationId, admin, { name: "Victim", key: "VICTIM" });
    const before = await test.database.execute<{ items: number; accounts: number; permissions: number }>(sql`
      select (select count(*)::int from tree_items where space_id <> all(select id from spaces where quarantined)) as items,
        (select count(*)::int from accounts where state <> 'placeholder') as accounts,
        (select count(*)::int from space_permissions where space_id = ${victim.id}) as permissions`);
    const model = syntheticExport();
    const crafted: SyntheticExport = {
      ...model,
      space: { ...model.space, key: "VICTIM", name: "Victim" },
      users: [
        { key: "admin", accountId: admin },
        { key: "evil", accountId: "<script>alert(1)</script>" },
      ],
      pages: [
        ...model.pages,
        {
          id: "9001",
          title: "Victim",
          parentId: victim.overviewItemId,
          position: null,
          body: `<p><ac:link><ri:page ri:space-key="VICTIM" ri:content-title="Victim" /></ac:link><ac:link><ri:user ri:account-id="${admin}" /></ac:link></p>`,
          creatorKey: "admin",
        },
      ],
    };
    const result = await imported(crafted, { key: "CRAFT" });
    expect(result.state).toBe("review");
    const after = await test.database.execute<{ items: number; accounts: number; permissions: number }>(sql`
      select (select count(*)::int from tree_items where space_id <> all(select id from spaces where quarantined)) as items,
        (select count(*)::int from accounts where state <> 'placeholder') as accounts,
        (select count(*)::int from space_permissions where space_id = ${victim.id}) as permissions`);
    expect(after.rows[0]).toEqual(before.rows[0]);
    const mentioned = await test.database.execute<{ state: string; id: string }>(sql`
      select a.state, a.id from account_external_ids e join accounts a on a.id = e.account_id
      where e.organization_id = ${organizationId} and e.external_id = ${admin}`);
    expect(mentioned.rows[0]?.state).toBe("placeholder");
    expect(mentioned.rows[0]?.id).not.toBe(admin);
  });

  it("refuses uploads above the instance limit before any part is sent", async () => {
    await test.settings.set((await import("./settings.js")).maxUploadSetting, {}, "instance", 1);
    try {
      await expect(
        test.services.importUploads.create(as(admin), organizationId, {
          name: "big.zip",
          size: 2 * 1024 * 1024,
        }),
      ).rejects.toMatchObject({ code: "uploadTooLarge" });
    } finally {
      await test.settings.clear((await import("./settings.js")).maxUploadSetting, {}, "instance");
    }
  });

  it("continues an interrupted upload and checks the whole file at the end", async () => {
    const uploads = test.services.importUploads;
    const archive = Buffer.alloc(40 * 1024 * 1024, 7);
    const created = await uploads.create(as(admin), organizationId, {
      name: "large.zip",
      size: archive.length,
    });
    expect(created.partCount).toBe(3);
    const part = (number: number) =>
      archive.subarray((number - 1) * created.partSize, number * created.partSize);
    await uploads.putPart(as(admin), created.id, 1, {
      body: Readable.from([part(1)]),
      sha256: sha256(part(1)),
    });
    await expect(
      uploads.putPart(as(admin), created.id, 2, {
        body: Readable.from([part(2).subarray(0, 1000)]),
        sha256: sha256(part(2)),
      }),
    ).rejects.toMatchObject({ code: "uploadChecksumMismatch" });
    const resumed = await uploads.get(as(admin), created.id);
    expect(resumed.parts.map((entry) => entry.number)).toEqual([1]);
    await expect(uploads.complete(as(admin), created.id, { sha256: "0".repeat(64) })).rejects.toMatchObject({
      code: "uploadIncomplete",
    });
    for (const number of [2, 3]) {
      await uploads.putPart(as(admin), created.id, number, {
        body: Readable.from([part(number)]),
        sha256: sha256(part(number)),
      });
    }
    await expect(uploads.complete(as(admin), created.id, { sha256: "0".repeat(64) })).rejects.toMatchObject({
      code: "uploadChecksumMismatch",
    });
    const digest = combinedDigest([1, 2, 3].map((number) => sha256(part(number))));
    await expect(uploads.complete(as(admin), created.id, { sha256: digest })).resolves.toMatchObject({
      complete: true,
    });
    await expect(uploads.get(as(reviewer), created.id)).rejects.toThrow();
  });
});
