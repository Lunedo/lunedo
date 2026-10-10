import { type DocumentJson, editorSchemaVersion, slugify } from "@pagehall/editor-schema";
import { yDocFromDocument } from "@pagehall/editor-schema/yjs";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { AuditLog } from "../audit/audit-log.js";
import { claimTaskIds, publishTasks } from "../collaboration/content.js";
import { writeTaskStatus } from "../collaboration/tasks.js";
import type { Database, Transaction } from "../database/database.js";
import { type FileService, FileTooLargeError } from "../files/files.js";
import { cleanFileName, fileNameKey } from "../files/names.js";
import { MEGABYTE, maxFileSizeSetting } from "../files/settings.js";
import type { SettingsService } from "../settings/service.js";
import { encodeState, MAX_LABELS_PER_PAGE, normalizeLabel, recomputeLinks } from "../spaces/documents.js";
import { endPosition, ITEM_TITLE_MAX_LENGTH } from "../spaces/items.js";
import { signalSpaceChange } from "../spaces/signals.js";
import { insertFirstVersion } from "../spaces/versions.js";
import { refreshReaderVisibility } from "../spaces/visibility.js";
import {
  type ConversionNote,
  convertStorage,
  type PageReference,
  parseStorage,
  type StorageLookup,
  storageReferences,
} from "./confluence/storage.js";
import { ImportFormatError } from "./errors.js";
import type { ByteSource } from "./formats/bytes.js";
import { ensurePlaceholders } from "./people.js";
import { createQuarantineSpace } from "./quarantine.js";
import { type ProblemInput, recordProblems } from "./report.js";
import type { ImportReader, ReadContext, SourcePage, SourcePerson } from "./source.js";
import type { StagingStore } from "./staging.js";

export const pipelinePhases = ["space", "people", "pages", "attachments", "content", "finish"] as const;
export type PipelinePhase = (typeof pipelinePhases)[number];

export interface PipelineRun {
  readonly importId: string;
  readonly organizationId: string;
  readonly importerId: string;
  readonly reviewerIds: readonly string[];
  readonly spaceName: string;
  readonly spaceKey: string;
  readonly sourceUrl: string | null;
  readonly reader: ImportReader;
  readonly file: ByteSource;
  readonly staging: StagingStore;
  beat(): Promise<void>;
  progress(done: number, total: number): Promise<void>;
}

const PAGE_BATCH = 50;
const CONTENT_BATCH = 20;

function pageTitle(page: SourcePage): string {
  const title = page.title.replace(/\s+/g, " ").trim().slice(0, ITEM_TITLE_MAX_LENGTH);
  return title.length > 0 ? title : `Page ${page.sourceId}`.slice(0, ITEM_TITLE_MAX_LENGTH);
}

function noteProblem(note: ConversionNote, itemId: string, sourceId: string): ProblemInput {
  const base = { sourceKind: "page", sourceId, itemId };
  switch (note.code) {
    case "externalPageLink":
      return {
        ...base,
        code: note.code,
        details: { title: note.title.slice(0, 255), spaceKey: note.spaceKey },
      };
    case "missingAttachment":
      return { ...base, code: note.code, details: { fileName: note.fileName.slice(0, 255) } };
    case "unsupportedLink":
      return { ...base, code: note.code, details: { kind: note.kind.slice(0, 50) } };
    case "invalidContent":
      return { ...base, code: note.code, details: { element: note.element } };
    case "macroDataTruncated":
      return { ...base, code: note.code, details: { macro: note.macro } };
    default:
      return { ...base, code: note.code };
  }
}

export function originalPageUrl(base: string | null, spaceKey: string, title: string): string | null {
  if (!base) return null;
  const root = base.replace(/\/+$/, "");
  return `${root}/display/${encodeURIComponent(spaceKey)}/${encodeURIComponent(title).replaceAll("%20", "+")}`;
}

export class ImportPipeline {
  readonly #database: Database;
  readonly #files: FileService;
  readonly #settings: SettingsService;
  readonly #audit: AuditLog;

