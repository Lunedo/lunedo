import { createHash } from "node:crypto";
import {
  type DocumentJson,
  editorSchemaVersion,
  extractMentions,
  type ImportText,
  narrowEmbedServices,
  resolveEmbed,
} from "@lunedo/editor-schema";
import { yDocFromDocument } from "@lunedo/editor-schema/yjs";
import { uuidv7 } from "@lunedo/shared";
import { sql } from "drizzle-orm";
import * as Y from "yjs";
import { accountPrincipal } from "../accounts/principal.js";
import { accountScopeChain } from "../accounts/scope.js";
import type { AuditLog } from "../audit/audit-log.js";
import { claimTaskIds, publishTasks, syncDecisions } from "../collaboration/content.js";
import { writeTaskStatus } from "../collaboration/tasks.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import { allowedEmbedServicesSetting, embedServicesSetting } from "../embeds/settings.js";
import { type FileService, FileTooLargeError } from "../files/files.js";
import { cleanFileName, fileNameKey } from "../files/names.js";
import { MEGABYTE, maxFileSizeSetting } from "../files/settings.js";
import { isArticleLanguage } from "../knowledge-bases/translations.js";
import { languageSetting } from "../settings/builtin.js";
import type { SettingsService } from "../settings/service.js";
import { itemAddress } from "../spaces/addresses.js";
import { encodeState, MAX_LABELS_PER_PAGE, normalizeLabel, recomputeLinks } from "../spaces/documents.js";
import { cleanLinkUrl, endPosition, ITEM_TITLE_MAX_LENGTH, lockSpaces } from "../spaces/items.js";
import { syncReusableContent } from "../spaces/properties.js";
import { signalSpaceChange } from "../spaces/signals.js";
import { applyImportedStatus } from "../spaces/status.js";
import type { TrashService } from "../spaces/trash.js";
import type { VersionService } from "../spaces/versions.js";
import { refreshReaderVisibility } from "../spaces/visibility.js";
import { type TemplateLanguage, templateLanguages } from "../templates/builtin/types.js";
import type { TemplateField } from "../templates/fields.js";
import type { TemplateFileService } from "../templates/files.js";
import {
  TEMPLATE_DESCRIPTION_MAX_LENGTH,
  TEMPLATE_NAME_MAX_LENGTH,
  TEMPLATE_TITLE_MAX_LENGTH,
} from "../templates/templates.js";
import {
  pageBaselines,
  pageStatesOf,
  recordHolderBaselines,
  recordImportedSpace,
  recordPageBaselines,
  recordTemplateBaselines,
  recordTitles,
  type SourcePageState,
  sourceHolders,
  sourceParent,
  templateState,
  updateSourceSide,
} from "./baselines.js";
import { threadAnchor, toCommentDocument, withoutThreads } from "./comment-document.js";
import { titleKey } from "./confluence/staged.js";
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
import { importText, jiraIssueUrl } from "./import-texts.js";
import { heldBy, Narrowing, pendingNarrowing } from "./narrowing.js";
import { type Directory, ensurePeople, personOf } from "./people.js";
import { ensureGroups, grantsAccess, groupKey, roleFor } from "./permissions.js";
import { createQuarantineSpace } from "./quarantine.js";
import {
  type ChangeDecision,
  type ChangeType,
  changedLocally,
  lineageImports,
  localPages,
  openSessions,
} from "./reimport-compare.js";
import { type ProblemInput, recordProblems } from "./report.js";
import {
  type ImportReader,
  type ReadContext,
  type SourceComment,
  type SourcePage,
  type SourcePerson,
  type SourceRestriction,
  type SourceTemplate,
  sourceFamily,
} from "./source.js";
import type { StagingStore } from "./staging.js";
import {
  addButtonFields,
  IMPORTED_TEMPLATE_CATEGORY,
  mergeFields,
  type TemplateVariables,
  templateVariables,
} from "./templates.js";

export const pipelinePhases = [
  "space",
  "people",
  "pages",
  "attachments",
  "templates",
  "content",
  "comments",
  "reactions",
  "permissions",
  "baseline",
  "finish",
] as const;
export const reimportPhases = [
  "lineage",
  "people",
  "pages",
  "moves",
  "attachments",
  "templates",
  "content",
  "labels",
  "comments",
  "reactions",
  "deletions",
  "baseline",
  "finish",
] as const;
export type PipelinePhase = (typeof pipelinePhases)[number] | (typeof reimportPhases)[number];

export interface ReimportRun {
  readonly spaceId: string;
  readonly actorId: string;
  editable(executor: Executor, itemIds: readonly string[]): Promise<Set<string>>;
}

interface ChangeEntry {
  readonly id: string;
  readonly sourceId: string;
  readonly change: ChangeType;
  readonly itemId: string | null;
  readonly targetId: string | null;
  readonly details: Record<string, unknown>;
  readonly decision: ChangeDecision | null;
}

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
  readonly reimport: ReimportRun | null;
  readonly knowledgeBase?: boolean;
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
  readonly variables?: ReadonlyMap<string, string>;
}

type ConverterRun = Pick<PipelineRun, "importId" | "organizationId" | "spaceKey" | "sourceUrl" | "reader"> & {
  readonly directory?: Directory;
  readonly preview?: readonly string[];
};

export type PreviewRun = Pick<
  PipelineRun,
  "importId" | "organizationId" | "spaceKey" | "sourceUrl" | "reader" | "staging"
> & { readonly lineage: readonly string[] };

interface Converter {
  readonly failed: ReadonlySet<string>;
  convert(key: string, inlineComment?: (ref: string) => string | null): ConvertedPage;
}

function pageTitle(page: Pick<SourcePage, "title" | "sourceId">): string {
  const title = page.title.replace(/\s+/g, " ").trim().slice(0, ITEM_TITLE_MAX_LENGTH);
  return title.length > 0 ? title : `Page ${page.sourceId}`.slice(0, ITEM_TITLE_MAX_LENGTH);
}

function stableId(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex");
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
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
    case "diagramFileMissing":
      return { ...base, code: note.code, details: { macro: note.macro, name: note.name.slice(0, 255) } };
    case "gliffyDiagram":
    case "diagramPageMissing":
      return { ...base, code: note.code, details: { name: note.name.slice(0, 255) } };
    case "unmappedQuery":
      return { ...base, code: note.code, details: { macro: note.macro, query: note.query.slice(0, 255) } };
    case "macroOptionDropped":
      return { ...base, code: note.code, details: { macro: note.macro, option: note.option.slice(0, 50) } };
    case "unresolvedInclude":
      return {
        ...base,
        code: note.code,
        details: { macro: note.macro, title: note.title.slice(0, 255), spaceKey: note.spaceKey },
      };
    case "embedNotAllowed":
      return { ...base, code: note.code, details: { macro: note.macro, url: note.url.slice(0, 255) } };
    case "previewOnly":
    case "previewMissing":
      return { ...base, code: note.code, details: { macro: note.macro, name: note.name.slice(0, 255) } };
    case "chartNotImported":
      return { ...base, code: note.code, details: { macro: note.macro } };
    case "jiraNotImported":
      return { ...base, code: note.code, details: { macro: note.macro, issues: note.issues.slice(0, 255) } };
    default:
      return { ...base, code: note.code };
  }
}

