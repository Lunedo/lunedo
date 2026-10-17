import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { sql } from "drizzle-orm";
import { accountPrincipal } from "../../accounts/principal.js";
import type { Logger } from "../../logging/logger.js";
import { createLogger } from "../../logging/logger.js";
import { testJobContext } from "../../testing/jobs.js";
import type { TestServices } from "../../testing/services.js";
import { AtlassianDirectory } from "../atlassian.js";
import type { ConfluenceTransport } from "../confluence/api-client.js";
import { ConfluenceApiReader } from "../confluence/api-reader.js";
import { ConfluenceCsvReader } from "../confluence/csv-reader.js";
import { ConfluenceXmlReader } from "../confluence/xml-reader.js";
import type { OptionsInput, PeopleSourceInput } from "../imports.js";
import { MarkdownReader } from "../markdown/reader.js";
import { ImportPipeline } from "../pipeline.js";
import { ImportReaderRegistry } from "../source.js";
import { combinedDigest } from "../uploads.js";
import { WordReader } from "../word/reader.js";
import { ImportWorker } from "../worker.js";
import { createCsvExport, createXmlExport, type SyntheticExport } from "./confluence-export.js";

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface ImportHarnessOptions {
  readonly fetch?: typeof fetch;
  readonly logger?: Logger;
  readonly transport?: ConfluenceTransport;
}

const NO_TRANSPORT: ConfluenceTransport = {
  async get() {
    throw new Error("No Confluence transport in this test");
  },
};

