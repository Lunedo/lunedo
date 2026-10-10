import { type DocumentJson, editorSchemaVersion, extractMentions, slugify } from "@pagehall/editor-schema";
import { yDocFromDocument } from "@pagehall/editor-schema/yjs";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import * as Y from "yjs";
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
import { refreshReaderVisibility } from "../spaces/visibility.js";
import { threadAnchor, toCommentDocument, withoutThreads } from "./comment-document.js";
import {
  type ConversionNote,
  type ConvertedPage,
  convertStorage,
  type PageReference,
  parseStorage,
  type StorageLookup,
  storageReferences,
} from "./confluence/storage.js";
import { ImportFormatError } from "./errors.js";
import type { ByteSource } from "./formats/bytes.js";
import { type Directory, ensurePeople } from "./people.js";
import { ensureGroups, groupKey, roleFor } from "./permissions.js";
import { createQuarantineSpace } from "./quarantine.js";
import { type ProblemInput, recordProblems } from "./report.js";
import type {
  ImportReader,
  ReadContext,
  SourceComment,
  SourcePage,
  SourcePerson,
  SourceRestriction,
} from "./source.js";
import type { StagingStore } from "./staging.js";

export const pipelinePhases = [
  "space",
  "people",
  "pages",
  "attachments",
  "content",
  "comments",
  "reactions",
  "permissions",
  "finish",
] as const;
export type PipelinePhase = (typeof pipelinePhases)[number];

export interface PipelineRun {
  readonly importId: string;
  readonly organizationId: string;
  readonly importerId: string;
  readonly reviewerIds: readonly string[];
  readonly spaceName: string;
  readonly spaceKey: string;
  readonly sourceUrl: string | null;
  readonly history: boolean;
  readonly directory: Directory;
  readonly reader: ImportReader;
  readonly file: ByteSource;
  readonly staging: StagingStore;
  beat(): Promise<void>;
  progress(done: number, total: number): Promise<void>;
}

const PAGE_BATCH = 50;
const CONTENT_BATCH = 20;
const VERSION_BATCH = 10;
const COMMENT_PAGE_BATCH = 20;
const LIKE_BATCH = 200;
const PEOPLE_BATCH = 100;
const MAX_COMMENTS_PER_PAGE = 2000;
const THUMBS_UP = "👍";
const ROOT: Awaited<ReturnType<typeof parseStorage>> = { name: "#root", attributes: {}, children: [] };

type Parsed = Awaited<ReturnType<typeof parseStorage>>;

interface BodyEntry {
  readonly key: string;
  readonly owner: string;
  readonly body: string;
}

interface Converter {
  readonly failed: ReadonlySet<string>;
  convert(key: string, inlineComment?: (ref: string) => string | null): ConvertedPage;
}