export function originalPageUrl(base: string | null, spaceKey: string, title: string): string | null {
  if (!base) return null;
  const root = base.replace(/\/+$/, "");
  return `${root}/display/${encodeURIComponent(spaceKey)}/${encodeURIComponent(title).replaceAll("%20", "+")}`;
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
  readonly #versions: VersionService;
  readonly #trash: TrashService;
  readonly #templateFiles: TemplateFileService | undefined;

  constructor(options: {
    database: Database;
    files: FileService;
    settings: SettingsService;
    audit: AuditLog;
    versions: VersionService;
    trash: TrashService;
    templateFiles?: TemplateFileService | undefined;
  }) {
    this.#templateFiles = options.templateFiles;
    this.#database = options.database;
    this.#files = options.files;
    this.#settings = options.settings;
    this.#audit = options.audit;
    this.#versions = options.versions;
    this.#trash = options.trash;
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
      case "templates":
        return this.#templates(run);
      case "content":
        return this.#content(run);
      case "comments":
        return this.#comments(run);
      case "reactions":
        return this.#reactions(run);
      case "permissions":
        return this.#permissions(run);
      case "baseline":
        return run.reimport ? this.#reimportBaseline(run, run.reimport) : this.#baseline(run);
      case "finish":
        return run.reimport ? undefined : this.#finish(run);
      case "lineage":
        return run.reimport ? this.#lineage(run, run.reimport) : undefined;
      case "moves":
        return run.reimport ? this.#moves(run, run.reimport) : undefined;
      case "labels":
        return run.reimport ? this.#labels(run, run.reimport) : undefined;
      case "deletions":
        return run.reimport ? this.#deletions(run, run.reimport) : undefined;
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

  async #lookup(
    run: ConverterRun,
    kind: string,
    sourceIds: readonly string[] | null,
  ): Promise<Map<string, string>> {
    if (!run.preview) {
      return sourceIds ? this.#mapped(run.importId, kind, sourceIds) : this.#allMapped(run.importId, kind);
    }
    if (sourceIds?.length === 0 || run.preview.length === 0) return new Map();
    const rows = await this.#database.execute<{ source_id: string; target_id: string }>(sql`
      select distinct on (source_id) source_id, target_id from import_items
      where import_id = any(${sql.param([...run.preview])}::uuid[]) and kind = ${kind}
        ${sourceIds ? sql`and source_id = any(${sql.param([...new Set(sourceIds)])}::text[])` : sql``}
      order by source_id, created_at desc`);
    return new Map(rows.rows.map((row) => [row.source_id, row.target_id]));
  }

  async previewSource(
    run: PreviewRun,
    target: { kind: "page" | "template"; sourceId: string },
  ): Promise<DocumentJson | null> {
    const context: ReadContext = { staging: run.staging };
    const preview = { ...run, preview: run.lineage };
    const sourceSpace = await run.reader.space(context);
    if (target.kind === "template") {
      let template: SourceTemplate | null = null;
      for await (const entry of run.reader.templates(context)) {
        if (entry.sourceId === target.sourceId) {
          template = entry;
          break;
        }
      }
      if (!template) return null;
      let variables: ReadonlyMap<string, string> = new Map();
      try {
        variables = templateVariables(await parseStorage(template.body)).variables;
      } catch {
        variables = new Map();
      }
      const converter = await this.#converter(preview, context, sourceSpace.key, [
        { key: template.sourceId, owner: "", body: template.body, variables },
      ]);
      return converter.convert(template.sourceId).document;
    }
    const body = (await run.reader.bodies(context, [target.sourceId])).get(target.sourceId);
    if (!body) return null;
    const comments = await run.reader.comments(context, [target.sourceId]);
    const threads = await this.#lookup(
      preview,
      "comment",
      comments.map((comment) => comment.sourceId),
    );
    const markers = new Map<string, string>();
    for (const comment of comments) {
      const ref = comment.inline?.markerRef;
      if (ref && !markers.has(ref)) markers.set(ref, comment.sourceId);
    }
    const converter = await this.#converter(preview, context, sourceSpace.key, [
      { key: target.sourceId, owner: target.sourceId, body: body.content },
    ]);
    return converter.convert(target.sourceId, (ref) => {
      const commentId = markers.get(ref);
      return commentId ? (threads.get(commentId) ?? null) : null;
    }).document;
  }

  async #allMapped(importId: string, kind: string): Promise<Map<string, string>> {
    const rows = await this.#database.execute<{ source_id: string; target_id: string }>(sql`
      select source_id, target_id from import_items where import_id = ${importId} and kind = ${kind}`);
    return new Map(rows.rows.map((row) => [row.source_id, row.target_id]));
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

  async #refusedTranslation(
    tx: Transaction,
    spaceId: string,
    originalId: string,
    language: string,
    addLanguage: boolean,
  ): Promise<"unknown" | "defaultLanguage" | "duplicate" | "notEnabled" | null> {
    if (!isArticleLanguage(language)) return "unknown";
    const found = await tx.execute<{ default_language: string; enabled: boolean; taken: boolean }>(sql`
      select kb.default_language, ${language} = any(kb.languages) as enabled,
        exists (select 1 from tree_items t where t.translation_of = ${originalId} and t.content_language = ${language}) as taken
      from knowledge_bases kb where kb.space_id = ${spaceId} for update`);
    const row = found.rows[0];
    if (!row || row.default_language === language) return "defaultLanguage";
    if (row.taken) return "duplicate";
    if (row.enabled) return null;
    if (!addLanguage) return "notEnabled";
    await tx.execute(sql`
      update knowledge_bases set languages = array_append(languages, ${language}), updated_at = now()
      where space_id = ${spaceId}`);
    return null;
  }

  async #adoptLanguage(tx: Transaction, spaceId: string, language: string): Promise<void> {
    if (!isArticleLanguage(language)) return;
    await tx.execute(sql`
      update knowledge_bases set default_language = ${language}, languages = array[${language}]::text[], updated_at = now()
      where space_id = ${spaceId} and default_language <> ${language}
        and not exists (select 1 from tree_items t where t.space_id = ${spaceId} and t.kind = 'page')`);
  }

  async #placeableInKnowledgeBase(
    tx: Transaction,
    itemId: string,
    parentId: string | null,
  ): Promise<boolean> {
    const result = await tx.execute<{ placeable: boolean }>(sql`
      select s.type <> 'knowledgeBase' or (t.translation_of is null
        and (${parentId}::uuid is null or exists (select 1 from tree_items p where p.id = ${parentId} and p.kind = 'folder')))
        as placeable
      from tree_items t join spaces s on s.id = t.space_id where t.id = ${itemId}`);
    return result.rows[0]?.placeable === true;
  }

  async #inSpace(tx: Transaction, itemId: string, spaceId: string): Promise<boolean> {
    const result = await tx.execute(
      sql`select 1 from tree_items where id = ${itemId} and space_id = ${spaceId}`,
    );
    return result.rows.length > 0;
  }

  async #mappedOne(
    tx: Transaction,
    importId: string,
    kind: string,
    sourceId: string,
  ): Promise<string | null> {
    return (await this.#mappedIn(tx, importId, kind, [sourceId])).get(sourceId) ?? null;
  }

  async quarantineSpace(importId: string): Promise<{ spaceId: string; overviewId: string | null } | null> {
    const result = await this.#database.execute<{ space_id: string; overview_item_id: string | null }>(sql`
      select s.id as space_id, s.overview_item_id from imports i
      join spaces s on s.id = coalesce(i.target_space_id, i.quarantine_space_id)
      where i.id = ${importId}`);
    const row = result.rows[0];
    return row ? { spaceId: row.space_id, overviewId: row.overview_item_id } : null;
  }

  async #requireSpace(importId: string): Promise<{ spaceId: string; overviewId: string | null }> {
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
    const description = run.reimport ? null : (await run.reader.space({ staging: run.staging })).description;
    await this.#database.transaction(async (tx) => {
      const locked = await tx.execute<{ quarantine_space_id: string | null }>(
        sql`select quarantine_space_id from imports where id = ${run.importId} for update`,
      );
      let spaceId = locked.rows[0]?.quarantine_space_id ?? null;
      if (!spaceId) {
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
          knowledgeBase: run.knowledgeBase === true,
        });
        spaceId = space.spaceId;
        await tx.execute(sql`update imports set quarantine_space_id = ${spaceId} where id = ${run.importId}`);
      }
      if (description) {
        await tx.execute(
          sql`update spaces set description = ${description} where id = ${spaceId} and description = ''`,
        );
      }
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
    const narrowing = await this.#narrowing(run);
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
      const links = await this.#linkTargets(run, open);
      await this.#database.transaction(async (tx) => {
        const parents = await this.#mappedIn(
          tx,
          run.importId,
          "page",
          open.map((page) => page.parentId ?? ""),
        );
        for (const page of open) {
          let id: string;
          const ownerId = (page.creatorId ? people.get(page.creatorId) : undefined) ?? null;
          if (page.sourceId === home && space.overviewId) {
            id = space.overviewId;
            if (!run.reimport) {
              await tx.execute(sql`update tree_items set owner_id = ${ownerId} where id = ${id}`);
            }
          } else {
            const nested = page.type !== "blogPost" && page.parentId !== null && page.parentId !== home;
            const parentId =
              nested && page.parentId
                ? (parents.get(page.parentId) ??
                  (await this.#mappedOne(tx, run.importId, "page", page.parentId)))
                : null;
            if (
              run.reimport &&
              nested &&
              (!parentId ||
                !(await this.#inSpace(tx, parentId, space.spaceId)) ||
                !(await run.reimport.editable(tx, [parentId])).has(parentId) ||
                narrowing.holds({ sourceId: page.sourceId, parentItemId: parentId }))
            ) {
              continue;
            }
            const creatorId = (page.creatorId ? people.get(page.creatorId) : undefined) ?? run.importerId;
            id = uuidv7();
            const linkUrl = links.get(page.sourceId) ?? null;
            const kind = treeKindOf(page, linkUrl);
            const article = kind === "page" && run.knowledgeBase ? page.article : undefined;
            if (article?.language && !article.translation && !run.reimport) {
              await this.#adoptLanguage(tx, space.spaceId, article.language);
            }
            const refused =
              article?.translation && article.language && parentId
                ? await this.#refusedTranslation(tx, space.spaceId, parentId, article.language, !run.reimport)
                : null;
            if (refused) {
              await recordProblems(tx, run.importId, [
                {
                  code: "translationNotImported",
                  sourceKind: "page",
                  sourceId: page.sourceId,
                  details: {
                    title: pageTitle(page),
                    language: article?.language ?? "",
                    reason: refused,
                    outcome: "skipped",
                  },
                },
              ]);
              continue;
            }
            const translationOf = article?.translation && article.language && parentId ? parentId : null;
            const position = await endPosition(tx, space.spaceId, parentId);
            await tx.execute(sql`
              insert into tree_items (id, space_id, parent_id, kind, position, title, link_url, mode, creator_id,
                owner_id, created_at, content_updated_at, article_type, translation_of, content_language)
              values (${id}, ${space.spaceId}, ${parentId}, ${kind}, ${position}, ${pageTitle(page)}, ${linkUrl},
                ${kind === "page" || kind === "blogPost" ? "publish" : "live"}, ${creatorId}, ${ownerId},
                coalesce(${page.createdAt}::timestamptz, now()), coalesce(${page.modifiedAt}::timestamptz, now()),
                ${article?.articleType ?? null}, ${translationOf}, ${translationOf ? (article?.language ?? null) : null})`);
            if (kind === "page" || kind === "blogPost") {
              await tx.execute(sql`
                insert into page_documents (item_id, state, snapshot, schema_version, updated_by)
                values (${id}, ${encodeState(yDocFromDocument({ type: "doc", content: [{ type: "paragraph" }] }))},
                  ${JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] })}::jsonb, ${editorSchemaVersion},
                  ${creatorId})`);
            }
            if (page.type === "blogPost") {
              await tx.execute(sql`
                insert into blog_posts (item_id, created_at) values (${id}, coalesce(${page.createdAt}::timestamptz, now()))`);
            }
          }
          if (
            page.status &&
            (page.type === "page" || page.type === "other") &&
            !(run.reimport && page.sourceId === home)
          ) {
            await applyImportedStatus(tx, space.spaceId, id, page.status);
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
    const archived: SourcePage[] = [];
    for await (const page of run.reader.pages(context)) {
      batch.push(page);
      if (page.archived && page.sourceId !== home) archived.push(page);
      if (batch.length >= PAGE_BATCH) await flush();
    }
    await flush();
    if (!run.reimport) await this.#archive(run, archived);
  }

  async #linkTargets(run: PipelineRun, pages: readonly SourcePage[]): Promise<Map<string, string>> {
    const embeds = pages.filter((page) => page.type === "embed").map((page) => page.sourceId);
    const result = new Map<string, string>();
    if (embeds.length === 0) return result;
    const parents = await run.staging.parents("page", embeds);
    const bodies = await run.reader.bodies({ staging: run.staging }, embeds);
    for (const id of embeds) {
      if (parents.has(id)) continue;
      const url = await embedUrl(bodies.get(id)?.content ?? "");
      if (url) result.set(id, url);
    }
    return result;
  }

  async #archive(run: PipelineRun, pages: readonly SourcePage[]): Promise<void> {
    if (pages.length === 0) return;
    const archivedIds = new Set(pages.map((page) => page.sourceId));
    const roots = pages.filter((page) => !page.parentId || !archivedIds.has(page.parentId));
    const items = await this.#mapped(
      run.importId,
      "page",
      roots.map((page) => page.sourceId),
    );
    const people = await this.#persons(
      run,
      roots.map((page) => page.modifierId),
    );
    const space = await this.#requireSpace(run.importId);
    await this.#database.transaction(async (tx) => {
      await lockSpaces(tx, [space.spaceId]);
      for (const page of roots) {
        const itemId = items.get(page.sourceId);
        if (!itemId) continue;
        const subtree = await tx.execute<{ id: string }>(sql`
          with recursive down as (
            select id from tree_items where id = ${itemId} and archived_root_id is null and trash_entry_id is null
            union all
            select t.id from tree_items t join down on t.parent_id = down.id where t.trash_entry_id is null
          )
          select id from down`);
        const ids = subtree.rows.map((row) => row.id);
        if (ids.length === 0) continue;
        await tx.execute(sql`
          update tree_items set archived_root_id = ${itemId}, updated_at = now() where id = any(${sql.param(ids)}::uuid[])`);
        await tx.execute(sql`
          update tree_items set restore_parent_id = parent_id, restore_position = position, parent_id = null,
            archived_at = coalesce(${page.modifiedAt}::timestamptz, now()),
            archived_by = ${(page.modifierId ? people.get(page.modifierId) : undefined) ?? run.importerId}
          where id = ${itemId}`);
        await refreshReaderVisibility(tx, [itemId]);
      }
      await signalSpaceChange(tx, { spaceId: space.spaceId, kind: "tree", itemId: null });
      await signalSpaceChange(tx, { spaceId: space.spaceId, kind: "access", itemId: null });
    });
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
    for (const restriction of restrictions) {
      const accountId = restriction.personId ? (people.get(restriction.personId) ?? null) : null;
      const group = restriction.group ? groupKey(restriction.group) : null;
      const key = accountId ? `account:${accountId}` : group ? `group:${group}` : null;
      if (!key) continue;
      const kind = accountId ? "account" : "group";
      const principalId = accountId ?? (group ? (groups.get(group) ?? null) : null);
      if (principalId) {
        await tx.execute(sql`
          insert into page_restriction_holders (item_id, kind, principal_kind, principal_id)
          values (${itemId}, ${restriction.kind}, ${kind}, ${principalId}) on conflict do nothing`);
      }
      await tx.execute(sql`
        insert into import_grants (id, import_id, source_key, item_id, restriction, holder_kind, account_id,
          group_key, role, status, applied_at)
        values (${uuidv7()}, ${run.importId}, ${`page:${pageSourceId}:${restriction.kind}:${key}`}, ${itemId},
          ${restriction.kind}, ${kind}, ${accountId}, ${group}, ${restriction.kind === "edit" ? "editor" : "reader"},
          'check', ${principalId ? sql`now()` : sql`null`})
        on conflict (import_id, source_key) do nothing`);
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
    const narrowing = await this.#narrowing(run);
    for await (const attachment of run.reader.attachments(context)) {
      done += 1;
      const itemId = (await this.#mapped(run.importId, "page", [attachment.pageId])).get(attachment.pageId);
      if (!itemId) continue;
      if (
        run.reimport &&
        !(await this.#writable(run.reimport, narrowing, [{ sourceId: attachment.pageId, itemId }])).has(
          itemId,
        )
      ) {
        continue;
      }
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
          stored = await this.#files.write(stream, { name, maxBytes: limit, attachment: true });
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
              insert into attachment_versions (id, attachment_id, number, file_id, name, uploaded_by, created_at,
                published_at)
              values (${versionId}, ${attachmentId}, ${Number(next.rows[0]?.number ?? 1)}, ${fileId}, ${name},
                ${uploader}, coalesce(${version.createdAt}::timestamptz, now()), now())`);
            await tx.execute(sql`
              update attachments set current_version_id = ${versionId}, published_version_id = ${versionId},
                updated_at = now()
              where id = ${attachmentId}`);
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
    run: ConverterRun,
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
    const formerTitles = await run.reader.pagesByFormerTitle(
      context,
      titles.filter((title) => !byTitle.has(titleKey(title))),
    );
    const sourceIds = references.flatMap((list) =>
      list.pages.map((reference) => reference.sourceId).filter((id): id is string => id !== null),
    );
    const pageTargets = await this.#lookup(run, "page", [
      ...byTitle.values(),
      ...formerTitles.values(),
      ...sourceIds,
    ]);
    const space = await this.#requireSpace(run.importId);
    const embedServices = narrowEmbedServices(
      await this.#settings.get(embedServicesSetting, {}),
      await this.#settings.get(allowedEmbedServicesSetting, { organization: run.organizationId }),
    );
    const organizationLanguage = await this.#settings.get(languageSetting, {
      organization: run.organizationId,
    });
    const textLanguage: TemplateLanguage = (templateLanguages as readonly string[]).includes(
      organizationLanguage,
    )
      ? (organizationLanguage as TemplateLanguage)
      : "en";
    const templates = await this.#lookup(run, "template", null);
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
    const attachments = await this.#lookup(run, "attachmentName", attachmentKeys);
    const attachmentNames = await this.#attachmentNames([...attachments.values()]);
    const mentioned = references.flatMap((list) => list.people);
    const people = await run.reader.resolvePeople(context, mentioned);
    const known = people.filter((person): person is SourcePerson => person !== null);
    const placeholders = run.preview
      ? await this.#lookup(
          run,
          "person",
          known.map((person) => person.sourceId),
        )
      : await ensurePeople(
          this.#database,
          this.#audit,
          { organizationId: run.organizationId, importId: run.importId },
          known,
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
    const variables = new Map(
      entries.flatMap((entry) => (entry.variables ? [[entry.key, entry.variables] as const] : [])),
    );
    return {
      failed,
      convert: (key, inlineComment) => {
        const owner = owners.get(key) ?? "";
        const resolvePage = (reference: PageReference) => {
          const title =
            reference.title !== null && sameSpace(reference) ? titleKey(reference.title) : undefined;
          const sourceId =
            reference.sourceId ??
            (title === undefined
              ? undefined
              : (byTitle.get(title) ?? (reference.formerTitles ? formerTitles.get(title) : undefined)));
          const target = sourceId ? pageTargets.get(sourceId) : undefined;
          const info = target ? pageInfo.get(target) : undefined;
          const path = info ? itemAddress("page", run.spaceKey, info.number, info.title) : null;
          if (target && path) {
            return { kind: "page" as const, pageId: target, path };
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
            const found = id ? attachmentNames.get(id) : undefined;
            return id
              ? { attachmentId: id, name: found?.name ?? reference.fileName, version: found?.version ?? 1 }
              : null;
          },
          person: (reference) => {
            const sourceId = personKeys.get(`${reference.accountId ?? ""}\u0000${reference.userKey ?? ""}`);
            return sourceId ? (placeholders.get(sourceId) ?? null) : null;
          },
          space: (spaceKey) => (spaceKey.toLowerCase() === sourceKey.toLowerCase() ? spacePath : null),
          spaceId: (spaceKey) =>
            spaceKey === null || spaceKey.toLowerCase() === sourceKey.toLowerCase() ? space.spaceId : null,
          template: (sourceId) => templates.get(sourceId) ?? null,
          spaceKey: sourceKey,
          newId: () => uuidv7(),
          diagramId: (name, pageSourceId) => {
            const page = pageSourceId ?? owner;
            return page ? stableId(`drawio\u0000${page}\u0000${name}`) : uuidv7();
          },
          embeddable: (url) => resolveEmbed(url, embedServices) !== null,
          text: (key) => importText(textLanguage, key),
          jiraIssueUrl: (key) => jiraIssueUrl(run.sourceUrl, key),
          ...(inlineComment ? { inlineComment } : {}),
          ...(variables.has(key) ? { templateVariables: variables.get(key) } : {}),
        };
        return convertStorage(parsed.get(key) ?? ROOT, lookup);
      },
    };
  }

  async #language(run: PipelineRun): Promise<TemplateLanguage> {
    const chain = { ...(await accountScopeChain(this.#database, run.importerId)), user: run.importerId };
    const language = await this.#settings.get(languageSetting, chain);
    return (templateLanguages as readonly string[]).includes(language)
      ? (language as TemplateLanguage)
      : "en";
  }

  async #templates(run: PipelineRun): Promise<void> {
    const context: ReadContext = { staging: run.staging };
    const sourceSpace = await run.reader.space(context);
    const space = await this.#requireSpace(run.importId);
    const templates: SourceTemplate[] = [];
    for await (const template of run.reader.templates(context)) templates.push(template);
    if (templates.length === 0) return;
    const people = await this.#persons(
      run,
      templates.map((template) => template.creatorId),
    );
    const empty = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
    await this.#database.transaction(async (tx) => {
      const created = await this.#mappedIn(
        tx,
        run.importId,
        "template",
        templates.map((template) => template.sourceId),
      );
      for (const template of templates) {
        if (created.has(template.sourceId)) continue;
        const id = uuidv7();
        const creatorId = (template.creatorId ? people.get(template.creatorId) : undefined) ?? run.importerId;
        const name =
          template.name.replace(/\s+/g, " ").trim().slice(0, TEMPLATE_NAME_MAX_LENGTH) ||
          `Template ${template.sourceId}`;
        await tx.execute(sql`
          insert into page_templates (id, level, space_id, name, description, category, title, document,
            schema_version, fields, created_by, updated_by, created_at, updated_at)
          values (${id}, 'space', ${space.spaceId}, ${name},
            ${template.description.replace(/\s+/g, " ").trim().slice(0, TEMPLATE_DESCRIPTION_MAX_LENGTH)},
            ${IMPORTED_TEMPLATE_CATEGORY}, ${name.slice(0, TEMPLATE_TITLE_MAX_LENGTH)}, ${empty}::jsonb,
            ${editorSchemaVersion}, '[]'::jsonb, ${creatorId}, ${creatorId},
            coalesce(${template.createdAt}::timestamptz, now()),
            coalesce(${template.modifiedAt}::timestamptz, now()))`);
        await this.#map(tx, run.importId, "template", template.sourceId, id);
      }
    });
    const done = await this.#mapped(
      run.importId,
      "templateContent",
      templates.map((template) => template.sourceId),
    );
    const plan = run.reimport ? await this.#plan(run.importId, "template") : null;
    const wanted = (template: SourceTemplate) =>
      plan
        ? (plan.get(template.sourceId) ?? []).some(
            (entry) =>
              (entry.change === "new" && !done.has(template.sourceId)) ||
              entry.change === "updated" ||
              (entry.change === "conflict" && entry.decision !== null),
          )
        : !done.has(template.sourceId);
    const open = templates.filter(wanted);
    if (open.length === 0) return;
    const targets = await this.#mapped(
      run.importId,
      "template",
      open.map((template) => template.sourceId),
    );
    const language = await this.#language(run);
    for (let start = 0; start < open.length; start += CONTENT_BATCH) {
      const batch = open.slice(start, start + CONTENT_BATCH);
      const declared = new Map<string, TemplateVariables>();
      for (const template of batch) {
        try {
          declared.set(template.sourceId, templateVariables(await parseStorage(template.body)));
        } catch {
          declared.set(template.sourceId, { fields: [], variables: new Map() });
        }
      }
      const converter = await this.#converter(
        run,
        context,
        sourceSpace.key,
        batch.map((template) => ({
          key: template.sourceId,
          owner: "",
          body: template.body,
          variables: declared.get(template.sourceId)?.variables ?? new Map(),
        })),
      );
      for (const template of batch) {
        const templateId = targets.get(template.sourceId);
        if (!templateId) continue;
        const converted = converter.convert(template.sourceId);
        const base = { sourceKind: "template", sourceId: template.sourceId, itemId: null };
        const problems: ProblemInput[] = converted.notes.map((note) => ({
          ...noteProblem(note, "", template.sourceId),
          ...base,
        }));
        if (converter.failed.has(template.sourceId)) {
          problems.push({ code: "invalidContent", ...base, details: { element: "body" } });
        }
        for (const [name, count] of converted.macros) {
          problems.push({ code: "unsupportedMacro", ...base, details: { name, count } });
        }
        const write = async (tx: Transaction, id: string) => {
          const current = await tx.execute<{ fields: TemplateField[] }>(
            sql`select fields from page_templates where id = ${id} for update`,
          );
          const fields = mergeFields(
            declared.get(template.sourceId)?.fields ?? [],
            current.rows[0]?.fields ?? [],
          );
          await tx.execute(sql`delete from template_files where template_id = ${id}`);
          const document = this.#templateFiles
            ? (
                await this.#templateFiles.adopt(tx, {
                  templateId: id,
                  actorId: run.importerId,
                  document: converted.document,
                  source: sql`t.space_id = ${space.spaceId} and not exists (select 1 from page_restrictions r
                    where r.item_id = any(t.path) and r.kind = 'view')`,
                })
              ).document
            : converted.document;
          await tx.execute(sql`
            update page_templates set document = ${JSON.stringify(document)}::jsonb,
              fields = ${JSON.stringify(fields)}::jsonb, schema_version = ${editorSchemaVersion}
            where id = ${id}`);
          await addButtonFields(tx, converted.document, language);
          await recordProblems(tx, run.importId, problems);
        };
        await this.#database.transaction(async (tx) => {
          if (!plan || !run.reimport) {
            if (await this.#mappedOne(tx, run.importId, "templateContent", template.sourceId)) return;
            await write(tx, templateId);
            await this.#map(tx, run.importId, "templateContent", template.sourceId, templateId);
            return;
          }
          await this.#reimportTemplate(tx, run, run.reimport, {
            template,
            templateId,
            entries: plan.get(template.sourceId) ?? [],
            write,
          });
        });
      }
      await run.beat();
    }
  }

  async #reimportTemplate(
    tx: Transaction,
    run: PipelineRun,
    reimport: ReimportRun,
    input: {
      template: SourceTemplate;
      templateId: string;
      entries: readonly ChangeEntry[];
      write: (tx: Transaction, id: string) => Promise<void>;
    },
  ): Promise<void> {
    const state = templateState(input.template);
    const record = () =>
      recordTemplateBaselines(tx, {
        spaceId: reimport.spaceId,
        importId: run.importId,
        templates: [{ state, targetId: input.templateId }],
      });
    const sourceOnly = () =>
      tx.execute(sql`
        update import_baselines set checksum = ${state.checksum}, import_id = ${run.importId}, recorded_at = now()
        where space_id = ${reimport.spaceId} and kind = 'template' and source_id = ${state.sourceId}`);
    for (const entry of input.entries) {
      const current = await this.#lockChange(tx, entry.id);
      if (!current) continue;
      if (current.change === "new") {
        if (!(await this.#mappedOne(tx, run.importId, "templateContent", state.sourceId))) {
          await input.write(tx, input.templateId);
          await this.#map(tx, run.importId, "templateContent", state.sourceId, input.templateId);
        }
        await record();
        await this.#applied(tx, entry.id, reimport.actorId);
        continue;
      }
      if (current.change === "updated") {
        const local = await tx.execute<{ changed: boolean }>(sql`
          select p.updated_at is distinct from (b.local ->> 'updatedAt')::timestamptz as changed
          from import_baselines b join page_templates p on p.id = b.target_id
          where b.space_id = ${reimport.spaceId} and b.kind = 'template' and b.source_id = ${state.sourceId}`);
        if (local.rows[0]?.changed !== false) {
          await this.#hold(tx, entry.id, "both");
          continue;
        }
        await input.write(tx, input.templateId);
        await record();
        await this.#applied(tx, entry.id, reimport.actorId);
        continue;
      }
      if (current.change !== "conflict" || current.decision === null) continue;
      if (current.decision === "source") {
        await input.write(tx, input.templateId);
        await sourceOnly();
      } else if (current.decision === "both") {
        const copy = uuidv7();
        await tx.execute(sql`
          insert into page_templates (id, level, space_id, name, description, category, title, document, schema_version,
            fields, created_by, updated_by)
          select ${copy}, level, space_id, left(name || ' (Confluence)', ${TEMPLATE_NAME_MAX_LENGTH}), description,
            category, title, document, schema_version, '[]'::jsonb, ${reimport.actorId}, ${reimport.actorId}
          from page_templates where id = ${input.templateId}`);
        await input.write(tx, copy);
        await sourceOnly();
      } else {
        await sourceOnly();
      }
      await this.#applied(tx, entry.id, reimport.actorId);
    }
  }

  async #content(run: PipelineRun): Promise<void> {
    const context: ReadContext = { staging: run.staging };
    const sourceSpace = await run.reader.space(context);
    const total = await run.staging.count("page");
    const plan = run.reimport ? await this.#plan(run.importId, "page") : null;
    const narrowing = await this.#narrowing(run);
    let done = 0;
    let batch: SourcePage[] = [];
    const flush = async () => {
      const pages = batch;
      batch = [];
      const worked =
        plan && run.reimport
          ? await this.#reimportContent(run, run.reimport, context, sourceSpace, pages, plan, narrowing)
          : await this.#contentBatch(run, context, sourceSpace.key, pages);
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

  async #reimportContent(
    run: PipelineRun,
    reimport: ReimportRun,
    context: ReadContext,
    sourceSpace: { key: string; homePageId: string | null },
    pages: readonly SourcePage[],
    plan: ReadonlyMap<string, ChangeEntry[]>,
    narrowing: Narrowing,
  ): Promise<boolean> {
    const created = pages.filter((page) => plan.get(page.sourceId)?.some((entry) => entry.change === "new"));
    const states = new Map(
      (await pageStatesOf(run.reader, context, created, sourceSpace.homePageId)).map((state) => [
        state.sourceId,
        state,
      ]),
    );
    const added = await this.#contentBatch(
      run,
      context,
      sourceSpace.key,
      created,
      async (tx, page, itemId) => {
        const state = states.get(page.sourceId);
        if (state) {
          await recordPageBaselines(tx, {
            spaceId: reimport.spaceId,
            importId: run.importId,
            pages: [{ state, targetId: itemId }],
          });
        }
        for (const entry of plan.get(page.sourceId) ?? []) {
          if (entry.change === "new") await this.#applied(tx, entry.id, reimport.actorId);
        }
      },
    );
    const updated = await this.#updateBatch(run, reimport, context, sourceSpace, pages, plan, narrowing);
    return added || updated;
  }

  async #narrowing(run: PipelineRun): Promise<Narrowing> {
    if (!run.reimport) return Narrowing.none();
    const pending = await pendingNarrowing(this.#database, run.importId);
    if (pending.size === 0) return Narrowing.none();
    const context: ReadContext = { staging: run.staging };
    const home = (await run.reader.space(context)).homePageId;
    const parents = new Map<string, string | null>();
    for await (const page of run.reader.pages(context)) parents.set(page.sourceId, sourceParent(page, home));
    return Narrowing.load(this.#database, {
      spaceId: run.reimport.spaceId,
      pending,
      sourceParents: parents,
      sourceItems: await this.#allMapped(run.importId, "page"),
    });
  }

  async #writable(
    reimport: ReimportRun,
    narrowing: Narrowing,
    pages: readonly { sourceId: string; itemId: string }[],
  ): Promise<Set<string>> {
    const editable = await reimport.editable(
      this.#database,
      pages.map((page) => page.itemId),
    );
    for (const page of pages) if (narrowing.holds(page)) editable.delete(page.itemId);
    return editable;
  }

  async #plan(importId: string, kind: string): Promise<Map<string, ChangeEntry[]>> {
    const rows = await this.#database.execute<{
      id: string;
      source_id: string;
      change: ChangeType;
      item_id: string | null;
      target_id: string | null;
      details: Record<string, unknown>;
      decision: ChangeDecision | null;
    }>(sql`
      select id, source_id, change, item_id, target_id, details, decision from import_changes
      where import_id = ${importId} and kind = ${kind} and applied_at is null`);
    const plan = new Map<string, ChangeEntry[]>();
    for (const row of rows.rows) {
      const list = plan.get(row.source_id) ?? [];
      list.push({
        id: row.id,
        sourceId: row.source_id,
        change: row.change,
        itemId: row.item_id,
        targetId: row.target_id,
        details: row.details,
        decision: row.decision,
      });
      plan.set(row.source_id, list);
    }
    return plan;
  }

  async #lockChange(
    tx: Transaction,
    id: string,
  ): Promise<{
    change: ChangeType;
    decision: ChangeDecision | null;
    details: Record<string, unknown>;
  } | null> {
    const result = await tx.execute<{
      change: ChangeType;
      decision: ChangeDecision | null;
      details: Record<string, unknown>;
      applied_at: Date | string | null;
    }>(sql`select change, decision, details, applied_at from import_changes where id = ${id} for update`);
    const row = result.rows[0];
    return row && row.applied_at === null ? row : null;
  }

  async #applied(tx: Transaction, id: string, actorId: string): Promise<void> {
    await tx.execute(sql`
      update import_changes set applied_at = now(), applied_by = ${actorId} where id = ${id} and applied_at is null`);
  }

  async #hold(tx: Transaction, id: string, reason: "both" | "editing"): Promise<void> {
    await tx.execute(sql`
      update import_changes set change = 'conflict', details = details || ${JSON.stringify({ reason })}::jsonb
      where id = ${id}`);
  }

  async #refreshLocal(tx: Transaction, spaceId: string, sourceId: string): Promise<void> {
    await tx.execute(sql`
      update import_baselines b set local = coalesce((
        select jsonb_build_object('revision', d.revision, 'title', t.title, 'parentId', t.parent_id)
        from tree_items t join page_documents d on d.item_id = t.id where t.id = b.target_id), b.local)
      where b.space_id = ${spaceId} and b.kind = 'page' and b.source_id = ${sourceId}`);
  }

  async #updateBatch(
    run: PipelineRun,
    reimport: ReimportRun,
    context: ReadContext,
    sourceSpace: { key: string; homePageId: string | null },
    pages: readonly SourcePage[],
    plan: ReadonlyMap<string, ChangeEntry[]>,
    narrowing: Narrowing,
  ): Promise<boolean> {
    const work = pages.flatMap((page) =>
      (plan.get(page.sourceId) ?? [])
        .filter(
          (entry) => entry.change === "updated" || (entry.change === "conflict" && entry.decision !== null),
        )
        .map((entry) => ({ page, entry })),
    );
    if (work.length === 0) return false;
    const touched = [...new Map(work.map(({ page }) => [page.sourceId, page])).values()];
    const ids = touched.map((page) => page.sourceId);
    const states = new Map(
      (await pageStatesOf(run.reader, context, touched, sourceSpace.homePageId)).map((state) => [
        state.sourceId,
        state,
      ]),
    );
    const baselines = await pageBaselines(this.#database, reimport.spaceId, ids);
    const bodies = await run.reader.bodies(context, ids);
    const comments = await run.reader.comments(context, ids);
    const known = await this.#mapped(
      run.importId,
      "comment",
      comments.map((comment) => comment.sourceId),
    );
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
      sourceSpace.key,
      touched.map((page) => ({
        key: page.sourceId,
        owner: page.sourceId,
        body: bodies.get(page.sourceId)?.content ?? "",
      })),
    );
    const modifiers = await this.#persons(
      run,
      touched.map((page) => page.modifierId),
    );
    const language = await this.#language(run);
    const editable = await reimport.editable(
      this.#database,
      work.flatMap(({ entry }) => (entry.targetId ? [entry.targetId] : [])),
    );
    let progressed = false;
    for (const { page, entry } of work) {
      const itemId = entry.targetId;
      const state = states.get(page.sourceId);
      const baseline = baselines.get(page.sourceId);
      if (!itemId || !state || !baseline || !editable.has(itemId)) continue;
      const held = narrowing.holds({ sourceId: page.sourceId, itemId, heldBy: heldBy(entry.details) });
      if (held && entry.decision !== "lunedo") continue;
      const threads = new Map<string, string>();
      const converted = converter.convert(page.sourceId, (ref) => {
        const commentId = markers.get(page.sourceId)?.get(ref);
        if (!commentId) return null;
        const existing = known.get(commentId);
        if (existing) return existing;
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
      const problems: ProblemInput[] = converted.notes.map((note) =>
        noteProblem(note, itemId, page.sourceId),
      );
      const document = noteNotImported(page, withoutThreads(converted.document, unanchored), language);
      if (page.type === "other") problems.push(notImportedProblem(page, itemId));
      for (const [name, count] of converted.macros) {
        problems.push({
          code: "unsupportedMacro",
          sourceKind: "page",
          sourceId: page.sourceId,
          itemId,
          details: { name, count },
        });
      }
      const author = (page.modifierId ? modifiers.get(page.modifierId) : undefined) ?? run.importerId;
      await this.#database.transaction(async (tx) => {
        const current = await this.#lockChange(tx, entry.id);
        if (!current || (held && current.decision !== "lunedo")) return;
        const exists = (await localPages(tx, [itemId])).get(itemId);
        if (!exists) {
          await this.#applied(tx, entry.id, reimport.actorId);
          progressed = true;
          return;
        }
        let apply: boolean | null;
        if (current.change === "updated") {
          if (changedLocally(exists, baseline)) {
            await this.#hold(tx, entry.id, "both");
            progressed = true;
            return;
          }
          apply = true;
        } else if (current.change === "conflict" && current.decision === "source") {
          apply = true;
        } else if (current.change === "conflict" && current.decision === "both") {
          apply = false;
        } else if (current.change === "conflict" && current.decision === "lunedo") {
          apply = null;
        } else {
          return;
        }
        if (apply === true && (await openSessions(tx, [itemId])).has(itemId)) {
          if (current.change === "updated") {
            await this.#hold(tx, entry.id, "editing");
            progressed = true;
          } else {
            await tx.execute(sql`
              update import_changes set details = details || ${JSON.stringify({ editing: true })}::jsonb
              where id = ${entry.id}`);
          }
          return;
        }
        if (apply !== null) {
          await addButtonFields(tx, document, language);
          await this.#versions.importVersion(tx, {
            itemId,
            title: pageTitle(page),
            document,
            authorId: author,
            apply,
          });
        }
        if (apply === true) {
          const stored = await tx.execute<{ snapshot: DocumentJson }>(
            sql`select snapshot from page_documents where item_id = ${itemId}`,
          );
          await this.#published(tx, itemId, stored.rows[0]?.snapshot ?? document, converted.tasks, author);
          for (const [commentId, threadId] of threads) {
            await this.#map(tx, run.importId, "commentThread", commentId, threadId);
          }
          await recordProblems(tx, run.importId, problems);
        }
        await updateSourceSide(tx, { spaceId: reimport.spaceId, importId: run.importId, state });
        if (apply === true) await this.#refreshLocal(tx, reimport.spaceId, page.sourceId);
        await this.#applied(tx, entry.id, reimport.actorId);
        progressed = true;
      });
    }
    return progressed;
  }

  async #contentBatch(
    run: PipelineRun,
    context: ReadContext,
    sourceKey: string,
    pages: readonly SourcePage[],
    after?: (tx: Transaction, page: SourcePage, itemId: string) => Promise<void>,
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
    const documents = await this.#documentItems([...items.values()]);
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
    const language = await this.#language(run);
    for (const page of open) {
      const itemId = items.get(page.sourceId);
      if (!itemId) continue;
      if (!documents.has(itemId)) {
        await this.#database.transaction(async (tx) => {
          if (await this.#mappedOne(tx, run.importId, "content", page.sourceId)) return;
          await this.#map(tx, run.importId, "content", page.sourceId, itemId);
        });
        continue;
      }
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
      const problems: ProblemInput[] = converted.notes.map((note) =>
        noteProblem(note, itemId, page.sourceId),
      );
      const document = noteNotImported(page, withoutThreads(converted.document, unanchored), language);
      if (page.type === "other") problems.push(notImportedProblem(page, itemId));
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
        if (converted.numberHeadings) {
          await tx.execute(sql`update tree_items set number_headings = true where id = ${itemId}`);
        }
        await addButtonFields(tx, document, language);
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
        await after?.(tx, page, itemId);
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
      const language = await this.#language(run);
      await this.#database.transaction(async (tx) => {
        await tx.execute(sql`select id from tree_items where id = ${itemId} for update`);
        for (const [index, version] of versions.entries()) {
          if (done.has(version.sourceId)) continue;
          if (await this.#mappedOne(tx, run.importId, "version", version.sourceId)) continue;
          const document = converter.convert(version.sourceId).document;
          await addButtonFields(tx, document, language);
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

  async #documentItems(itemIds: readonly string[]): Promise<Set<string>> {
    if (itemIds.length === 0) return new Set();
    const result = await this.#database.execute<{ item_id: string }>(sql`
      select item_id from page_documents where item_id = any(${sql.param([...itemIds])}::uuid[])`);
    return new Set(result.rows.map((row) => row.item_id));
  }

  async #pageInfo(itemIds: readonly string[]): Promise<Map<string, { title: string; number: number }>> {
    if (itemIds.length === 0) return new Map();
    const rows = await this.#database.execute<{ id: string; title: string; number: string | number }>(sql`
      select id, title, number from tree_items where id = any(${sql.param([...new Set(itemIds)])}::uuid[])`);
    return new Map(rows.rows.map((row) => [row.id, { title: row.title, number: Number(row.number) }]));
  }

  async #attachmentNames(ids: readonly string[]): Promise<Map<string, { name: string; version: number }>> {
    if (ids.length === 0) return new Map();
    const rows = await this.#database.execute<{ id: string; name: string; number: number | null }>(sql`
      select a.id, a.name, v.number from attachments a
      left join attachment_versions v on v.id = a.current_version_id
      where a.id = any(${sql.param([...new Set(ids)])}::uuid[])`);
    return new Map(rows.rows.map((row) => [row.id, { name: row.name, version: Number(row.number ?? 1) }]));
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
    await this.#published(tx, itemId, claimed, input.tasks, actorId);
  }

  async #published(
    tx: Transaction,
    itemId: string,
    claimed: DocumentJson,
    tasks: readonly { id: string; done: boolean }[],
    actorId: string,
  ): Promise<void> {
    await publishTasks(tx, itemId, claimed);
    await syncDecisions(tx, itemId, claimed);
    await syncReusableContent(tx, itemId, claimed);
    await tx.execute(sql`
      update tasks set notified_assignee_id = assignee_id where item_id = ${itemId} and assignee_id is not null`);
    await tx.execute(sql`
      update content_mentions set notified_at = now()
      where item_id = ${itemId} and comment_id is null and notified_at is null`);
    await markMentionsNotified(tx, itemId, null, extractMentions(claimed), actorId);
    const claimedIds = taskIds(claimed);
    for (const [index, task] of tasks.entries()) {
      const id = claimedIds.includes(task.id) ? task.id : claimedIds[index];
      if (id && task.done) await writeTaskStatus(tx, { taskId: id, itemId, done: true, actorId: null });
    }
    await refreshReaderVisibility(tx, [itemId]);
  }

  async #comments(run: PipelineRun): Promise<void> {
    const context: ReadContext = { staging: run.staging };
    const sourceSpace = await run.reader.space(context);
    const total = await run.staging.count("page");
    const narrowing = await this.#narrowing(run);
    let done = 0;
    let batch: SourcePage[] = [];
    const flush = async () => {
      const pages = batch;
      batch = [];
      done += pages.length;
      const worked = await this.#commentBatch(run, context, sourceSpace.key, pages, narrowing);
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
    narrowing: Narrowing,
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
    const unmapped = all.filter(
      (comment) => !finished.has(comment.sourceId) && !skipped.has(comment.sourceId),
    );
    if (unmapped.length === 0) return false;
    const items = await this.#mapped(
      run.importId,
      "page",
      unmapped.map((comment) => comment.pageId),
    );
    const allowed = run.reimport
      ? await this.#writable(
          run.reimport,
          narrowing,
          unmapped.flatMap((comment) => {
            const itemId = items.get(comment.pageId);
            return itemId ? [{ sourceId: comment.pageId, itemId }] : [];
          }),
        )
      : null;
    const open = unmapped.filter((comment) => {
      const itemId = items.get(comment.pageId);
      return itemId !== undefined && (!allowed || allowed.has(itemId));
    });
    if (open.length === 0) return false;
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
    const narrowing = await this.#narrowing(run);
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
          if (!itemId || narrowing.holds({ sourceId: commentId ? null : like.contentId, itemId })) continue;
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
    const known = await run.directory(
      all.flatMap(([, holder]) => (holder.personId ? [personOf(holder.personId)] : [])),
    );
    await ensureGroups(
      this.#database,
      run.importId,
      run.organizationId,
      all.flatMap(([, holder]) => (holder.group ? [holder.group] : [])),
    );
    await this.#database.transaction(async (tx) => {
      for (const [key, holder] of all) {
        if (!grantsAccess(holder.permissions)) continue;
        const decision =
          holder.kind === "anonymous"
            ? { role: null, status: "notTaken" as const, code: "anonymous" }
            : holder.personId && known.get(holder.personId)?.app
              ? { role: null, status: "notTaken" as const, code: "app" }
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

  async #pageBatches(
    run: PipelineRun,
    context: ReadContext,
    spaceId: string,
    handle: (tx: Transaction, states: readonly SourcePageState[]) => Promise<void>,
  ): Promise<void> {
    const home = (await run.reader.space(context)).homePageId;
    let batch: SourcePage[] = [];
    const flush = async () => {
      const pages = batch;
      batch = [];
      const done = await this.#mapped(
        run.importId,
        "baseline",
        pages.map((page) => page.sourceId),
      );
      const open = pages.filter((page) => !done.has(page.sourceId));
      if (open.length === 0) return;
      const states = await pageStatesOf(run.reader, context, open, home);
      await this.#database.transaction(async (tx) => {
        await handle(tx, states);
        for (const state of states) await this.#map(tx, run.importId, "baseline", state.sourceId, spaceId);
      });
      await run.beat();
    };
    for await (const page of run.reader.pages(context)) {
      batch.push(page);
      if (batch.length >= PAGE_BATCH) await flush();
    }
    await flush();
  }

  async #baseline(run: PipelineRun): Promise<void> {
    const context: ReadContext = { staging: run.staging };
    const space = await this.#requireSpace(run.importId);
    const source = await run.reader.space(context);
    await recordImportedSpace(this.#database, {
      spaceId: space.spaceId,
      importId: run.importId,
      source: sourceFamily(run.reader.source),
      sourceSpaceId: source.sourceId,
      sourceSpaceKey: source.key,
    });
    await this.#pageBatches(run, context, space.spaceId, async (tx, states) => {
      const targets = await this.#mappedIn(
        tx,
        run.importId,
        "page",
        states.map((state) => state.sourceId),
      );
      const pages = states.flatMap((state) => {
        const targetId = targets.get(state.sourceId);
        return targetId ? [{ state, targetId }] : [];
      });
      await recordPageBaselines(tx, { spaceId: space.spaceId, importId: run.importId, pages });
      await recordTitles(tx, {
        spaceId: space.spaceId,
        spaceKey: source.key,
        titles: states.map((state) => ({ sourceId: state.sourceId, title: state.title })),
      });
    });
    const templates: { state: ReturnType<typeof templateState>; targetId: string }[] = [];
    for await (const template of run.reader.templates(context)) {
      const targetId = (await this.#mapped(run.importId, "template", [template.sourceId])).get(
        template.sourceId,
      );
      if (targetId) templates.push({ state: templateState(template), targetId });
    }
    await recordTemplateBaselines(this.#database, {
      spaceId: space.spaceId,
      importId: run.importId,
      templates,
    });
    await recordHolderBaselines(this.#database, {
      spaceId: space.spaceId,
      importId: run.importId,
      holders: await sourceHolders(run.reader, context),
    });
  }

  async #lineage(run: PipelineRun, reimport: ReimportRun): Promise<void> {
    const lineage = (await lineageImports(this.#database, reimport.spaceId)).filter(
      (id) => id !== run.importId,
    );
    await this.#database.execute(sql`
      insert into import_items (import_id, kind, source_id, target_id)
      select distinct on (kind, source_id) ${run.importId}, kind, source_id, target_id from import_items
      where import_id = any(${sql.param(lineage)}::uuid[])
        and kind in ('page', 'attachmentName', 'attachmentVersion', 'attachmentSkipped', 'comment', 'commentSkipped',
          'commentThread', 'like', 'template', 'person')
      order by kind, source_id, created_at desc
      on conflict (import_id, kind, source_id) do nothing`);
  }

  async #moves(run: PipelineRun, reimport: ReimportRun): Promise<void> {
    const plan = await this.#plan(run.importId, "page");
    const entries = [...plan.values()]
      .flat()
      .filter((entry) => entry.change === "moved" || entry.change === "movedHere");
    for (const entry of entries) {
      const itemId = entry.targetId;
      const to = typeof entry.details.to === "string" ? entry.details.to : null;
      const parentId = to ? ((await this.#mapped(run.importId, "page", [to])).get(to) ?? null) : null;
      await this.#database.transaction(async (tx) => {
        await lockSpaces(tx, [reimport.spaceId]);
        const current = await this.#lockChange(tx, entry.id);
        if (!current || !itemId || !(await reimport.editable(tx, [itemId])).has(itemId)) return;
        const baseline = (await pageBaselines(tx, reimport.spaceId, [entry.sourceId])).get(entry.sourceId);
        const page = (await localPages(tx, [itemId])).get(itemId);
        let follow = current.change === "moved" && page !== undefined && baseline !== undefined;
        if (follow && page && baseline && page.parentId !== (baseline.local.parentId ?? null)) follow = false;
        if (follow && to && !parentId) follow = false;
        if (follow && parentId) {
          const blocked = await tx.execute<{ found: boolean }>(sql`
            with recursive up as (
              select id, parent_id, 1 as depth from tree_items where id = ${parentId}
              union all
              select t.id, t.parent_id, up.depth + 1 from tree_items t join up on t.id = up.parent_id
              where up.depth < 1000
            )
            select exists (select 1 from up where id = ${itemId})
              or not exists (select 1 from tree_items where id = ${parentId} and trash_entry_id is null
                and space_id = ${reimport.spaceId}) as found`);
          if (blocked.rows[0]?.found) follow = false;
        }
        if (follow && !(await this.#placeableInKnowledgeBase(tx, itemId, parentId))) follow = false;
        if (follow) {
          const position = await endPosition(tx, reimport.spaceId, parentId);
          await tx.execute(sql`
            update tree_items set parent_id = ${parentId}, position = ${position}, updated_at = now()
            where id = ${itemId}`);
          await refreshReaderVisibility(tx, [itemId]);
          await signalSpaceChange(tx, { spaceId: reimport.spaceId, kind: "tree", itemId });
          await this.#refreshLocal(tx, reimport.spaceId, entry.sourceId);
        } else if (current.change === "moved") {
          await tx.execute(sql`update import_changes set change = 'movedHere' where id = ${entry.id}`);
        }
        await tx.execute(sql`
          update import_baselines set data = data || ${JSON.stringify({ parentId: to })}::jsonb
          where space_id = ${reimport.spaceId} and kind = 'page' and source_id = ${entry.sourceId}`);
        await this.#applied(tx, entry.id, reimport.actorId);
      });
      await run.beat();
    }
  }

  async #labels(run: PipelineRun, reimport: ReimportRun): Promise<void> {
    const plan = await this.#plan(run.importId, "page");
    const entries = [...plan.values()].flat().filter((entry) => entry.change === "labels");
    const narrowing = await this.#narrowing(run);
    for (const entry of entries) {
      const itemId = entry.targetId;
      if (narrowing.holds({ sourceId: entry.sourceId, itemId, heldBy: heldBy(entry.details) })) continue;
      const added = (entry.details.added as string[] | undefined) ?? [];
      const removed = (entry.details.removed as string[] | undefined) ?? [];
      await this.#database.transaction(async (tx) => {
        const current = await this.#lockChange(tx, entry.id);
        if (!current || !itemId || !(await reimport.editable(tx, [itemId])).has(itemId)) return;
        const baseline = (await pageBaselines(tx, reimport.spaceId, [entry.sourceId])).get(entry.sourceId);
        const since = baseline?.data.labelsAt ?? null;
        const count = await tx.execute<{ count: number }>(
          sql`select count(*)::int as count from page_labels where item_id = ${itemId}`,
        );
        let room = MAX_LABELS_PER_PAGE - (count.rows[0]?.count ?? 0);
        for (const label of added) {
          if (room <= 0) break;
          const inserted = await tx.execute(sql`
            insert into page_labels (item_id, label, created_by) values (${itemId}, ${label}, ${run.importerId})
            on conflict do nothing`);
          room -= inserted.rowCount ?? 0;
        }
        if (removed.length > 0) {
          await tx.execute(sql`
            delete from page_labels where item_id = ${itemId} and label = any(${sql.param(removed)}::text[])
              ${since ? sql`and created_at <= ${since}::timestamptz` : sql``}`);
        }
        const labels = [...new Set([...(baseline?.data.labels ?? []), ...added])]
          .filter((label) => !removed.includes(label))
          .sort();
        await tx.execute(sql`
          update import_baselines set data = data || jsonb_build_object('labels', ${JSON.stringify(labels)}::jsonb,
            'labelsAt', now())
          where space_id = ${reimport.spaceId} and kind = 'page' and source_id = ${entry.sourceId}`);
        await signalSpaceChange(tx, { spaceId: reimport.spaceId, kind: "page", itemId });
        await this.#applied(tx, entry.id, reimport.actorId);
      });
    }
  }

  async #deletions(run: PipelineRun, reimport: ReimportRun): Promise<void> {
    const actor = accountPrincipal(reimport.actorId);
    const rows = await this.#database.execute<{
      id: string;
      source_id: string;
      target_id: string | null;
    }>(sql`
      select id, source_id, target_id from import_changes
      where import_id = ${run.importId} and applied_at is null
        and ((change = 'deleted' and decision is not null) or change = 'gone')`);
    for (const row of rows.rows) {
      await this.#database.transaction(async (tx) => {
        const current = await this.#lockChange(tx, row.id);
        if (!current) return;
        const kept = () =>
          tx.execute(sql`
            update import_baselines set kept = true where space_id = ${reimport.spaceId} and kind = 'page'
              and source_id = ${row.source_id}`);
        if (current.change === "deleted" && current.decision === "trash" && row.target_id) {
          if (!(await reimport.editable(tx, [row.target_id])).has(row.target_id)) return;
          const page = (await localPages(tx, [row.target_id])).get(row.target_id);
          const overview = await tx.execute<{ overview: boolean }>(sql`
            select exists (select 1 from spaces where overview_item_id = ${row.target_id}) as overview`);
          if (page && !overview.rows[0]?.overview) {
            await this.#trash.deleteItemWithin(tx, actor, row.target_id);
            await tx.execute(sql`
              delete from import_baselines where space_id = ${reimport.spaceId} and kind = 'page'
                and source_id = ${row.source_id}`);
          } else {
            await kept();
          }
        } else if (current.change === "deleted" && current.decision === "keep") {
          await kept();
        }
        await this.#applied(tx, row.id, reimport.actorId);
      });
      await run.beat();
    }
  }

  async #reimportBaseline(run: PipelineRun, reimport: ReimportRun): Promise<void> {
    const context: ReadContext = { staging: run.staging };
    const source = await run.reader.space(context);
    const open = await this.#database.execute<{ kind: string; source_id: string }>(sql`
      select kind, source_id from import_changes
      where import_id = ${run.importId} and change = 'permission' and applied_at is null`);
    const openHolders = new Set(
      open.rows.filter((row) => row.kind === "spacePermission").map((row) => row.source_id),
    );
    const openPages = new Set(
      open.rows
        .filter((row) => row.kind === "restriction")
        .map((row) => row.source_id.slice(0, row.source_id.indexOf(":"))),
    );
    await recordImportedSpace(this.#database, {
      spaceId: reimport.spaceId,
      importId: run.importId,
      source: sourceFamily(run.reader.source),
      sourceSpaceId: source.sourceId,
      sourceSpaceKey: source.key,
    });
    await this.#pageBatches(run, context, reimport.spaceId, async (tx, states) => {
      const ids = states.map((state) => state.sourceId);
      const targets = await this.#mappedIn(tx, run.importId, "page", ids);
      const known = await pageBaselines(tx, reimport.spaceId, ids);
      const missing = states.flatMap((state) => {
        const targetId = targets.get(state.sourceId);
        return targetId && !known.has(state.sourceId) ? [{ state, targetId }] : [];
      });
      await recordPageBaselines(tx, { spaceId: reimport.spaceId, importId: run.importId, pages: missing });
      await recordTitles(tx, {
        spaceId: reimport.spaceId,
        spaceKey: source.key,
        titles: states.map((state) => ({ sourceId: state.sourceId, title: state.title })),
      });
      for (const state of states) {
        if (openPages.has(state.sourceId) || !known.has(state.sourceId)) continue;
        await tx.execute(sql`
          update import_baselines set data = data || jsonb_build_object('restrictions',
            ${JSON.stringify(state.restrictions)}::jsonb), kept = false
          where space_id = ${reimport.spaceId} and kind = 'page' and source_id = ${state.sourceId}`);
      }
    });
    const holders = await sourceHolders(run.reader, context);
    await this.#database.transaction(async (tx) => {
      await recordHolderBaselines(tx, {
        spaceId: reimport.spaceId,
        importId: run.importId,
        holders: holders.filter((holder) => !openHolders.has(holder.key)),
      });
      await tx.execute(sql`
        delete from import_baselines where space_id = ${reimport.spaceId} and kind = 'spacePermission'
          and not (source_id = any(${sql.param(holders.map((holder) => holder.key))}::text[]))
          and not (source_id = any(${sql.param([...openHolders])}::text[]))`);
    });
  }

  async #finish(run: PipelineRun): Promise<void> {
    const space = await this.#requireSpace(run.importId);
    await this.#database.transaction(async (tx) => {
      const overviewId = space.overviewId;
      const overview = overviewId
        ? await tx.execute<{ published_version_id: string | null }>(
            sql`select published_version_id from tree_items where id = ${overviewId}`,
          )
        : null;
      if (overviewId && !overview?.rows[0]?.published_version_id) {
        await insertCurrentVersion(tx, overviewId, {
          number: 1,
          actorId: run.importerId,
          createdAt: null,
        });
        await refreshReaderVisibility(tx, [overviewId]);
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

function notImportedText(sourceType: string | null): ImportText {
  if (sourceType === "whiteboard") return "whiteboardNotImported";
  if (sourceType === "database") return "databaseNotImported";
  return "contentNotImported";
}

function noteNotImported(page: SourcePage, document: DocumentJson, language: TemplateLanguage): DocumentJson {
  if (page.type !== "other") return document;
  const content = (document.content ?? []).filter(
    (node) => !(node.type === "paragraph" && (node.content ?? []).length === 0),
  );
  const note = importText(language, notImportedText(page.sourceType));
  return {
    ...document,
    content: [{ type: "paragraph", content: [{ type: "text", text: note }] }, ...content],
  };
}

function notImportedProblem(page: SourcePage, itemId: string): ProblemInput {
  return {
    code: "contentTypeNotImported",
    sourceKind: "page",
    sourceId: page.sourceId,
    itemId,
    details: { type: page.sourceType ?? "", title: page.title.slice(0, 255) },
  };
}

function treeKindOf(page: SourcePage, linkUrl: string | null): "page" | "blogPost" | "folder" | "link" {
  if (page.type === "blogPost" || page.type === "folder") return page.type;
  if (page.type === "embed" && linkUrl) return "link";
  return "page";
}

async function embedUrl(body: string): Promise<string | null> {
  const root = await parseStorage(body).catch(() => null);
  if (!root) return null;
  const find = (node: typeof root): string | null => {
    for (const child of node.children) {
      if (typeof child === "string") continue;
      if (child.name === "a" && child.attributes.href) return child.attributes.href;
      const nested = find(child);
      if (nested) return nested;
    }
    return null;
  };
  const href = find(root);
  if (!href) return null;
  try {
    return cleanLinkUrl(href);
  } catch {
    return null;
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