export function importHarness(test: () => TestServices, options: ImportHarnessOptions = {}) {
  const as = (id: string) => accountPrincipal(id);

  function readers(): ImportReaderRegistry {
    const { database, encryption } = test();
    const transport = options.transport ?? NO_TRANSPORT;
    return new ImportReaderRegistry().register(
      new ConfluenceXmlReader(),
      new ConfluenceCsvReader(),
      new ConfluenceApiReader("confluence-cloud", { database, encryption, transport }),
      new ConfluenceApiReader("confluence-dc", { database, encryption, transport }),
      new MarkdownReader(),
      new WordReader(),
    );
  }

  function worker(segmentMs?: number): ImportWorker {
    const { services, database, encryption, settings, pool } = test();
    return new ImportWorker({
      database,
      pool,
      audit: services.audit,
      authorization: services.authorization,
      notifications: services.notifications,
      encryption,
      atlassian: new AtlassianDirectory(options.fetch ? { fetch: options.fetch } : {}),
      uploads: services.importUploads,
      readers: readers(),
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
      logger: options.logger ?? createLogger({ service: "test", level: "silent" }),
      ...(segmentMs === undefined ? {} : { segmentMs }),
    });
  }

  async function drive(importId: string, runner = worker()): Promise<number> {
    let runs = 0;
    for (; runs < 500; runs++) {
      const state = await test().database.execute<{ state: string }>(
        sql`select state from imports where id = ${importId}`,
      );
      if (!["analyzing", "running", "stopping", "discarding"].includes(state.rows[0]?.state ?? "")) break;
      await runner.work(testJobContext("imports.work", { importId }));
    }
    return runs;
  }

  async function upload(
    owner: string,
    organizationId: string,
    archive: Buffer,
    name = "export.zip",
  ): Promise<string> {
    const services = test().services.importUploads;
    const created = await services.create(as(owner), organizationId, {
      name,
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
    input: {
      organizationId: string;
      admin: string;
      key: string;
      format?: "xml" | "csv";
      legacyRestrictions?: boolean;
      reviewers?: string[];
      history?: boolean;
      people?: PeopleSourceInput;
      archive?: Buffer;
    },
  ): Promise<string> {
    const imports = test().services.imports;
    const format = input.format ?? "xml";
    const created = await imports.create(as(input.admin), input.organizationId, {
      source: format === "xml" ? "confluence-xml" : "confluence-csv",
    });
    const archive =
      input.archive ??
      (format === "xml"
        ? createXmlExport(model)
        : createCsvExport(model, { legacyRestrictions: input.legacyRestrictions ?? false }));
    const uploadId = await upload(input.admin, input.organizationId, archive);
    await imports.update(as(input.admin), created.id, { file: { kind: "upload", uploadId } });
    await drive(created.id);
    await imports.update(as(input.admin), created.id, {
      spaceName: `Imported ${input.key}`,
      spaceKey: input.key,
      history: input.history ?? false,
      sourceUrl: "https://example.atlassian.net/wiki",
    });
    if (input.reviewers) await imports.setReviewers(as(input.admin), created.id, input.reviewers);
    await imports.setPeopleSource(
      as(input.admin),
      created.id,
      input.people ?? { kind: "skip", confirmed: true },
    );
    return created.id;
  }

  async function imported(model: SyntheticExport, input: Parameters<typeof prepared>[1]) {
    const id = await prepared(model, input);
    await test().services.imports.start(as(input.admin), id);
    await drive(id);
    return test().services.imports.get(as(input.admin), id);
  }

  async function accepted(model: SyntheticExport, input: Parameters<typeof prepared>[1]) {
    const view = await imported(model, input);
    await test().services.imports.accept(as(input.admin), view.id, { visibility: "private", grants: [] });
    return test().services.imports.get(as(input.admin), view.id);
  }

  async function analyzedReimport(
    model: SyntheticExport,
    input: {
      organizationId: string;
      admin: string;
      spaceId: string;
      format?: "xml" | "csv";
      people?: PeopleSourceInput;
      archive?: Buffer;
    },
  ): Promise<string> {
    const imports = test().services.imports;
    const format = input.format ?? "xml";
    const created = await imports.create(as(input.admin), input.organizationId, {
      source: format === "xml" ? "confluence-xml" : "confluence-csv",
      spaceId: input.spaceId,
    });
    const archive = input.archive ?? (format === "xml" ? createXmlExport(model) : createCsvExport(model));
    const uploadId = await upload(input.admin, input.organizationId, archive);
    await imports.update(as(input.admin), created.id, { file: { kind: "upload", uploadId } });
    await drive(created.id);
    return created.id;
  }

  async function reimported(model: SyntheticExport, input: Parameters<typeof analyzedReimport>[1]) {
    const id = await analyzedReimport(model, input);
    const imports = test().services.imports;
    await imports.setPeopleSource(as(input.admin), id, input.people ?? { kind: "skip", confirmed: true });
    await imports.start(as(input.admin), id);
    await drive(id);
    return imports.get(as(input.admin), id);
  }

  async function applyChanges(actor: string, importId: string, runner = worker()) {
    await test().services.imports.reimports.apply(as(actor), importId);
    await drive(importId, runner);
    return test().services.imports.get(as(actor), importId);
  }

  async function target(importId: string, kind: string, sourceId: string): Promise<string> {
    const result = await test().database.execute<{ target_id: string }>(sql`
      select target_id from import_items where import_id = ${importId} and kind = ${kind} and source_id = ${sourceId}`);
    return result.rows[0]?.target_id ?? "";
  }

  async function analyzedFiles(input: {
    organizationId: string;
    admin: string;
    source: "markdown" | "word";
    files: readonly { name: string; data: Buffer }[];
    options?: OptionsInput;
    spaceId?: string;
  }): Promise<string> {
    const imports = test().services.imports;
    const created = await imports.create(as(input.admin), input.organizationId, {
      source: input.source,
      ...(input.spaceId ? { spaceId: input.spaceId } : {}),
    });
    if (input.options) await imports.update(as(input.admin), created.id, { options: input.options });
    const ids: string[] = [];
    for (const file of input.files)
      ids.push(await upload(input.admin, input.organizationId, file.data, file.name));
    if (input.source === "markdown") {
      const [first] = ids;
      if (first)
        await imports.update(as(input.admin), created.id, { file: { kind: "upload", uploadId: first } });
    } else await imports.update(as(input.admin), created.id, { files: ids });
    await drive(created.id);
    return created.id;
  }

  async function importedFiles(input: Parameters<typeof analyzedFiles>[0] & { key: string }) {
    const id = await analyzedFiles(input);
    const imports = test().services.imports;
    const ready = await imports.get(as(input.admin), id);
    if (ready.state !== "ready") return ready;
    if (!input.spaceId) {
      await imports.update(as(input.admin), id, { spaceName: `Imported ${input.key}`, spaceKey: input.key });
    }
    await imports.start(as(input.admin), id);
    await drive(id);
    return imports.get(as(input.admin), id);
  }

  return {
    as,
    worker,
    readers,
    analyzedFiles,
    importedFiles,
    drive,
    upload,
    prepared,
    imported,
    accepted,
    analyzedReimport,
    reimported,
    applyChanges,
    target,
  };
}