function pageTitle(page: Pick<SourcePage, "title" | "sourceId">): string {
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

export function personOf(sourceId: string): Pick<SourcePerson, "sourceId" | "accountId" | "userKey"> {
  return sourceId.startsWith("key:")
    ? { sourceId, accountId: null, userKey: sourceId.slice(4) }
    : { sourceId, accountId: sourceId, userKey: null };
}

function stateVectorOf(document: DocumentJson): Buffer {
  const doc = yDocFromDocument(document);
  const vector = Buffer.from(Y.encodeStateVector(doc));
  doc.destroy();
  return vector;
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
      case "comments":
        return this.#comments(run);
      case "reactions":
        return this.#reactions(run);
      case "permissions":
        return this.#permissions(run);
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

  async #persons(run: PipelineRun, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
    return ensurePeople(
      this.#database,
      this.#audit,
      { organizationId: run.organizationId, importId: run.importId },
      wanted.map(personOf),
      run.directory,
    );
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
    const total = await run.staging.count("user");
    let batch: SourcePerson[] = [];
    let done = 0;
    const flush = async () => {
      const people = batch;
      batch = [];
      done += people.length;
      const known = await this.#mapped(
        run.importId,
        "person",
        people.map((person) => person.sourceId),
      );
      if (people.every((person) => known.has(person.sourceId))) return;
      await ensurePeople(
        this.#database,
        this.#audit,
        { organizationId: run.organizationId, importId: run.importId },
        people,
        run.directory,
      );
      await run.progress(done, Math.max(done, total));
      await run.beat();
    };
    for await (const person of run.reader.people(context)) {
      batch.push(person);
      if (batch.length >= PEOPLE_BATCH) await flush();
    }
    await flush();
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
      const open = pages.filter((page) => !already.has(page.sourceId));
      done += pages.length;
      if (open.length === 0) return;
      const restrictions = await run.reader.restrictions(
        context,
        open.map((page) => page.sourceId),
      );
      const people = await this.#persons(run, [
        ...open.map((page) => page.creatorId),
        ...restrictions.map((restriction) => restriction.personId),
      ]);
      const groups = await ensureGroups(
        this.#database,
        run.importId,
        run.organizationId,
        restrictions.flatMap((restriction) => (restriction.group ? [restriction.group] : [])),
      );
      await this.#database.transaction(async (tx) => {
        const parents = await this.#mappedIn(
          tx,
          run.importId,
          "page",
          open.map((page) => page.parentId ?? ""),
        );
        for (const page of open) {
          let id: string;
          if (page.sourceId === home) {
            id = space.overviewId;
          } else {
            const parentId =
              page.type === "page" && page.parentId && page.parentId !== home
                ? (parents.get(page.parentId) ??
                  (await this.#mappedOne(tx, run.importId, "page", page.parentId)))
                : null;
            const creatorId = (page.creatorId ? people.get(page.creatorId) : undefined) ?? run.importerId;
            id = uuidv7();
            const position = await endPosition(tx, space.spaceId, parentId);
            await tx.execute(sql`
              insert into tree_items (id, space_id, parent_id, kind, position, title, mode, creator_id, owner_id,
                created_at, content_updated_at)
              values (${id}, ${space.spaceId}, ${parentId}, ${page.type}, ${position}, ${pageTitle(page)}, 'publish',
                ${creatorId}, ${creatorId}, coalesce(${page.createdAt}::timestamptz, now()),
                coalesce(${page.modifiedAt}::timestamptz, now()))`);
            await tx.execute(sql`
              insert into page_documents (item_id, state, snapshot, schema_version, updated_by)
              values (${id}, ${encodeState(yDocFromDocument({ type: "doc", content: [{ type: "paragraph" }] }))},
                ${JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] })}::jsonb, ${editorSchemaVersion},
                ${creatorId})`);
            if (page.type === "blogPost") {
              await tx.execute(sql`
                insert into blog_posts (item_id, created_at) values (${id}, coalesce(${page.createdAt}::timestamptz, now()))`);
            }
          }
          await this.#restrict(
            tx,
            run,
            id,
            page.sourceId,
            restrictions.filter((restriction) => restriction.contentId === page.sourceId),
            people,
            groups,
          );
          await this.#map(tx, run.importId, "page", page.sourceId, id);
          parents.set(page.sourceId, id);
        }
        await signalSpaceChange(tx, { spaceId: space.spaceId, kind: "tree", itemId: null });
        await signalSpaceChange(tx, { spaceId: space.spaceId, kind: "access", itemId: null });
      });
      await run.progress(done, total);
      await run.beat();
    };
    for await (const page of run.reader.pages(context)) {
      batch.push(page);
      if (batch.length >= PAGE_BATCH) await flush();
    }
    await flush();
  }

  async #restrict(
    tx: Transaction,
    run: PipelineRun,
    itemId: string,
    pageSourceId: string,
    restrictions: readonly SourceRestriction[],
    people: ReadonlyMap<string, string>,
    groups: ReadonlyMap<string, string | null>,
  ): Promise<void> {
    if (restrictions.length === 0) return;
    const kinds = new Set(restrictions.map((restriction) => restriction.kind));
    for (const kind of kinds) {
      await tx.execute(sql`
        insert into page_restrictions (item_id, kind) values (${itemId}, ${kind}) on conflict do nothing`);
    }
    const holders = new Map<
      string,
      {
        kind: "account" | "group";
        accountId: string | null;
        group: string | null;
        editor: boolean;
        view: boolean;
      }
    >();
    for (const restriction of restrictions) {
      const accountId = restriction.personId ? (people.get(restriction.personId) ?? null) : null;
      const group = restriction.group ? groupKey(restriction.group) : null;
      const key = accountId ? `account:${accountId}` : group ? `group:${group}` : null;
      if (!key) continue;
      const holder = holders.get(key) ?? {
        kind: accountId ? ("account" as const) : ("group" as const),
        accountId,
        group,
        editor: false,
        view: false,
      };
      if (restriction.kind === "edit") holder.editor = true;
      else holder.view = true;
      holders.set(key, holder);
    }
    for (const [key, holder] of holders) {
      const role = holder.editor ? "editor" : "reader";
      const groupId = holder.group ? (groups.get(holder.group) ?? null) : null;
      const principalId = holder.kind === "account" ? holder.accountId : groupId;
      if (principalId) {
        await tx.execute(sql`
          insert into page_shares (id, item_id, principal_kind, principal_id, role)
          values (${uuidv7()}, ${itemId}, ${holder.kind}, ${principalId}, ${role})
          on conflict (item_id, principal_kind, principal_id) do nothing`);
      }
      for (const restriction of [...kinds].filter((kind) =>
        kind === "edit" ? holder.editor : holder.view,
      )) {
        await tx.execute(sql`
          insert into import_grants (id, import_id, source_key, item_id, restriction, holder_kind, account_id,
            group_key, role, status, applied_at)
          values (${uuidv7()}, ${run.importId}, ${`page:${pageSourceId}:${restriction}:${key}`}, ${itemId},
            ${restriction}, ${holder.kind}, ${holder.accountId}, ${holder.group}, ${role}, 'check',
            ${principalId ? sql`now()` : sql`null`})
          on conflict (import_id, source_key) do nothing`);
      }
    }
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
      const creators = await this.#persons(
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

  async #converter(
    run: PipelineRun,
    context: ReadContext,
    sourceKey: string,
    entries: readonly BodyEntry[],
  ): Promise<Converter> {
    const parsed = new Map<string, Parsed>();
    const failed = new Set<string>();
    for (const entry of entries) {
      try {
        parsed.set(entry.key, await parseStorage(entry.body));
      } catch {
        failed.add(entry.key);
        parsed.set(entry.key, ROOT);
      }
    }
    const references = entries.map((entry) => storageReferences(parsed.get(entry.key) ?? ROOT));
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
    const pageTargets = await this.#mapped(run.importId, "page", [...byTitle.values(), ...sourceIds]);
    const pageInfo = await this.#pageInfo([...pageTargets.values()]);
    const attachmentKeys = references.flatMap((list, index) => {
      const owner = entries[index]?.owner ?? "";
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
    const placeholders = await ensurePeople(
      this.#database,
      this.#audit,
      { organizationId: run.organizationId, importId: run.importId },
      people.filter((person): person is SourcePerson => person !== null),
      run.directory,
    );
    const personKeys = new Map<string, string>();
    for (const [index, reference] of mentioned.entries()) {
      const person = people[index];
      if (person)
        personKeys.set(`${reference.accountId ?? ""}\u0000${reference.userKey ?? ""}`, person.sourceId);
    }
    const spacePath = `/spaces/${encodeURIComponent(run.spaceKey)}`;
    const owners = new Map(entries.map((entry) => [entry.key, entry.owner]));
    return {
      failed,
      convert: (key, inlineComment) => {
        const owner = owners.get(key) ?? "";
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
            const page =
              reference.pageTitle === null
                ? owner
                : sameSpace(reference)
                  ? (byTitle.get(reference.pageTitle.trim().toLocaleLowerCase("en")) ?? "")
                  : "";
            const id = attachments.get(`${page}/${fileNameKey(reference.fileName)}`);
            return id ? { attachmentId: id, name: attachmentNames.get(id) ?? reference.fileName } : null;
          },
          person: (reference) => {
            const sourceId = personKeys.get(`${reference.accountId ?? ""}\u0000${reference.userKey ?? ""}`);
            return sourceId ? (placeholders.get(sourceId) ?? null) : null;
          },
          space: (spaceKey) => (spaceKey.toLowerCase() === sourceKey.toLowerCase() ? spacePath : null),
          newId: () => uuidv7(),
          ...(inlineComment ? { inlineComment } : {}),
        };
        return convertStorage(parsed.get(key) ?? ROOT, lookup);
      },
    };
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
    const finished = await this.#mapped(
      run.importId,
      "content",
      pages.map((page) => page.sourceId),
    );
    const open = pages.filter((page) => !finished.has(page.sourceId));
    if (open.length === 0) return false;
    const ids = open.map((page) => page.sourceId);
    const items = await this.#mapped(run.importId, "page", ids);
    const bodies = await run.reader.bodies(context, ids);
    const labels = await run.reader.labels(context, ids);
    const comments = await run.reader.comments(context, ids);
    const markers = new Map<string, Map<string, string>>();
    for (const comment of comments) {
      if (!comment.inline?.markerRef) continue;
      const map = markers.get(comment.pageId) ?? new Map<string, string>();
      if (!map.has(comment.inline.markerRef)) map.set(comment.inline.markerRef, comment.sourceId);
      markers.set(comment.pageId, map);
    }
    const converter = await this.#converter(
      run,
      context,
      sourceKey,
      open.map((page) => ({
        key: page.sourceId,
        owner: page.sourceId,
        body: bodies.get(page.sourceId)?.content ?? "",
      })),
    );
    const modifiers = await this.#persons(
      run,
      open.map((page) => page.modifierId),
    );
    const space = await this.#requireSpace(run.importId);
    for (const page of open) {
      const itemId = items.get(page.sourceId);
      if (!itemId) continue;
      const threads = new Map<string, string>();
      const converted = converter.convert(page.sourceId, (ref) => {
        const commentId = markers.get(page.sourceId)?.get(ref);
        if (!commentId) return null;
        const threadId = threads.get(commentId) ?? uuidv7();
        threads.set(commentId, threadId);
        return threadId;
      });
      const unanchored = new Set<string>();
      for (const [commentId, threadId] of threads) {
        if (!threadAnchor(converted.document, threadId)) {
          unanchored.add(threadId);
          threads.delete(commentId);
        }
      }
      const document = withoutThreads(converted.document, unanchored);
      const problems: ProblemInput[] = converted.notes.map((note) =>
        noteProblem(note, itemId, page.sourceId),
      );
      if (converter.failed.has(page.sourceId)) {
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
      const modifier = (page.modifierId ? modifiers.get(page.modifierId) : undefined) ?? run.importerId;
      const previous = run.history ? await this.#history(run, context, sourceKey, page, itemId) : 0;
      await this.#database.transaction(async (tx) => {
        await tx.execute(sql`select id from tree_items where id = ${itemId} for update`);
        if (await this.#mappedOne(tx, run.importId, "content", page.sourceId)) return;
        await this.#writeDocument(tx, {
          itemId,
          document,
          tasks: converted.tasks,
          actorId: modifier,
          modifiedAt: page.modifiedAt,
          number: previous + 1,
        });
        if (page.type === "blogPost") {
          await tx.execute(sql`
            update blog_posts set published_at = coalesce(${page.createdAt}::timestamptz, now()), updated_at = now()
            where item_id = ${itemId}`);
        }
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
        for (const [commentId, threadId] of threads) {
          await this.#map(tx, run.importId, "commentThread", commentId, threadId);
        }
        await recordProblems(tx, run.importId, problems);
        await this.#map(tx, run.importId, "content", page.sourceId, itemId);
        await signalSpaceChange(tx, { spaceId: space.spaceId, kind: "page", itemId });
      });
    }
    return true;
  }

  async #history(
    run: PipelineRun,
    context: ReadContext,
    sourceKey: string,
    page: SourcePage,
    itemId: string,
  ): Promise<number> {
    let number = 0;
    let batch: { sourceId: string; title: string; authorId: string | null; createdAt: string | null }[] = [];
    const flush = async () => {
      const versions = batch;
      batch = [];
      if (versions.length === 0) return;
      const start = number;
      number += versions.length;
      const done = await this.#mapped(
        run.importId,
        "version",
        versions.map((version) => version.sourceId),
      );
      const open = versions.filter((version) => !done.has(version.sourceId));
      if (open.length === 0) return;
      const bodies = await run.reader.bodies(
        context,
        open.map((version) => version.sourceId),
      );
      const converter = await this.#converter(
        run,
        context,
        sourceKey,
        open.map((version) => ({
          key: version.sourceId,
          owner: page.sourceId,
          body: bodies.get(version.sourceId)?.content ?? "",
        })),
      );
      const authors = await this.#persons(
        run,
        open.map((version) => version.authorId),
      );
      await this.#database.transaction(async (tx) => {
        await tx.execute(sql`select id from tree_items where id = ${itemId} for update`);
        for (const [index, version] of versions.entries()) {
          if (done.has(version.sourceId)) continue;
          if (await this.#mappedOne(tx, run.importId, "version", version.sourceId)) continue;
          const document = converter.convert(version.sourceId).document;
          const author = (version.authorId ? authors.get(version.authorId) : undefined) ?? run.importerId;
          const id = uuidv7();
          await tx.execute(sql`
            insert into page_versions (id, item_id, number, title, document, schema_version, reason, revision,
              state_vector, contributors, created_by, created_at)
            values (${id}, ${itemId}, ${start + index + 1}, ${pageTitle({ title: version.title, sourceId: page.sourceId })},
              ${JSON.stringify(document)}::jsonb, ${editorSchemaVersion}, 'published', 0, ${stateVectorOf(document)},
              ${sql.param([author])}::uuid[], ${author}, coalesce(${version.createdAt}::timestamptz, now()))`);
          await this.#map(tx, run.importId, "version", version.sourceId, id);
        }
      });
      await run.beat();
    };
    for await (const version of run.reader.versions(context, page.sourceId)) {
      batch.push(version);
      if (batch.length >= VERSION_BATCH) await flush();
    }
    await flush();
    return number;
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
    input: {
      itemId: string;
      document: DocumentJson;
      tasks: readonly { id: string; done: boolean }[];
      actorId: string;
      modifiedAt: string | null;
      number: number;
    },
  ): Promise<void> {
    const { itemId, actorId } = input;
    const claimed = (await claimTaskIds(tx, itemId, input.document)) ?? input.document;
    const state = encodeState(yDocFromDocument(claimed));
    await tx.execute(sql`
      update page_documents set state = ${state}, snapshot = ${JSON.stringify(claimed)}::jsonb,
        schema_version = ${editorSchemaVersion}, revision = revision + 1, updated_by = ${actorId}, updated_at = now()
      where item_id = ${itemId}`);
    await tx.execute(sql`
      update tree_items set content_updated_at = coalesce(${input.modifiedAt}::timestamptz, now()), updated_at = now()
      where id = ${itemId}`);
    const published = await tx.execute<{ published_version_id: string | null }>(
      sql`select published_version_id from tree_items where id = ${itemId}`,
    );
    if (!published.rows[0]?.published_version_id) {
      await insertCurrentVersion(tx, itemId, {
        number: input.number,
        actorId,
        createdAt: input.modifiedAt,
      });
    }
    await recomputeLinks(tx, itemId, claimed);
    await publishTasks(tx, itemId, claimed);
    await tx.execute(sql`
      update tasks set notified_assignee_id = assignee_id where item_id = ${itemId} and assignee_id is not null`);
    await markMentionsNotified(tx, itemId, null, extractMentions(claimed), actorId);
    const claimedIds = taskIds(claimed);
    for (const [index, task] of input.tasks.entries()) {
      const id = claimedIds.includes(task.id) ? task.id : claimedIds[index];
      if (id && task.done) await writeTaskStatus(tx, { taskId: id, itemId, done: true, actorId: null });
    }
    await refreshReaderVisibility(tx, [itemId]);
  }

  async #comments(run: PipelineRun): Promise<void> {
    const context: ReadContext = { staging: run.staging };
    const sourceSpace = await run.reader.space(context);
    const total = await run.staging.count("page");
    let done = 0;
    let batch: SourcePage[] = [];
    const flush = async () => {
      const pages = batch;
      batch = [];
      done += pages.length;
      const worked = await this.#commentBatch(run, context, sourceSpace.key, pages);
      if (!worked) return;
      await run.progress(done, total);
      await run.beat();
    };
    for await (const page of run.reader.pages(context)) {
      batch.push(page);
      if (batch.length >= COMMENT_PAGE_BATCH) await flush();
    }
    await flush();
  }

  async #commentBatch(
    run: PipelineRun,
    context: ReadContext,
    sourceKey: string,
    pages: readonly SourcePage[],
  ): Promise<boolean> {
    if (pages.length === 0) return false;
    const all = await run.reader.comments(
      context,
      pages.map((page) => page.sourceId),
    );
    if (all.length === 0) return false;
    const finished = await this.#mapped(
      run.importId,
      "comment",
      all.map((comment) => comment.sourceId),
    );
    const skipped = await this.#mapped(
      run.importId,
      "commentSkipped",
      all.map((comment) => comment.sourceId),
    );
    const open = all.filter((comment) => !finished.has(comment.sourceId) && !skipped.has(comment.sourceId));
    if (open.length === 0) return false;
    const items = await this.#mapped(
      run.importId,
      "page",
      open.map((comment) => comment.pageId),
    );
    const threads = await this.#mapped(
      run.importId,
      "commentThread",
      open.map((comment) => comment.sourceId),
    );
    const bodies = await run.reader.bodies(
      context,
      open.map((comment) => comment.sourceId),
    );
    const converter = await this.#converter(
      run,
      context,
      sourceKey,
      open.map((comment) => ({
        key: comment.sourceId,
        owner: comment.pageId,
        body: bodies.get(comment.sourceId)?.content ?? "",
      })),
    );
    const people = await this.#persons(run, [
      ...open.map((comment) => comment.authorId),
      ...open.map((comment) => comment.resolvedById),
    ]);
    const space = await this.#requireSpace(run.importId);
    const documents = new Map<string, DocumentJson>();
    for (const comment of open) {
      const itemId = items.get(comment.pageId);
      if (!itemId) continue;
      await this.#database.transaction(async (tx) => {
        await tx.execute(sql`select id from tree_items where id = ${itemId} for update`);
        if (await this.#mappedOne(tx, run.importId, "comment", comment.sourceId)) return;
        const count = await tx.execute<{ count: number }>(
          sql`select count(*)::int as count from comments where item_id = ${itemId}`,
        );
        if ((count.rows[0]?.count ?? 0) >= MAX_COMMENTS_PER_PAGE) {
          await recordProblems(tx, run.importId, [
            { code: "tooManyComments", sourceKind: "comment", sourceId: comment.sourceId, itemId },
          ]);
          await this.#map(tx, run.importId, "commentSkipped", comment.sourceId, itemId);
          return;
        }
        await this.#insertComment(tx, run, {
          comment,
          itemId,
          converted: converter.convert(comment.sourceId).document,
          threadId: threads.get(comment.sourceId) ?? null,
          people,
          documents,
        });
      });
    }
    await signalSpaceChange(this.#database, { spaceId: space.spaceId, kind: "comments", itemId: null });
    return true;
  }

  async #insertComment(
    tx: Transaction,
    run: PipelineRun,
    input: {
      comment: SourceComment;
      itemId: string;
      converted: DocumentJson;
      threadId: string | null;
      people: ReadonlyMap<string, string>;
      documents: Map<string, DocumentJson>;
    },
  ): Promise<void> {
    const { comment, itemId } = input;
    const author = comment.authorId ? (input.people.get(comment.authorId) ?? null) : null;
    let parentId: string | null = null;
    if (comment.parentId) {
      const parent = await this.#mappedOne(tx, run.importId, "comment", comment.parentId);
      if (parent) {
        const root = await tx.execute<{ root: string }>(
          sql`select coalesce(parent_id, id) as root from comments where id = ${parent} and item_id = ${itemId}`,
        );
        parentId = root.rows[0]?.root ?? null;
      }
    }
    let anchor: { exact: string; prefix: string; suffix: string } | null = null;
    if (!parentId && input.threadId) {
      let document = input.documents.get(itemId);
      if (!document) {
        const snapshot = await tx.execute<{ snapshot: DocumentJson }>(
          sql`select snapshot from page_documents where item_id = ${itemId}`,
        );
        document = snapshot.rows[0]?.snapshot ?? { type: "doc", content: [] };
        input.documents.set(itemId, document);
      }
      anchor = threadAnchor(document, input.threadId);
    }
    const moved = !parentId && !anchor && comment.inline !== null;
    const quote = moved ? (comment.inline?.selection?.trim() ?? "") || null : null;
    const body = toCommentDocument(input.converted, quote);
    const id = anchor && input.threadId ? input.threadId : uuidv7();
    const resolved = anchor !== null && comment.status === "resolved";
    const resolvedBy = resolved
      ? ((comment.resolvedById ? input.people.get(comment.resolvedById) : undefined) ?? author)
      : null;
    await tx.execute(sql`
      insert into comments (id, item_id, parent_id, author_id, body, quote, quote_prefix, quote_suffix, quote_public,
        resolved_at, resolved_by, created_at, updated_at)
      values (${id}, ${itemId}, ${parentId}, ${author}, ${JSON.stringify(body)}::jsonb, ${anchor?.exact ?? null},
        ${anchor?.prefix ?? null}, ${anchor?.suffix ?? null}, ${anchor !== null},
        ${resolved ? sql`coalesce(${comment.resolvedAt ?? comment.modifiedAt}::timestamptz, now())` : sql`null`},
        ${resolvedBy}, coalesce(${comment.createdAt}::timestamptz, now()),
        coalesce(${comment.modifiedAt ?? comment.createdAt}::timestamptz, now()))`);
    await markMentionsNotified(tx, itemId, id, extractMentions(body), author);
    if (moved) {
      await recordProblems(tx, run.importId, [
        {
          code: "inlineCommentMoved",
          sourceKind: "comment",
          sourceId: comment.sourceId,
          itemId,
          details: { quote: (quote ?? "").slice(0, 255) },
        },
      ]);
    }
    await this.#map(tx, run.importId, "comment", comment.sourceId, id);
  }

  async #reactions(run: PipelineRun): Promise<void> {
    const context: ReadContext = { staging: run.staging };
    const total = await run.staging.count("like");
    let done = 0;
    let batch: { sourceId: string; contentId: string; personId: string | null; createdAt: string | null }[] =
      [];
    const flush = async () => {
      const likes = batch;
      batch = [];
      done += likes.length;
      const finished = await this.#mapped(
        run.importId,
        "like",
        likes.map((like) => like.sourceId),
      );
      const open = likes.filter((like) => like.personId !== null && !finished.has(like.sourceId));
      if (open.length === 0) return;
      const people = await this.#persons(
        run,
        open.map((like) => like.personId),
      );
      const pages = await this.#mapped(
        run.importId,
        "page",
        open.map((like) => like.contentId),
      );
      const comments = await this.#mapped(
        run.importId,
        "comment",
        open.map((like) => like.contentId),
      );
      const commentItems = new Map<string, string>();
      if (comments.size > 0) {
        const rows = await this.#database.execute<{ id: string; item_id: string }>(sql`
          select id, item_id from comments where id = any(${sql.param([...comments.values()])}::uuid[])`);
        for (const row of rows.rows) commentItems.set(row.id, row.item_id);
      }
      await this.#database.transaction(async (tx) => {
        for (const like of open) {
          const accountId = like.personId ? people.get(like.personId) : undefined;
          if (!accountId) continue;
          const commentId = comments.get(like.contentId) ?? null;
          const itemId = commentId ? commentItems.get(commentId) : pages.get(like.contentId);
          if (!itemId) continue;
          await tx.execute(sql`
            insert into reactions (item_id, comment_id, account_id, emoji, created_at)
            values (${itemId}, ${commentId}, ${accountId}, ${THUMBS_UP}, coalesce(${like.createdAt}::timestamptz, now()))
            on conflict do nothing`);
          await this.#map(tx, run.importId, "like", like.sourceId, itemId);
        }
      });
      await run.progress(done, total);
      await run.beat();
    };
    for await (const like of run.reader.likes(context)) {
      batch.push(like);
      if (batch.length >= LIKE_BATCH) await flush();
    }
    await flush();
  }

  async #permissions(run: PipelineRun): Promise<void> {
    const context: ReadContext = { staging: run.staging };
    const holders = new Map<
      string,
      {
        kind: "account" | "group" | "organizationMembers" | "anonymous";
        personId: string | null;
        group: string | null;
        permissions: Set<string>;
      }
    >();
    for await (const permission of run.reader.spacePermissions(context)) {
      const key = permission.personId
        ? `user:${permission.personId}`
        : permission.group
          ? `group:${groupKey(permission.group)}`
          : permission.allUsers
            ? "allUsers"
            : "anonymous";
      const holder = holders.get(key) ?? {
        kind: permission.personId
          ? ("account" as const)
          : permission.group
            ? ("group" as const)
            : permission.allUsers
              ? ("organizationMembers" as const)
              : ("anonymous" as const),
        personId: permission.personId,
        group: permission.group,
        permissions: new Set<string>(),
      };
      if (permission.type) holder.permissions.add(permission.type.slice(0, 50));
      holders.set(key, holder);
    }
    const all = [...holders.entries()];
    const people = await this.#persons(
      run,
      all.map(([, holder]) => holder.personId),
    );
    await ensureGroups(
      this.#database,
      run.importId,
      run.organizationId,
      all.flatMap(([, holder]) => (holder.group ? [holder.group] : [])),
    );
    await this.#database.transaction(async (tx) => {
      for (const [key, holder] of all) {
        const decision =
          holder.kind === "anonymous"
            ? { role: null, status: "notTaken" as const, code: "anonymous" }
            : roleFor(holder.permissions);
        const accountId = holder.personId ? (people.get(holder.personId) ?? null) : null;
        if (holder.kind === "account" && !accountId) continue;
        await tx.execute(sql`
          insert into import_grants (id, import_id, source_key, holder_kind, account_id, group_key, role,
            permissions, status, code)
          values (${uuidv7()}, ${run.importId}, ${`space:${key}`}, ${holder.kind}, ${accountId},
            ${holder.group ? groupKey(holder.group) : null}, ${decision.role},
            ${sql.param([...holder.permissions].sort())}::text[], ${decision.status}, ${decision.code})
          on conflict (import_id, source_key) do nothing`);
      }
    });
  }

  async #finish(run: PipelineRun): Promise<void> {
    const space = await this.#requireSpace(run.importId);
    await this.#database.transaction(async (tx) => {
      const overview = await tx.execute<{ published_version_id: string | null }>(
        sql`select published_version_id from tree_items where id = ${space.overviewId}`,
      );
      if (!overview.rows[0]?.published_version_id) {
        await insertCurrentVersion(tx, space.overviewId, {
          number: 1,
          actorId: run.importerId,
          createdAt: null,
        });
        await refreshReaderVisibility(tx, [space.overviewId]);
      }
      const counts = await tx.execute<Record<string, number>>(sql`
        select
          (select count(*) from tree_items where space_id = ${space.spaceId} and kind = 'page')::int as pages,
          (select count(*) from tree_items where space_id = ${space.spaceId} and kind = 'blogPost')::int as blog_posts,
          (select count(*) from page_versions v join tree_items t on t.id = v.item_id
            where t.space_id = ${space.spaceId})::int as versions,
          (select count(distinct a.id) from attachments a join tree_items t on t.id = a.item_id
            where t.space_id = ${space.spaceId})::int as attachments,
          (select count(*) from import_items where import_id = ${run.importId} and kind = 'attachmentVersion')::int
            as attachment_versions,
          (select count(*) from comments c join tree_items t on t.id = c.item_id
            where t.space_id = ${space.spaceId})::int as comments,
          (select count(*) from comments c join tree_items t on t.id = c.item_id
            where t.space_id = ${space.spaceId} and c.quote is not null)::int as inline_anchored,
          (select count(*) from import_problems where import_id = ${run.importId} and code = 'inlineCommentMoved')::int
            as inline_moved,
          (select count(*) from reactions r join tree_items t on t.id = r.item_id
            where t.space_id = ${space.spaceId})::int as likes,
          (select count(*) from import_items where import_id = ${run.importId} and kind = 'person')::int as people,
          (select count(*) from import_items i join accounts a on a.id = i.target_id
            where i.import_id = ${run.importId} and i.kind = 'person' and a.state <> 'placeholder')::int as people_matched,
          (select count(*) from page_restrictions r join tree_items t on t.id = r.item_id
            where t.space_id = ${space.spaceId})::int as restrictions,
          (select count(*) from import_groups where import_id = ${run.importId} and group_id is null)::int
            as groups_missing,
          (select count(*) from import_problems where import_id = ${run.importId})::int as problems,
          coalesce((select (found ->> 'watchers')::int from imports where id = ${run.importId}), 0) as watchers`);
      const row = counts.rows[0] ?? {};
      await tx.execute(sql`
        update imports set counts = ${JSON.stringify({
          pages: row.pages ?? 0,
          blogPosts: row.blog_posts ?? 0,
          versions: row.versions ?? 0,
          attachments: row.attachments ?? 0,
          attachmentVersions: row.attachment_versions ?? 0,
          comments: row.comments ?? 0,
          inlineAnchored: row.inline_anchored ?? 0,
          inlineMoved: row.inline_moved ?? 0,
          likes: row.likes ?? 0,
          watchers: row.watchers ?? 0,
          people: row.people ?? 0,
          peopleMatched: row.people_matched ?? 0,
          restrictions: row.restrictions ?? 0,
          groupsMissing: row.groups_missing ?? 0,
          problems: row.problems ?? 0,
        })}::jsonb
        where id = ${run.importId}`);
    });
  }
}

export async function insertCurrentVersion(
  tx: Transaction,
  itemId: string,
  input: { number: number; actorId: string | null; createdAt: string | null },
): Promise<void> {
  const result = await tx.execute<{ title: string; state: Buffer; snapshot: unknown; revision: number }>(sql`
    select t.title, d.state, d.snapshot, d.revision from tree_items t join page_documents d on d.item_id = t.id
    where t.id = ${itemId}`);
  const row = result.rows[0];
  if (!row) throw new Error("The page is missing");
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(row.state));
  const stateVector = Buffer.from(Y.encodeStateVector(doc));
  doc.destroy();
  const id = uuidv7();
  await tx.execute(sql`
    insert into page_versions (id, item_id, number, title, document, schema_version, reason, revision, state_vector,
      contributors, created_by, created_at)
    values (${id}, ${itemId}, ${input.number}, ${row.title}, ${JSON.stringify(row.snapshot)}::jsonb,
      ${editorSchemaVersion}, 'published', ${row.revision}, ${stateVector},
      ${sql.param(input.actorId ? [input.actorId] : [])}::uuid[], ${input.actorId},
      coalesce(${input.createdAt}::timestamptz, now()))`);
  await tx.execute(sql`update page_documents set versioned_revision = revision where item_id = ${itemId}`);
  await tx.execute(sql`update tree_items set published_version_id = ${id} where id = ${itemId}`);
}

export async function markMentionsNotified(
  tx: Transaction,
  itemId: string,
  commentId: string | null,
  mentioned: readonly string[],
  actorId: string | null,
): Promise<void> {
  const unique = [...new Set(mentioned)];
  if (unique.length === 0) return;
  await tx.execute(sql`
    insert into content_mentions (id, item_id, comment_id, account_id, actor_id, notified_at)
    select m.id, ${itemId}, ${commentId}, coalesce(a.merged_into_id, a.id), ${actorId}, now()
    from unnest(${sql.param(unique.map(() => uuidv7()))}::uuid[], ${sql.param(unique)}::uuid[]) as m(id, account_id)
    join accounts a on a.id = m.account_id
    on conflict do nothing`);
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
