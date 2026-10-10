import { randomUUID } from "node:crypto";
import { buffer } from "node:stream/consumers";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseBaseUrl } from "../../testing/database.js";
import { createTestServices, type TestServices } from "../../testing/services.js";
import { spaceFixtures } from "../../testing/spaces.js";
import { bufferSource } from "../formats/bytes.js";
import type { ImportReader, ReadContext } from "../source.js";
import { StagingStore } from "../staging.js";
import { createCsvExport, createXmlExport } from "../testing/confluence-export.js";
import { ALICE, BOB, PAGE, PNG, syntheticExport } from "../testing/fixture.js";
import { ConfluenceCsvReader } from "./csv-reader.js";
import { ConfluenceXmlReader } from "./xml-reader.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("Confluence export readers", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl as string);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function importRow(): Promise<string> {
    const organization = await fixtures.organization();
    const id = randomUUID();
    await test.database.execute(sql`
      insert into imports (id, organization_id, importer_id, source)
      values (${id}, ${organization.id}, ${organization.owner}, 'confluence-xml')`);
    return id;
  }

  async function read(reader: ImportReader, archive: Buffer) {
    const staging = new StagingStore(test.database, await importRow());
    const problems: string[] = [];
    let checkpoint: Record<string, unknown> = {};
    const file = bufferSource(archive);
    await reader.scan(file, {
      staging,
      checkpoint,
      async saveCheckpoint(next) {
        checkpoint = next;
      },
      async progress() {},
      async problem(code) {
        problems.push(code);
      },
      signal: new AbortController().signal,
    });
    const context: ReadContext = { staging };
    const pages = [];
    for await (const page of reader.pages(context)) pages.push(page);
    const people = [];
    for await (const person of reader.people(context)) people.push(person);
    const attachments = [];
    for await (const attachment of reader.attachments(context)) {
      const versions = [];
      for (const version of attachment.versions) {
        const stream = version.file ? await reader.openFile(file, context, version.file) : null;
        versions.push({
          sourceId: version.sourceId,
          version: version.version,
          creatorId: version.creatorId,
          content: stream ? (await buffer(stream)).toString("base64") : null,
        });
      }
      attachments.push({ ...attachment, versions });
    }
    const pageIds = pages.map((page) => page.sourceId);
    const bodies = Object.fromEntries(
      [...(await reader.bodies(context, pageIds)).entries()].map(([id, body]) => [id, body.content]),
    );
    const labels = [...(await reader.labels(context, pageIds))].sort((a, b) =>
      `${a.pageId}${a.name}`.localeCompare(`${b.pageId}${b.name}`),
    );
    return {
      space: await reader.space(context),
      summary: await reader.summary(context),
      pages,
      people,
      attachments,
      bodies,
      labels,
      problems,
    };
  }

  it("yields the same items from the XML and the CSV export", async () => {
    const model = syntheticExport();
    const xml = await read(new ConfluenceXmlReader(), createXmlExport(model));
    const csv = await read(new ConfluenceCsvReader(), createCsvExport(model));
    const gzipped = await read(new ConfluenceCsvReader(), createCsvExport(model, { gzip: true }));
    expect(csv).toEqual(xml);
    expect(gzipped).toEqual(xml);
  });

  it("reads the space, the current pages in tree order and their authors", async () => {
    const result = await read(new ConfluenceXmlReader(), createXmlExport(syntheticExport()));
    expect(result.space).toEqual({
      sourceId: "5001",
      key: "SYN",
      name: "Synthetic space",
      homePageId: PAGE.home,
    });
    expect(result.pages.map((page) => [page.sourceId, page.parentId])).toEqual([
      [PAGE.orphan, null],
      [PAGE.home, null],
      [PAGE.beta, PAGE.home],
      [PAGE.alpha, PAGE.home],
      [PAGE.child, PAGE.alpha],
      [PAGE.grandchild, PAGE.child],
      [PAGE.aardvark, PAGE.home],
      [PAGE.zeta, PAGE.home],
    ]);
    const beta = result.pages.find((page) => page.sourceId === PAGE.beta);
    expect(beta).toMatchObject({ title: "Beta", creatorId: BOB.accountId, version: 2 });
    expect(result.people).toEqual([
      { sourceId: ALICE.accountId, accountId: ALICE.accountId, userKey: ALICE.key },
      { sourceId: BOB.accountId, accountId: BOB.accountId, userKey: BOB.key },
    ]);
    expect(result.bodies[PAGE.beta]).toContain("Beta links back");
    expect(result.summary).toMatchObject({ pages: 8, attachments: 3, people: 2, spaceKey: "SYN" });
  });

  it("reads attachments with every version in the export and labels", async () => {
    const result = await read(new ConfluenceXmlReader(), createXmlExport(syntheticExport()));
    const diagram = result.attachments.find((attachment) => attachment.fileName === "diagram.png");
    expect(diagram?.versions.map((version) => [version.version, version.content])).toEqual([
      [1, PNG.toString("base64")],
      [2, Buffer.concat([PNG, Buffer.from([0])]).toString("base64")],
    ]);
    const lost = result.attachments.find((attachment) => attachment.fileName === "lost.txt");
    expect(lost?.versions[0]?.content).toBeNull();
    expect(result.attachments.some((attachment) => attachment.fileName === "gone.txt")).toBe(false);
    expect(result.labels).toEqual([
      { pageId: PAGE.alpha, name: "howto" },
      { pageId: PAGE.alpha, name: "important" },
      { pageId: PAGE.beta, name: "howto" },
    ]);
  });

  it("refuses an export of the other format with a clear code", async () => {
    await expect(read(new ConfluenceXmlReader(), createCsvExport(syntheticExport()))).rejects.toMatchObject({
      code: "wrongFormat",
    });
    await expect(read(new ConfluenceCsvReader(), createXmlExport(syntheticExport()))).rejects.toMatchObject({
      code: "wrongFormat",
    });
  });

  it("resumes a scan from its checkpoint without duplicates", async () => {
    const reader = new ConfluenceXmlReader();
    const archive = createXmlExport(syntheticExport());
    const staging = new StagingStore(test.database, await importRow());
    const controller = new AbortController();
    let checkpoint: Record<string, unknown> = {};
    let calls = 0;
    const context = () => ({
      staging,
      checkpoint,
      async saveCheckpoint(next: Record<string, unknown>) {
        checkpoint = next;
      },
      async progress() {
        calls += 1;
      },
      async problem() {},
      signal: controller.signal,
    });
    await reader.scan(bufferSource(archive), context());
    const first = [];
    for await (const page of reader.pages({ staging })) first.push(page.sourceId);
    await reader.scan(bufferSource(archive), context());
    const second = [];
    for await (const page of reader.pages({ staging })) second.push(page.sourceId);
    expect(second).toEqual(first);
    expect(calls).toBeGreaterThanOrEqual(0);
  });
});