  constructor(options: {
    database: Database;
    files: FileService;
    settings: SettingsService;
    audit: AuditLog;
  }) {
    this.#database = options.database;
    this.#files = options.files;
    this.#settings = options.settings;
    this.#audit = options.audit;
  }

  async runPhase(phase: PipelinePhase, run: PipelineRun): Promise<void> {
    switch (phase) {
      case "space":
        return this.#space(run);
      case "people":
        return this.#people(run);
      case "pages":
        return this.#pages(run);
      case "attachments":
        return this.#attachments(run);
      case "content":
        return this.#content(run);
      case "finish":
        return this.#finish(run);
    }
  }

  async #mapped(importId: string, kind: string, sourceIds: readonly string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (sourceIds.length === 0) return result;
    const rows = await this.#database.execute<{ source_id: string; target_id: string }>(sql`
      select source_id, target_id from import_items
      where import_id = ${importId} and kind = ${kind} and source_id = any(${sql.param([...new Set(sourceIds)])}::text[])`);
    for (const row of rows.rows) result.set(row.source_id, row.target_id);
    return result;
  }

  async #map(
    tx: Transaction,
    importId: string,
    kind: string,
    sourceId: string,
    targetId: string,
  ): Promise<void> {
    await tx.execute(sql`
      insert into import_items (import_id, kind, source_id, target_id)
      values (${importId}, ${kind}, ${sourceId}, ${targetId})
      on conflict (import_id, kind, source_id) do nothing`);
  }

  async quarantineSpace(importId: string): Promise<{ spaceId: string; overviewId: string } | null> {
    const result = await this.#database.execute<{ space_id: string; overview_item_id: string | null }>(sql`
      select s.id as space_id, s.overview_item_id from imports i join spaces s on s.id = i.quarantine_space_id
      where i.id = ${importId}`);
    const row = result.rows[0];
    return row?.overview_item_id ? { spaceId: row.space_id, overviewId: row.overview_item_id } : null;
  }

  async #requireSpace(importId: string): Promise<{ spaceId: string; overviewId: string }> {
    const space = await this.quarantineSpace(importId);
    if (!space) throw new Error("The quarantine space is missing");
    return space;
  }

  async #space(run: PipelineRun): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const locked = await tx.execute<{ quarantine_space_id: string | null }>(
        sql`select quarantine_space_id from imports where id = ${run.importId} for update`,
      );
      if (locked.rows[0]?.quarantine_space_id) return;
      const existing = await tx.execute<{ taken: boolean }>(
        sql`select exists (select 1 from spaces where key = ${run.spaceKey}) as taken`,
      );
      if (existing.rows[0]?.taken) {
        throw new ImportFormatError("keyTaken", "Another space now uses the key of this import.");
      }
      const space = await createQuarantineSpace(tx, {
        organizationId: run.organizationId,
        name: run.spaceName,
        key: run.spaceKey,
        importerId: run.importerId,
        readers: run.reviewerIds,
      });
      await tx.execute(
        sql`update imports set quarantine_space_id = ${space.spaceId} where id = ${run.importId}`,
      );
    });
  }

  async #people(run: PipelineRun): Promise<void> {
    const context: ReadContext = { staging: run.staging };
    let batch: SourcePerson[] = [];
    let done = 0;
    const flush = async () => {
      const mapped = await this.#mapped(
        run.importId,
        "person",
        batch.map((person) => person.sourceId),
      );
      const open = batch.filter((person) => !mapped.has(person.sourceId));
      done += batch.length;
      batch = [];
      if (open.length === 0) return;
      await ensurePlaceholders(
        this.#database,
        this.#audit,
        { organizationId: run.organizationId, importId: run.importId },
        open,
      );
      await run.progress(done, done);
      await run.beat();
    };
    for await (const person of run.reader.people(context)) {
      batch.push(person);
      if (batch.length >= 100) await flush();
    }
    await flush();
  }

  async #creators(run: PipelineRun, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    return this.#mapped(
      run.importId,
      "person",
      ids.filter((id): id is string => id !== null),
    );
  }

  async #pages(run: PipelineRun): Promise<void> {
    const context: ReadContext = { staging: run.staging };
    const space = await this.#requireSpace(run.importId);
    const home = (await run.reader.space(context)).homePageId;
    const total = await run.staging.count("page");
    let done = 0;
    let batch: SourcePage[] = [];
    const flush = async () => {
      const pages = batch;
      batch = [];
      const already = await this.#mapped(
        run.importId,
        "page",
        pages.map((page) => page.sourceId),
      );
      const creators = await this.#creators(
        run,
        pages.map((page) => page.creatorId),
      );
      let created = 0;
      await this.#database.transaction(async (tx) => {
        const parents = await this.#mappedIn(
          tx,
          run.importId,
          "page",
          pages.map((page) => page.parentId ?? ""),
        );
        for (const page of pages) {
          if (already.has(page.sourceId)) continue;
          created += 1;
          if (page.sourceId === home) {
            await this.#map(tx, run.importId, "page", page.sourceId, space.overviewId);
            continue;
          }
          const parentId =
            page.parentId && page.parentId !== home
              ? (parents.get(page.parentId) ??
                (await this.#mappedOne(tx, run.importId, "page", page.parentId)))
              : null;
          const creatorId = (page.creatorId ? creators.get(page.creatorId) : undefined) ?? run.importerId;
          const id = uuidv7();
          const position = await endPosition(tx, space.spaceId, parentId);
          await tx.execute(sql`
            insert into tree_items (id, space_id, parent_id, kind, position, title, mode, creator_id, owner_id,
              created_at, content_updated_at)
            values (${id}, ${space.spaceId}, ${parentId}, 'page', ${position}, ${pageTitle(page)}, 'publish',
              ${creatorId}, ${creatorId}, coalesce(${page.createdAt}::timestamptz, now()),
              coalesce(${page.modifiedAt}::timestamptz, now()))`);
          await tx.execute(sql`
            insert into page_documents (item_id, state, snapshot, schema_version, updated_by)
            values (${id}, ${encodeState(yDocFromDocument({ type: "doc", content: [{ type: "paragraph" }] }))},
              ${JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] })}::jsonb, ${editorSchemaVersion},
              ${creatorId})`);
          await this.#map(tx, run.importId, "page", page.sourceId, id);
          parents.set(page.sourceId, id);
        }
        await signalSpaceChange(tx, { spaceId: space.spaceId, kind: "tree", itemId: null });
      });
      done += pages.length;
      if (created === 0) return;
      await run.progress(done, total);
      await run.beat();
    };
    for await (const page of run.reader.pages(context)) {
      batch.push(page);
      if (batch.length >= PAGE_BATCH) await flush();
    }
    await flush();
  }

  async #mappedIn(
    tx: Transaction,
    importId: string,
    kind: string,
    sourceIds: readonly string[],
  ): Promise<Map<string, string>> {
    const rows = await tx.execute<{ source_id: string; target_id: string }>(sql`
      select source_id, target_id from import_items
      where import_id = ${importId} and kind = ${kind} and source_id = any(${sql.param([...new Set(sourceIds)])}::text[])`);
    return new Map(rows.rows.map((row) => [row.source_id, row.target_id]));
  }

  async #mappedOne(
    tx: Transaction,
    importId: string,
    kind: string,
    sourceId: string,
  ): Promise<string | null> {
    return (await this.#mappedIn(tx, importId, kind, [sourceId])).get(sourceId) ?? null;
  }

  async #attachments(run: PipelineRun): Promise<void> {
    const context: ReadContext = { staging: run.staging };
    const space = await this.#requireSpace(run.importId);
    const limit =
      (await this.#settings.get(maxFileSizeSetting, { organization: run.organizationId })) * MEGABYTE;
    let done = 0;
    let total = 0;
    for await (const _ of run.reader.attachments(context)) total += 1;
    for await (const attachment of run.reader.attachments(context)) {
      done += 1;
      const itemId = (await this.#mapped(run.importId, "page", [attachment.pageId])).get(attachment.pageId);
      if (!itemId) continue;
      const name = cleanFileName(attachment.fileName) ?? `attachment-${attachment.sourceId}`;
      const versions = await this.#mapped(
        run.importId,
        "attachmentVersion",
        attachment.versions.map((version) => version.sourceId),
      );
      const skipped = await this.#mapped(
        run.importId,
        "attachmentSkipped",
        attachment.versions.map((version) => version.sourceId),
      );
      let worked = false;
      const creators = await this.#creators(
        run,
        attachment.versions.map((version) => version.creatorId),
      );
      for (const version of attachment.versions) {
        if (versions.has(version.sourceId) || skipped.has(version.sourceId)) continue;
        worked = true;
        const problem = (code: "attachmentFileMissing" | "attachmentTooLarge" | "attachmentUnreadable") =>
          this.#database.transaction(async (tx) => {
            await recordProblems(tx, run.importId, [
              {
                code,
                sourceKind: "attachment",
                sourceId: version.sourceId,
                itemId,
                details: { fileName: name, version: version.version },
              },
            ]);
            await this.#map(tx, run.importId, "attachmentSkipped", version.sourceId, itemId);
          });
        const stream = version.file ? await run.reader.openFile(run.file, context, version.file) : null;
        if (!stream) {
          await problem("attachmentFileMissing");
          continue;
        }
        let stored: Awaited<ReturnType<FileService["write"]>>;
        try {
          stored = await this.#files.write(stream, { name, maxBytes: limit });
        } catch (error) {
          stream.destroy();
          if (error instanceof FileTooLargeError) {
            await problem("attachmentTooLarge");
            continue;
          }
          if (error instanceof ImportFormatError) {
            await problem("attachmentUnreadable");
            continue;
          }
          throw error;
        }
        const uploader = (version.creatorId ? creators.get(version.creatorId) : undefined) ?? run.importerId;
        try {
          await this.#database.transaction(async (tx) => {
            await tx.execute(sql`select id from tree_items where id = ${itemId} for update`);
            if (await this.#mappedOne(tx, run.importId, "attachmentVersion", version.sourceId)) {
              await tx.execute(sql`update stored_files set state = 'orphaned' where id = ${stored.id}`);
              return;
            }
            const key = fileNameKey(name);
            const existing = await tx.execute<{ id: string }>(sql`
              select id from attachments where item_id = ${itemId} and name_key = ${key} and deleted_at is null`);
            const attachmentId = existing.rows[0]?.id ?? uuidv7();
            if (!existing.rows[0]) {
              await tx.execute(sql`
                insert into attachments (id, item_id, name, name_key, created_by)
                values (${attachmentId}, ${itemId}, ${name}, ${key}, ${uploader})`);
            }
            const fileId = await this.#files.reuse(tx, stored, space.spaceId);
            const next = await tx.execute<{ number: number }>(sql`
              select coalesce(max(number), 0) + 1 as number from attachment_versions
              where attachment_id = ${attachmentId}`);
            const versionId = uuidv7();
            await tx.execute(sql`
              insert into attachment_versions (id, attachment_id, number, file_id, name, uploaded_by, created_at)
              values (${versionId}, ${attachmentId}, ${Number(next.rows[0]?.number ?? 1)}, ${fileId}, ${name},
                ${uploader}, coalesce(${version.createdAt}::timestamptz, now()))`);
            await tx.execute(sql`
              update attachments set current_version_id = ${versionId}, updated_at = now() where id = ${attachmentId}`);
            await this.#map(tx, run.importId, "attachmentVersion", version.sourceId, versionId);
            await this.#map(
              tx,
              run.importId,
              "attachmentName",
              `${attachment.pageId}/${fileNameKey(attachment.fileName)}`,
              attachmentId,
            );
          });
        } catch (error) {
          await this.#database.execute(sql`
            update stored_files set state = 'orphaned', updated_at = now()
            where id = ${stored.id} and not exists (select 1 from attachment_versions v where v.file_id = ${stored.id})`);
          throw error;
        }
      }
      if (!worked) continue;
      await run.progress(done, total);
      await run.beat();
    }
  }

  async #content(run: PipelineRun): Promise<void> {
    const context: ReadContext = { staging: run.staging };
    const sourceSpace = await run.reader.space(context);
    const total = await run.staging.count("page");
    let done = 0;
    let batch: SourcePage[] = [];
    const flush = async () => {
      const pages = batch;
      batch = [];
      const worked = await this.#contentBatch(run, context, sourceSpace.key, pages);
      done += pages.length;
      if (!worked) return;
      await run.progress(done, total);
      await run.beat();
    };
    for await (const page of run.reader.pages(context)) {
      batch.push(page);
      if (batch.length >= CONTENT_BATCH) await flush();
    }
    await flush();
  }

  async #contentBatch(
    run: PipelineRun,
    context: ReadContext,
    sourceKey: string,
    pages: readonly SourcePage[],
  ): Promise<boolean> {
    if (pages.length === 0) return false;
    const ids = pages.map((page) => page.sourceId);
    const finished = await this.#mapped(run.importId, "content", ids);
    const open = pages.filter((page) => !finished.has(page.sourceId));
    if (open.length === 0) return false;
    const items = await this.#mapped(
      run.importId,
      "page",
      open.map((page) => page.sourceId),
    );
    const bodies = await run.reader.bodies(
      context,
      open.map((page) => page.sourceId),
    );
    const labels = await run.reader.labels(
      context,
      open.map((page) => page.sourceId),
    );
    const parsed = new Map<string, Awaited<ReturnType<typeof parseStorage>>>();
    const parseFailures = new Set<string>();
    for (const page of open) {
      try {
        parsed.set(page.sourceId, await parseStorage(bodies.get(page.sourceId)?.content ?? ""));
      } catch {
        parseFailures.add(page.sourceId);
        parsed.set(page.sourceId, { name: "#root", attributes: {}, children: [] });
      }
    }
    const references = [...parsed.values()].map(storageReferences);
    const sameSpace = (reference: { spaceKey: string | null }) =>
      reference.spaceKey === null || reference.spaceKey.toLowerCase() === sourceKey.toLowerCase();
    const titles = references.flatMap((list) =>
      [
        ...list.pages.filter((reference) => reference.title !== null && sameSpace(reference)),
        ...list.attachments
          .filter((reference) => reference.pageTitle !== null && sameSpace(reference))
          .map((reference) => ({ title: reference.pageTitle })),
      ].map((reference) => reference.title as string),
    );
    const byTitle = await run.reader.pagesByTitle(context, titles);
    const sourceIds = references.flatMap((list) =>
      list.pages.map((reference) => reference.sourceId).filter((id): id is string => id !== null),
    );
    const linkedSources = [...byTitle.values(), ...sourceIds];
    const pageTargets = await this.#mapped(run.importId, "page", linkedSources);
    const pageInfo = await this.#pageInfo([...pageTargets.values()]);
    const attachmentKeys = references.flatMap((list, index) => {
      const owner = open[index]?.sourceId ?? "";
      return list.attachments.map((reference) => {
        const page =
          reference.pageTitle === null
            ? owner
            : sameSpace(reference)
              ? (byTitle.get(reference.pageTitle.trim().toLocaleLowerCase("en")) ?? "")
              : "";
        return `${page}/${fileNameKey(reference.fileName)}`;
      });
    });
    const attachments = await this.#mapped(run.importId, "attachmentName", attachmentKeys);
    const attachmentNames = await this.#attachmentNames([...attachments.values()]);
    const mentioned = references.flatMap((list) => list.people);
    const people = await run.reader.resolvePeople(context, mentioned);
    const placeholders = await ensurePlaceholders(
      this.#database,
      this.#audit,
      { organizationId: run.organizationId, importId: run.importId },
      people.filter((person): person is SourcePerson => person !== null),
    );
    const personKeys = new Map<string, string>();
    for (const [index, reference] of mentioned.entries()) {
      const person = people[index];
      if (person)
        personKeys.set(`${reference.accountId ?? ""}\u0000${reference.userKey ?? ""}`, person.sourceId);
    }
    const space = await this.#requireSpace(run.importId);
    const spacePath = `/spaces/${encodeURIComponent(run.spaceKey)}`;
    for (const page of open) {
      const itemId = items.get(page.sourceId);
      if (!itemId) continue;
      const root = parsed.get(page.sourceId) ?? { name: "#root", attributes: {}, children: [] };
      const resolvePage = (reference: PageReference) => {
        const sourceId =
          reference.sourceId ??
          (reference.title !== null && sameSpace(reference)
            ? byTitle.get(reference.title.trim().toLocaleLowerCase("en"))
            : undefined);
        const target = sourceId ? pageTargets.get(sourceId) : undefined;
        const info = target ? pageInfo.get(target) : undefined;
        if (target && info) {
          return {
            kind: "page" as const,
            pageId: target,
            path: `${spacePath}/pages/${target}/${slugify(info)}`,
          };
        }
        return {
          kind: "external" as const,
          href:
            reference.title !== null
              ? originalPageUrl(run.sourceUrl, reference.spaceKey ?? sourceKey, reference.title)
              : null,
        };
      };
      const lookup: StorageLookup = {
        page: resolvePage,
        attachment: (reference) => {
          const owner =
            reference.pageTitle === null
              ? page.sourceId
              : sameSpace(reference)
                ? (byTitle.get(reference.pageTitle.trim().toLocaleLowerCase("en")) ?? "")
                : "";
          const id = attachments.get(`${owner}/${fileNameKey(reference.fileName)}`);
          return id ? { attachmentId: id, name: attachmentNames.get(id) ?? reference.fileName } : null;
        },
        person: (reference) => {
          const sourceId = personKeys.get(`${reference.accountId ?? ""}\u0000${reference.userKey ?? ""}`);
          return sourceId ? (placeholders.get(sourceId) ?? null) : null;
        },
        space: (key) => (key.toLowerCase() === sourceKey.toLowerCase() ? spacePath : null),
        newId: () => uuidv7(),
      };
      const converted = convertStorage(root, lookup);
      const problems: ProblemInput[] = converted.notes.map((note) =>
        noteProblem(note, itemId, page.sourceId),
      );
      if (parseFailures.has(page.sourceId)) {
        problems.push({
          code: "invalidContent",
          sourceKind: "page",
          sourceId: page.sourceId,
          itemId,
          details: { element: "body" },
        });
      }
      for (const [name, count] of converted.macros) {
        problems.push({
          code: "unsupportedMacro",
          sourceKind: "page",
          sourceId: page.sourceId,
          itemId,
          details: { name, count },
        });
      }
      const modifier =
        (page.modifierId
          ? (await this.#mapped(run.importId, "person", [page.modifierId])).get(page.modifierId)
          : undefined) ?? run.importerId;
      await this.#database.transaction(async (tx) => {
        await tx.execute(sql`select id from tree_items where id = ${itemId} for update`);
        if (await this.#mappedOne(tx, run.importId, "content", page.sourceId)) return;
        await this.#writeDocument(tx, itemId, converted.document, converted.tasks, modifier, page.modifiedAt);
        for (const label of labels
          .filter((candidate) => candidate.pageId === page.sourceId)
          .slice(0, MAX_LABELS_PER_PAGE)) {
          let value: string;
          try {
            value = normalizeLabel(label.name);
          } catch {
            problems.push({
              code: "invalidLabel",
              sourceKind: "page",
              sourceId: page.sourceId,
              itemId,
              details: { label: label.name.slice(0, 255) },
            });
            continue;
          }
          await tx.execute(sql`
            insert into page_labels (item_id, label, created_by) values (${itemId}, ${value}, ${modifier})
            on conflict do nothing`);
        }
        await recordProblems(tx, run.importId, problems);
        await this.#map(tx, run.importId, "content", page.sourceId, itemId);
        await signalSpaceChange(tx, { spaceId: space.spaceId, kind: "page", itemId });
      });
    }
    return true;
  }

  async #pageInfo(itemIds: readonly string[]): Promise<Map<string, string>> {
    if (itemIds.length === 0) return new Map();
    const rows = await this.#database.execute<{ id: string; title: string }>(sql`
      select id, title from tree_items where id = any(${sql.param([...new Set(itemIds)])}::uuid[])`);
    return new Map(rows.rows.map((row) => [row.id, row.title]));
  }

  async #attachmentNames(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.#database.execute<{ id: string; name: string }>(sql`
      select id, name from attachments where id = any(${sql.param([...new Set(ids)])}::uuid[])`);
    return new Map(rows.rows.map((row) => [row.id, row.name]));
  }

  async #writeDocument(
    tx: Transaction,
    itemId: string,
    document: DocumentJson,
    tasks: readonly { id: string; done: boolean }[],
    actorId: string,
    modifiedAt: string | null,
  ): Promise<void> {
    const claimed = (await claimTaskIds(tx, itemId, document)) ?? document;
    await tx.execute(sql`
      update page_documents set state = ${encodeState(yDocFromDocument(claimed))}, snapshot = ${JSON.stringify(claimed)}::jsonb,
        schema_version = ${editorSchemaVersion}, revision = revision + 1, updated_by = ${actorId}, updated_at = now()
      where item_id = ${itemId}`);
    await tx.execute(sql`
      update tree_items set content_updated_at = coalesce(${modifiedAt}::timestamptz, now()), updated_at = now()
      where id = ${itemId}`);
    const published = await tx.execute<{ published_version_id: string | null }>(
      sql`select published_version_id from tree_items where id = ${itemId}`,
    );
    if (!published.rows[0]?.published_version_id) await insertFirstVersion(tx, itemId, actorId);
    await recomputeLinks(tx, itemId, claimed);
    await publishTasks(tx, itemId, claimed);
    const claimedIds = taskIds(claimed);
    for (const [index, task] of tasks.entries()) {
      const id = claimedIds.includes(task.id) ? task.id : claimedIds[index];
      if (id && task.done) await writeTaskStatus(tx, { taskId: id, itemId, done: true, actorId: null });
    }
    await refreshReaderVisibility(tx, [itemId]);
  }

  async #finish(run: PipelineRun): Promise<void> {
    const space = await this.#requireSpace(run.importId);
    await this.#database.transaction(async (tx) => {
      const overview = await tx.execute<{ published_version_id: string | null }>(
        sql`select published_version_id from tree_items where id = ${space.overviewId}`,
      );
      if (!overview.rows[0]?.published_version_id) {
        await insertFirstVersion(tx, space.overviewId, run.importerId);
        await refreshReaderVisibility(tx, [space.overviewId]);
      }
      const counts = await tx.execute<{ kind: string; count: number }>(sql`
        select kind, count(*)::int as count from import_items where import_id = ${run.importId} group by kind`);
      const attachments = await tx.execute<{ count: number }>(sql`
        select count(distinct a.id)::int as count from attachments a join tree_items t on t.id = a.item_id
        where t.space_id = ${space.spaceId}`);
      const problems = await tx.execute<{ count: number }>(
        sql`select count(*)::int as count from import_problems where import_id = ${run.importId}`,
      );
      const byKind = Object.fromEntries(counts.rows.map((row) => [row.kind, row.count]));
      await tx.execute(sql`
        update imports set counts = ${JSON.stringify({
          pages: byKind.page ?? 0,
          attachments: attachments.rows[0]?.count ?? 0,
          attachmentVersions: byKind.attachmentVersion ?? 0,
          people: byKind.person ?? 0,
          problems: problems.rows[0]?.count ?? 0,
        })}::jsonb
        where id = ${run.importId}`);
    });
  }
}

function taskIds(node: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }): string[] {
  const own = node.type === "taskItem" && typeof node.attrs?.id === "string" ? [node.attrs.id] : [];
  return [
    ...own,
    ...(
      (node.content ?? []) as { type: string; attrs?: Record<string, unknown>; content?: unknown[] }[]
    ).flatMap(taskIds),
  ];
}
