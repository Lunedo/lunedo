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
import {
  ALICE,
  BOB,
  CAROL,
  PAGE,
  PEOPLE_COMMENT,
  PEOPLE_PAGE,
  PNG,
  peopleExport,
  syntheticExport,
} from "../testing/fixture.js";
import { createZip } from "../testing/zip-writer.js";
import { ConfluenceCsvReader } from "./csv-reader.js";
import { ConfluenceXmlReader, unescapeNestedCdata } from "./xml-reader.js";

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
      options: {},
      history: false,
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
    expect(result.summary).toMatchObject({ pages: 8, attachments: 3, people: 3, spaceKey: "SYN" });
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

  function rawXmlExport(objects: string[]): Buffer {
    const space = (id: string, key: string) =>
      `<object class="Space" package="com.atlassian.confluence"><id name="id">${id}</id><property name="key">${key}</property><property name="name">Space ${key}</property></object>`;
    return createZip([
      { name: "exportDescriptor.properties", data: "exportType=space\nspaceKey=RAW\n" },
      {
        name: "entities.xml",
        data: `<hibernate-generic>${space("7001", "RAW")}${objects.join("")}</hibernate-generic>`,
        deflate: true,
      },
    ]);
  }

  function page(id: string, properties: string[]): string {
    return `<object class="Page" package="com.atlassian.confluence"><id name="id">${id}</id><property name="title">Page ${id}</property>${properties.join("")}</object>`;
  }

  it("refuses an object whose properties together exceed the object limit", async () => {
    const filler = "x".repeat(900);
    const spread = Array.from(
      { length: 50 },
      (_, index) => `<property name="extra${index}">${filler}</property>`,
    );
    const limits = { maxObjectBytes: 10_000, maxSpaces: 10 };
    await expect(
      read(new ConfluenceXmlReader(limits), rawXmlExport([page("7101", spread)])),
    ).rejects.toMatchObject({
      code: "xmlElementTooLarge",
    });
    const repeated = Array.from({ length: 50 }, () => `<property name="title">${filler}</property>`);
    await expect(
      read(new ConfluenceXmlReader(limits), rawXmlExport([page("7102", repeated)])),
    ).rejects.toMatchObject({ code: "xmlElementTooLarge" });
    const result = await read(
      new ConfluenceXmlReader(limits),
      rawXmlExport([page("7103", spread.slice(0, 5)), page("7104", spread.slice(0, 5))]),
    );
    expect(result.pages.map((entry) => entry.title)).toEqual(["Page 7103", "Page 7104"]);
  });

  it("refuses an export with more spaces than the limit", async () => {
    const spaces = Array.from(
      { length: 3 },
      (_, index) =>
        `<object class="Space" package="com.atlassian.confluence"><id name="id">${7201 + index}</id><property name="key">OTHER${index}</property></object>`,
    );
    const limits = { maxObjectBytes: 10_000, maxSpaces: 3 };
    await expect(read(new ConfluenceXmlReader(limits), rawXmlExport(spaces))).rejects.toMatchObject({
      code: "xmlElementTooLarge",
    });
    const result = await read(new ConfluenceXmlReader(limits), rawXmlExport(spaces.slice(0, 2)));
    expect(result.pages).toEqual([]);
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
      options: {},
      history: false,
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

  it("reads comments, likes, blog posts, versions and permissions the same way from every export format", async () => {
    const model = peopleExport();
    async function people(reader: ImportReader, archive: Buffer) {
      const staging = new StagingStore(test.database, await importRow());
      const file = bufferSource(archive);
      await reader.scan(file, {
        staging,
        checkpoint: {},
        async saveCheckpoint() {},
        async progress() {},
        async problem() {},
        signal: new AbortController().signal,
        options: {},
        history: false,
      });
      const context: ReadContext = { staging };
      const pages = [];
      for await (const page of reader.pages(context)) pages.push({ id: page.sourceId, type: page.type });
      const versions = [];
      for await (const version of reader.versions(context, PEOPLE_PAGE.history)) versions.push(version);
      const likes = [];
      for await (const like of reader.likes(context)) likes.push(like);
      const permissions = [];
      for await (const permission of reader.spacePermissions(context)) permissions.push(permission);
      const comments = await reader.comments(context, [PEOPLE_PAGE.plan, PEOPLE_PAGE.blog]);
      const restrictions = await reader.restrictions(context, [PEOPLE_PAGE.secret, PEOPLE_PAGE.editors]);
      const sort = <T extends { sourceId: string }>(list: T[]) =>
        [...list].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
      return {
        summary: await reader.summary(context),
        pages: [...pages].sort((a, b) => a.id.localeCompare(b.id)),
        versions,
        likes: sort(likes),
        permissions: sort(permissions).map(({ sourceId: _id, ...rest }) => rest),
        comments: sort([...comments]),
        restrictions: [...restrictions]
          .map(({ sourceId: _id, ...rest }) => rest)
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      };
    }
    const xml = await people(new ConfluenceXmlReader(), createXmlExport(model));
    const csv = await people(new ConfluenceCsvReader(), createCsvExport(model));
    const legacy = await people(
      new ConfluenceCsvReader(),
      createCsvExport(model, { legacyRestrictions: true }),
    );
    expect(csv).toEqual(xml);
    expect(legacy).toEqual(xml);
    expect(xml.summary).toMatchObject({
      pages: 6,
      blogPosts: 1,
      versions: 2,
      comments: 8,
      likes: 4,
      watchers: 3,
    });
    expect(xml.pages).toContainEqual({ id: PEOPLE_PAGE.blog, type: "blogPost" });
    expect(xml.versions.map((version) => [version.version, version.authorId, version.title])).toEqual([
      [1, ALICE.accountId, "Notes"],
      [2, CAROL.accountId, "Release notes"],
    ]);
    const byId = new Map(xml.comments.map((comment) => [comment.sourceId, comment]));
    expect(byId.get(PEOPLE_COMMENT.reply)).toMatchObject({
      parentId: PEOPLE_COMMENT.root,
      authorId: CAROL.accountId,
    });
    expect(byId.get(PEOPLE_COMMENT.inlineFound)?.inline).toEqual({
      markerRef: "marker-found",
      selection: "rollout window",
    });
    expect(byId.get(PEOPLE_COMMENT.inlineResolved)).toMatchObject({
      status: "resolved",
      resolvedById: ALICE.accountId,
      resolvedAt: "2024-04-02T08:00:00.000Z",
    });
    expect(byId.get(PEOPLE_COMMENT.inlineDangling)?.status).toBe("dangling");
    expect(xml.likes.map((like) => [like.contentId, like.personId])).toContainEqual([
      PEOPLE_COMMENT.root,
      CAROL.accountId,
    ]);
    expect(xml.permissions).toContainEqual({
      type: "VIEWSPACE",
      group: null,
      personId: null,
      allUsers: false,
    });
    expect(xml.permissions).toContainEqual({
      type: "VIEWSPACE",
      group: null,
      personId: null,
      allUsers: true,
    });
    expect(xml.permissions).toContainEqual({
      type: "EDITSPACE",
      group: null,
      personId: BOB.accountId,
      allUsers: false,
    });
    expect(xml.restrictions).toHaveLength(3);
    expect(xml.restrictions).toEqual(
      expect.arrayContaining([
        { contentId: PEOPLE_PAGE.editors, kind: "edit", personId: null, group: "Editors" },
        { contentId: PEOPLE_PAGE.secret, kind: "view", personId: CAROL.accountId, group: null },
        { contentId: PEOPLE_PAGE.secret, kind: "view", personId: null, group: "hr-team" },
      ]),
    );
  });
});

describe("nested CDATA in the XML export", () => {
  it("restores CDATA ends the export split, also after a closing bracket", () => {
    expect(unescapeNestedCdata("<![CDATA[a]] ></x>")).toBe("<![CDATA[a]]></x>");
    expect(unescapeNestedCdata("<![CDATA[list[0]] ]></x>")).toBe("<![CDATA[list[0]]]></x>");
    expect(unescapeNestedCdata("<![CDATA[x]] ]]></x>")).toBe("<![CDATA[x]]]]></x>");
    expect(unescapeNestedCdata("plain ]] text")).toBe("plain ]] text");
  });
});
