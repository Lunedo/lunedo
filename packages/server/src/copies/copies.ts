import { createHash } from "node:crypto";
import {
  type CopiedAttachment,
  type CopyMapping,
  copyPageDocument,
  type DocumentJson,
  documentAttachments,
} from "@lunedo/editor-schema";
import { copyScene, validateScene, yDocFromScene } from "@lunedo/editor-schema/scene";
import { type Language, uuidv7 } from "@lunedo/shared";
import { sql } from "drizzle-orm";
import * as Y from "yjs";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import { type AuthorizationService, ForbiddenError } from "../authorization/service.js";
import type { AccessImpact } from "../authorization/space-access.js";
import type { ContentActivity } from "../collaboration/content.js";
import type { Database, Transaction } from "../database/database.js";
import type { FileService } from "../files/files.js";
import type { JobContext, JobQueue } from "../jobs/job-queue.js";
import { checkKnowledgeBaseSubtree, isKnowledgeBase } from "../knowledge-bases/rules.js";
import type { NotificationService } from "../notifications/service.js";
import { idleOutsideMaintenance } from "../operations/maintenance.js";
import type { ValueSigner } from "../sharing/signer.js";
import { actorIdOf, auditScopeOf, isUniqueViolation, SpaceError } from "../spaces/common.js";
import { encodeState, insertInitialDocument, migrated, recomputeLinks } from "../spaces/documents.js";
import { positionBetween } from "../spaces/fractional-index.js";
import {
  checkParent,
  endPosition,
  ITEM_TITLE_MAX_LENGTH,
  lockSpaces,
  placementPosition,
} from "../spaces/items.js";
import {
  accessLevels,
  candidateAccounts,
  changeParts,
  type LevelChange,
  levelChanges,
  representativeItems,
  summarizeChanges,
} from "../spaces/move-impact.js";
import type { PeopleService } from "../spaces/people.js";
import type { PageMode, PageWidth, TreeItemKind } from "../spaces/schema.js";
import { signalSpaceChange } from "../spaces/signals.js";
import { carryStatusesInto } from "../spaces/status.js";
import { insertFirstVersion } from "../spaces/versions.js";
import { refreshReaderVisibility, visibleItem } from "../spaces/visibility.js";
import { isStorageFull } from "../storage/errors.js";
import type { StorageService } from "../storage/storage.js";
import { attachmentScenes, copyDrawingScenes } from "../whiteboards/scene-copies.js";
import { copyItemsJob } from "./jobs.js";
import type { CopyState } from "./schema.js";
import { type CopiedFrom, visibleSources } from "./sources.js";

export const COPY_IN_REQUEST_LIMIT = 20;
const COPY_CONFIRMATION = "copy-impact";
const CONFIRMATION_MS = 60 * 60 * 1000;
const STALE_COPY_HOURS = 5;
const FINISHED_COPY_DAYS = 30;
const COPYABLE_ROOTS: ReadonlySet<TreeItemKind> = new Set(["page", "folder", "whiteboard"]);
const ITEM_PATH = /^\/spaces\/[^/?#]+\/(pages|whiteboards)\/([0-9a-f-]{36})(?=$|[/?#])/i;
const RETRYABLE_CODES = new Set(["40001", "40P01"]);
const SPACE_LOCK_ATTEMPTS = 20;
const SPACE_LOCK_PAUSE_MS = 100;

const COPY_PREFIX: Record<Language, (title: string) => string> = {
  en: (title) => `Copy of ${title}`,
  de: (title) => `Kopie von ${title}`,
};

export interface CopyTarget {
  spaceId?: string | undefined;
  parentId: string | null;
  beforeId?: string | null | undefined;
  afterId?: string | null | undefined;
}

export interface CopyRequest extends CopyTarget {
  descendants: boolean;
  confirmation?: string | undefined;
}

export interface CopyImpact extends AccessImpact {
  leavesConfidential: boolean;
  widerAccess: boolean;
  confirmation: string | null;
  items: number;
  hidden: number;
  skipped: number;
  background: boolean;
}

async function checkKnowledgeBaseCopy(
  tx: Transaction,
  targetSpaceId: string,
  itemId: string,
  descendants: boolean,
): Promise<void> {
  if (await isKnowledgeBase(tx, targetSpaceId)) await checkKnowledgeBaseSubtree(tx, itemId, descendants);
}

export interface CopySummary {
  id: string;
  state: CopyState;
  title: string;
  descendants: boolean;
  sourceItemId: string | null;
  targetSpaceId: string | null;
  progress: { done: number; total: number };
  copied: number;
  hidden: number;
  skipped: number;
  item: { id: string; spaceId: string; spaceKey: string; kind: TreeItemKind; title: string } | null;
  errorCode: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

interface SourceRow {
  id: string;
  parent_id: string | null;
  space_id: string;
  kind: TreeItemKind;
  title: string;
  description: string;
  width: PageWidth;
  number_headings: boolean;
  mode: PageMode;
  position: string;
  content_language: string | null;
  translation_of: string | null;
  status_id: string | null;
  link_item_id: string | null;
  link_url: string | null;
  published: boolean;
  meeting: boolean;
  readable: boolean;
}

interface PlannedItem extends SourceRow {
  copyId: string;
  copyParentId: string | null;
}

interface Plan {
  root: SourceRow;
  items: PlannedItem[];
  hidden: number;
  skipped: number;
}

interface Located {
  sourceSpaceId: string;
  targetSpaceId: string;
  targetKey: string;
  organizationId: string | null;
  leavesConfidential: boolean;
}

interface Access {
  gains: LevelChange[];
  impact: AccessImpact;
}

interface CopyContext {
  tx: Transaction;
  actor: Principal;
  actorId: string | null;
  plan: Plan;
  located: Located;
  copies: Map<string, PlannedItem>;
  linked: { itemId: string; content: DocumentJson }[];
}

type Copier = (context: CopyContext, item: PlannedItem) => Promise<void>;

class CurrentAccess extends Error {
  constructor(readonly digest: string) {
    super("Current access");
  }
}

class CopyRetry extends Error {
  constructor() {
    super("The target space was busy while the copy finished");
  }
}

class Preview extends Error {
  constructor(readonly impact: CopyImpact) {
    super("Preview");
  }
}

class Placeholder extends Error {
  constructor(readonly levels: Map<string, number>) {
    super("Placeholder");
  }
}

type CopyRow = {
  id: string;
  account_id: string;
  organization_id: string | null;
  source_item_id: string | null;
  target_space_id: string | null;
  target_parent_id: string | null;
  placement: { beforeId?: string | null; afterId?: string | null };
  descendants: boolean;
  title: string;
  state: CopyState;
  access: string;
  wider_access: boolean;
  total: number;
  copied: number;
  hidden: number;
  skipped: number;
  root_copy_id: string | null;
  error_code: string | null;
  created_at: Date | string;
  finished_at: Date | string | null;
  done: number | null;
  item_space_id: string | null;
  item_space_key: string | null;
  item_kind: TreeItemKind | null;
  item_title: string | null;
};

function digest(gains: LevelChange[]): string {
  return createHash("sha256").update(changeParts(gains).join("\n")).digest("hex");
}

function retryable(error: unknown): boolean {
  const cause = (error as { cause?: unknown }).cause ?? error;
  return (
    error instanceof CopyRetry ||
    RETRYABLE_CODES.has(String((cause as { code?: unknown }).code ?? "")) ||
    isUniqueViolation(error, "tree_items_position_unique")
  );
}

function errorCodeOf(error: unknown): string {
  if (error instanceof SpaceError) return error.code;
  if (isStorageFull(error)) return "storageFull";
  if (error instanceof CopyRetry || retryable(error)) return "copyInterrupted";
  if (error instanceof ForbiddenError) return "forbidden";
  return "copyFailed";
}

export function copyTitle(language: Language, title: string, attempt: number): string {
  const suffix = attempt > 1 ? ` (${attempt})` : "";
  const prefixed = COPY_PREFIX[language]("");
  const room = ITEM_TITLE_MAX_LENGTH - prefixed.length - suffix.length;
  return `${COPY_PREFIX[language](title.slice(0, room).trimEnd())}${suffix}`;
}

export class CopyService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #people: PeopleService;
  readonly #activity: ContentActivity;
  readonly #signer: ValueSigner;
  readonly #files: FileService;
  readonly #storage: StorageService;
  readonly #audit: AuditLog;
  readonly #notifications: NotificationService;
  readonly #language: (accountId: string) => Promise<Language>;
  readonly #jobs: JobQueue | undefined;
  readonly #copiers: Partial<Record<TreeItemKind, Copier>>;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    people: PeopleService;
    activity: ContentActivity;
    signer: ValueSigner;
    storage: StorageService;
    files: FileService;
    audit: AuditLog;
    notifications: NotificationService;
    language: (accountId: string) => Promise<Language>;
    jobs?: JobQueue | undefined;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#people = options.people;
    this.#activity = options.activity;
    this.#signer = options.signer;
    this.#storage = options.storage;
    this.#files = options.files;
    this.#audit = options.audit;
    this.#notifications = options.notifications;
    this.#language = options.language;
    this.#jobs = options.jobs;
    this.#copiers = {
      page: (context, item) => this.#copyPage(context, item),
      whiteboard: (context, item) => this.#copyWhiteboard(context, item),
      folder: async () => {},
      link: async () => {},
    };
  }

  async preview(
    actor: Principal,
    itemId: string,
    request: { spaceId?: string | undefined; parentId: string | null; descendants: boolean },
  ): Promise<CopyImpact> {
    const located = await this.#locate(actor, itemId, request.spaceId);
    try {
      await this.#database.transaction(
        async (tx) => {
          await checkParent(tx, this.#authorization, actor, located.targetSpaceId, request.parentId);
          await checkKnowledgeBaseCopy(tx, located.targetSpaceId, itemId, request.descendants);
          const plan = await this.#plan(tx, actor, itemId, request.descendants);
          const access = await this.#access(tx, actor, plan, located, request.parentId);
          throw new Preview(await this.#impact(actor, itemId, located, request, plan, access));
        },
        { isolationLevel: "repeatable read" },
      );
    } catch (error) {
      if (error instanceof Preview) return error.impact;
      throw error;
    }
    throw new Error("The copy preview did not finish");
  }

  async copy(actor: Principal, itemId: string, request: CopyRequest): Promise<CopySummary> {
    if (actor.type !== "account") throw new SpaceError("invalidActor", "Only people can copy content");
    const located = await this.#locate(actor, itemId, request.spaceId);
    const copyId = uuidv7();
    const background = await this.#database.transaction(
      async (tx) => {
        await lockSpaces(tx, [located.targetSpaceId]);
        await checkParent(tx, this.#authorization, actor, located.targetSpaceId, request.parentId);
        await checkKnowledgeBaseCopy(tx, located.targetSpaceId, itemId, request.descendants);
        const plan = await this.#plan(tx, actor, itemId, request.descendants);
        const access = await this.#access(tx, actor, plan, located, request.parentId);
        await this.#requireConfirmation(actor, itemId, located, request, plan, access);
        await this.#requireStorage(tx, plan);
        const queued = plan.items.length > COPY_IN_REQUEST_LIMIT;
        await tx.execute(sql`
          insert into item_copies (id, account_id, organization_id, source_item_id, target_space_id, target_parent_id,
            placement, descendants, title, state, access, wider_access, total)
          values (${copyId}, ${actor.id}, ${located.organizationId}, ${itemId}, ${located.targetSpaceId},
            ${request.parentId}, ${JSON.stringify({ beforeId: request.beforeId ?? null, afterId: request.afterId ?? null })}::jsonb,
            ${request.descendants}, ${plan.root.title}, ${queued ? "queued" : "running"}, ${digest(access.gains)},
            ${access.gains.length > 0}, ${plan.items.length})`);
        if (queued) return true;
        await this.#execute(tx, actor, copyId, plan, located, request, access.gains.length > 0, null);
        return false;
      },
      { isolationLevel: "repeatable read" },
    );
    if (background) await this.#enqueue(copyId);
    const summary = await this.get(actor, copyId);
    if (!summary) throw new Error("The copy was not recorded");
    return summary;
  }

  async get(viewer: Principal, copyId: string): Promise<CopySummary | null> {
    const result = await this.#database.execute<CopyRow>(sql`
      select c.*, p.done, t.space_id as item_space_id, s.key as item_space_key, t.kind as item_kind,
        t.title as item_title
      from item_copies c
      left join job_progress p on p.job_id = c.job_id
      left join tree_items t on t.id = c.root_copy_id
      left join spaces s on s.id = t.space_id
      where c.id = ${copyId}`);
    const row = result.rows[0];
    return row ? this.#visibleSummary(viewer, this.#summary(row)) : null;
  }

  async #visibleSummary(viewer: Principal, summary: CopySummary): Promise<CopySummary> {
    const sees = async (permission: "item.view" | "space.view", type: "item" | "space", id: string | null) =>
      id !== null && (await this.#authorization.explain(viewer, permission, { type, id })).allowed;
    const item = summary.item && (await sees("item.view", "item", summary.item.id)) ? summary.item : null;
    const sourceItemId = (await sees("item.view", "item", summary.sourceItemId))
      ? summary.sourceItemId
      : null;
    const targetSpaceId = (await sees("space.view", "space", summary.targetSpaceId))
      ? summary.targetSpaceId
      : null;
    return {
      ...summary,
      title: item || (!summary.item && sourceItemId) ? summary.title : "",
      sourceItemId,
      targetSpaceId,
      item,
    };
  }

  async sources<T extends { copiedFrom: CopiedFrom | null }>(viewer: Principal, versions: T[]): Promise<T[]> {
    return visibleSources(this.#database, this.#authorization, viewer, versions);
  }

  readonly work = async (job: JobContext<{ copyId: string }>): Promise<void> => {
    const result = await this.#database.execute<CopyRow>(sql`
      update item_copies set state = 'running', updated_at = now()
      where id = ${job.payload.copyId} and state in ('queued', 'running')
      returning *`);
    const row = result.rows[0];
    if (!row) return;
    const actor = accountPrincipal(row.account_id);
    try {
      if (!row.source_item_id || !row.target_space_id) {
        throw new SpaceError("itemNotFound", "The item or the target space no longer exists");
      }
      const sourceItemId = row.source_item_id;
      const request: CopyRequest = {
        spaceId: row.target_space_id,
        parentId: row.target_parent_id,
        beforeId: row.placement.beforeId ?? null,
        afterId: row.placement.afterId ?? null,
        descendants: row.descendants,
      };
      const located = await this.#locate(actor, sourceItemId, request.spaceId);
      const mailIds = await this.#database.transaction(
        async (tx) => {
          await tx.execute(sql`select set_config('pagehall.tree_settled_later', 'on', true)`);
          await checkParent(tx, this.#authorization, actor, located.targetSpaceId, request.parentId);
          await checkKnowledgeBaseCopy(tx, located.targetSpaceId, sourceItemId, row.descendants);
          const plan = await this.#plan(tx, actor, sourceItemId, row.descendants);
          const access = await this.#access(tx, actor, plan, located, request.parentId);
          if (digest(access.gains) !== row.access) {
            throw new SpaceError(
              "copyChangesAccess",
              "Who can open the content changed after the copy was confirmed. Check the access again, then copy again.",
            );
          }
          await this.#requireStorage(tx, plan);
          return this.#execute(tx, actor, row.id, plan, located, request, row.wider_access, {
            confirmed: row.access,
            report: (done) => job.reportProgress(done, plan.items.length),
          });
        },
        { isolationLevel: "repeatable read" },
      );
      await this.#notifications.dispatch(mailIds);
    } catch (error) {
      if (retryable(error) && job.retryCount < copyItemsJob.retryLimit) throw error;
      if (!(error instanceof SpaceError) && !isStorageFull(error)) {
        job.logger.error({ err: error, copyId: row.id }, "Copy failed");
      }
      await this.#fail(row.id, errorCodeOf(error));
    }
  };

  async watchdog(): Promise<void> {
    const stale = await this.#database.execute<{ id: string }>(sql`
      select id from item_copies
      where state in ('queued', 'running')
        and ${idleOutsideMaintenance(sql`updated_at`, sql`make_interval(hours => ${STALE_COPY_HOURS})`)}`);
    for (const row of stale.rows) await this.#fail(row.id, "copyInterrupted");
    await this.#database.execute(sql`
      delete from item_copies
      where state in ('done', 'failed') and finished_at < now() - make_interval(days => ${FINISHED_COPY_DAYS})`);
  }

  async #enqueue(copyId: string): Promise<void> {
    if (!this.#jobs) return;
    const jobId = await this.#jobs.enqueue(copyItemsJob, { copyId }, { idempotencyKey: copyId });
    await this.#database.execute(sql`update item_copies set job_id = ${jobId} where id = ${copyId}`);
  }

  async #fail(copyId: string, errorCode: string): Promise<void> {
    const mailIds = await this.#database.transaction(async (tx) => {
      const failed = await tx.execute<{
        account_id: string;
        organization_id: string | null;
        title: string;
      }>(sql`
        update item_copies set state = 'failed', error_code = ${errorCode}, finished_at = now(), updated_at = now()
        where id = ${copyId} and state in ('queued', 'running')
        returning account_id, organization_id, title`);
      const row = failed.rows[0];
      if (!row) return [];
      const notified = await this.#notifications.notify(tx, {
        type: "copy.failed",
        recipients: [row.account_id],
        organizationId: row.organization_id,
        targetId: copyId,
        params: { itemTitle: row.title, errorCode },
      });
      return notified.mailIds;
    });
    await this.#notifications.dispatch(mailIds);
  }

  async #locate(actor: Principal, itemId: string, targetSpaceId: string | undefined): Promise<Located> {
    const source = await this.#authorization.explain(actor, "item.view", { type: "item", id: itemId });
    if (!source.allowed) throw new SpaceError("itemNotFound", "The item does not exist");
    const result = await this.#database.execute<{ space_id: string; confidential: boolean }>(sql`
      select t.space_id, s.confidential from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${itemId} and t.trash_entry_id is null`);
    const row = result.rows[0];
    if (!row) throw new SpaceError("itemNotFound", "The item does not exist");
    const target = targetSpaceId ?? row.space_id;
    const spaces = await this.#database.execute<{
      id: string;
      key: string;
      organization_id: string | null;
      confidential: boolean;
    }>(
      sql`select id, key, organization_id, confidential from spaces where id = any(${sql.param([row.space_id, target])}::uuid[])`,
    );
    const sourceSpace = spaces.rows.find((space) => space.id === row.space_id);
    const targetSpace = spaces.rows.find((space) => space.id === target);
    if (!sourceSpace || !targetSpace) throw new SpaceError("spaceNotFound", "The space does not exist");
    await this.#requireEdit(actor, target);
    if (targetSpace.organization_id !== sourceSpace.organization_id) {
      throw new SpaceError("otherOrganization", "Content can only be copied within its organization");
    }
    const leavesConfidential = sourceSpace.confidential && target !== row.space_id;
    if (leavesConfidential) await this.#requireEdit(actor, row.space_id);
    return {
      sourceSpaceId: row.space_id,
      targetSpaceId: target,
      targetKey: targetSpace.key,
      organizationId: targetSpace.organization_id,
      leavesConfidential: leavesConfidential && !targetSpace.confidential,
    };
  }

  async #requireEdit(actor: Principal, spaceId: string): Promise<void> {
    const decision = await this.#authorization.explain(actor, "space.edit", { type: "space", id: spaceId });
    if (decision.allowed) return;
    const visible = await this.#authorization.explain(actor, "space.view", { type: "space", id: spaceId });
    if (!visible.allowed) throw new SpaceError("spaceNotFound", "The space does not exist");
    throw new ForbiddenError(decision);
  }

  async #plan(tx: Transaction, actor: Principal, itemId: string, descendants: boolean): Promise<Plan> {
    const result = await tx.execute<SourceRow & { depth: number; [key: string]: unknown }>(sql`
      with recursive down as (
        select t.id, 0 as depth, array[t.position::text] as sort, t.archived_root_id from tree_items t
        where t.id = ${itemId} and t.trash_entry_id is null
        union all
        select c.id, down.depth + 1, down.sort || c.position::text, c.archived_root_id
        from tree_items c join down on c.parent_id = down.id
        where ${descendants} and c.trash_entry_id is null and c.kind not in ('blogPost')
          and c.archived_root_id is not distinct from down.archived_root_id and down.depth < 1000
      )
      select t.id, t.parent_id, t.space_id, t.kind, t.title, t.description, t.width, t.number_headings, t.mode,
        t.position, t.content_language, t.translation_of, t.status_id, t.link_item_id, t.link_url, d.depth,
        (t.kind not in ('page', 'blogPost') or t.mode = 'live' or t.published_version_id is not null) as published,
        exists (select 1 from meetings m where m.item_id = t.id) as meeting,
        ${visibleItem(this.#authorization, actor, sql`t`, sql`s`)} as readable
      from down d join tree_items t on t.id = d.id join spaces s on s.id = t.space_id
      order by d.depth, d.sort`);
    const [root, ...rest] = result.rows;
    if (!root?.readable) throw new SpaceError("itemNotFound", "The item does not exist");
    if (!COPYABLE_ROOTS.has(root.kind) || root.meeting) {
      throw new SpaceError("notCopyable", "Only pages, folders and whiteboards can be copied");
    }
    if (!root.published) {
      throw new SpaceError(
        "neverPublished",
        "The page has never been published, so it has no content to copy. Publish it first, then copy it.",
      );
    }
    const items: PlannedItem[] = [{ ...root, copyId: uuidv7(), copyParentId: null }];
    const planned = new Map<string, PlannedItem>(items.map((item) => [item.id, item]));
    const left = new Map<string, "hidden" | "skipped">();
    let hidden = 0;
    let skipped = 0;
    const leave = (row: SourceRow, reason: "hidden" | "skipped") => {
      left.set(row.id, reason);
      if (reason === "hidden") hidden += 1;
      else skipped += 1;
    };
    for (const row of rest) {
      const parent = row.parent_id ? planned.get(row.parent_id) : undefined;
      const inherited = row.parent_id ? left.get(row.parent_id) : undefined;
      if (inherited) leave(row, inherited);
      else if (!row.readable) leave(row, "hidden");
      else if (!parent || !this.#copiers[row.kind] || row.meeting || !row.published) leave(row, "skipped");
      else {
        const item = { ...row, copyId: uuidv7(), copyParentId: parent.copyId };
        items.push(item);
        planned.set(row.id, item);
      }
    }
    return { root, items, hidden, skipped };
  }

  async #access(
    tx: Transaction,
    actor: Principal,
    plan: Plan,
    located: Located,
    parentId: string | null,
  ): Promise<Access> {
    const items = await representativeItems(
      tx,
      plan.root.id,
      plan.items.map((item) => item.id),
    );
    const accounts = await candidateAccounts(
      tx,
      { itemId: plan.root.id, parentId, spaceIds: [located.sourceSpaceId, located.targetSpaceId] },
      items,
    );
    const before = await accessLevels(tx, items, accounts);
    const copy = await this.#placeholderLevels(tx, located.targetSpaceId, parentId, accounts);
    const after = new Map<string, Map<string, number>>();
    for (const [accountId, level] of copy) after.set(accountId, new Map(items.map((item) => [item, level])));
    const changes = levelChanges(items, before, after);
    return {
      gains: changes.filter((change) => change.before === 0 && change.after > 0),
      impact: await summarizeChanges(tx, changes, (account) => this.#people.visibleCondition(actor, account)),
    };
  }

  async #placeholderLevels(
    tx: Transaction,
    spaceId: string,
    parentId: string | null,
    accounts: string[],
  ): Promise<Map<string, number>> {
    try {
      await tx.transaction(async (savepoint) => {
        const id = uuidv7();
        const position = await endPosition(savepoint, spaceId, parentId);
        await savepoint.execute(sql`
          insert into tree_items (id, space_id, parent_id, kind, position, title)
          values (${id}, ${spaceId}, ${parentId}, 'folder', ${position}, 'Copy')`);
        const levels = await accessLevels(savepoint, [id], accounts);
        throw new Placeholder(new Map([...levels].map(([account, entry]) => [account, entry.get(id) ?? 0])));
      });
    } catch (error) {
      if (error instanceof Placeholder) return error.levels;
      throw error;
    }
    throw new Error("The access of the copy was not computed");
  }

  #parts(
    actor: Principal,
    itemId: string,
    located: Located,
    request: CopyTarget & { descendants: boolean },
    gains: LevelChange[],
  ): string[] {
    return [
      actorIdOf(actor) ?? "",
      itemId,
      located.targetSpaceId,
      request.parentId ?? "",
      request.descendants ? "descendants" : "item",
      ...changeParts(gains),
    ];
  }

  async #impact(
    actor: Principal,
    itemId: string,
    located: Located,
    request: CopyTarget & { descendants: boolean },
    plan: Plan,
    access: Access,
  ): Promise<CopyImpact> {
    const parts = this.#parts(actor, itemId, located, request, access.gains);
    return {
      ...access.impact,
      leavesConfidential: located.leavesConfidential,
      widerAccess: access.gains.length > 0,
      confirmation:
        access.gains.length > 0
          ? await this.#signer.sign(COPY_CONFIRMATION, parts, new Date(Date.now() + CONFIRMATION_MS))
          : null,
      items: plan.items.length,
      hidden: plan.hidden,
      skipped: plan.skipped,
      background: plan.items.length > COPY_IN_REQUEST_LIMIT,
    };
  }

  async #requireConfirmation(
    actor: Principal,
    itemId: string,
    located: Located,
    request: CopyRequest,
    plan: Plan,
    access: Access,
  ): Promise<void> {
    if (access.gains.length === 0) return;
    const parts = this.#parts(actor, itemId, located, request, access.gains);
    if (await this.#signer.verify(COPY_CONFIRMATION, parts, request.confirmation ?? "")) return;
    throw new SpaceError(
      "copyChangesAccess",
      "The copy can be opened by people who cannot open the original. Check who gains access, then confirm the copy.",
      { copyImpact: await this.#impact(actor, itemId, located, request, plan, access) },
    );
  }

  async #requireStorage(tx: Transaction, plan: Plan): Promise<void> {
    const ids = plan.items.map((item) => item.id);
    const files = await tx.execute<{ found: boolean }>(sql`
      select (exists (select 1 from attachments where item_id = any(${sql.param(ids)}::uuid[])
          and published_version_id is not null)
        or exists (select 1 from whiteboard_documents where item_id = any(${sql.param(ids)}::uuid[])
          and preview_id is not null)) as found`);
    if (files.rows[0]?.found) await this.#storage.requireUpload();
  }

  async #execute(
    tx: Transaction,
    actor: Principal,
    copyId: string,
    plan: Plan,
    located: Located,
    request: CopyTarget & { descendants: boolean },
    widerAccess: boolean,
    background: { confirmed: string; report: (done: number) => Promise<void> } | null,
  ): Promise<string[]> {
    const actorId = actorIdOf(actor);
    const titles = await this.#titles(tx, actor, plan, located.targetSpaceId);
    const position = await this.#position(tx, located.targetSpaceId, request);
    const copies = new Map(plan.items.map((item) => [item.id, item]));
    const knowledgeBase = await isKnowledgeBase(tx, located.targetSpaceId);
    const context: CopyContext = { tx, actor, actorId, plan, located, copies, linked: [] };
    for (const [index, item] of plan.items.entries()) {
      const isRoot = index === 0;
      const linked = item.link_item_id ? (copies.get(item.link_item_id)?.copyId ?? item.link_item_id) : null;
      const translationOf =
        knowledgeBase && !isRoot && item.translation_of
          ? (copies.get(item.translation_of)?.copyId ?? null)
          : null;
      await tx.execute(sql`
        insert into tree_items (id, space_id, parent_id, kind, position, title, description, width, number_headings,
          mode, link_item_id, link_url, content_language, translation_of, status_id, status_changed_at,
          status_changed_by, creator_id, owner_id)
        values (${item.copyId}, ${located.targetSpaceId}, ${isRoot ? request.parentId : item.copyParentId}, ${item.kind},
          ${isRoot ? position : item.position}, ${titles.get(item.id) ?? item.title}, ${item.description},
          ${item.width}, ${item.number_headings}, ${item.mode}, ${linked}, ${item.link_url}, ${item.content_language},
          ${translationOf}, ${item.status_id}, ${item.status_id ? sql`now()` : null}, ${item.status_id ? actorId : null},
          ${actorId}, ${actorId})`);
      await tx.execute(sql`
        insert into page_labels (item_id, label, created_by)
        select ${item.copyId}, label, ${actorId} from page_labels where item_id = ${item.id}`);
      await this.#copiers[item.kind]?.(context, item);
      if (background && index % 10 === 9) await background.report(index + 1);
    }
    for (const page of context.linked) await recomputeLinks(tx, page.itemId, page.content);
    const root = plan.items[0] as PlannedItem;
    if (background) await this.#settle(tx, actor, plan, located, request.parentId, background.confirmed);
    await carryStatusesInto(tx, root.copyId, located.targetSpaceId, actorId);
    await refreshReaderVisibility(tx, [root.copyId]);
    await signalSpaceChange(tx, { spaceId: located.targetSpaceId, kind: "tree", itemId: root.copyId });
    const title = titles.get(root.id) ?? root.title;
    await tx.execute(sql`
      update item_copies set state = 'done', copied = ${plan.items.length}, hidden = ${plan.hidden},
        skipped = ${plan.skipped}, root_copy_id = ${root.copyId}, finished_at = now(), updated_at = now()
      where id = ${copyId}`);
    await this.#audit.record(tx, {
      name: "page.copied",
      actor,
      targetId: root.copyId,
      fields: {
        spaceId: located.targetSpaceId,
        title,
        itemKind: root.kind,
        itemId: root.id,
        sourceSpaceId: located.sourceSpaceId,
        descendants: request.descendants,
        copied: plan.items.length,
        hidden: plan.hidden,
        skipped: plan.skipped,
        widerAccess,
      },
      scope: auditScopeOf({ organizationId: located.organizationId }),
    });
    if (!background || !actorId) return [];
    const notified = await this.#notifications.notify(tx, {
      type: "copy.finished",
      recipients: [actorId],
      organizationId: located.organizationId,
      targetId: root.copyId,
      params: {
        itemTitle: title,
        itemKind: root.kind as "page" | "folder" | "whiteboard",
        spaceKey: located.targetKey,
        copied: plan.items.length,
        hidden: plan.hidden,
        skipped: plan.skipped,
      },
    });
    return notified.mailIds;
  }

  async #position(tx: Transaction, spaceId: string, request: CopyTarget): Promise<string> {
    if (request.beforeId || request.afterId) return placementPosition(tx, spaceId, request, null);
    const last = await tx.execute<{ position: string | null }>(sql`
      select max(position) as position from tree_items
      where space_id = ${spaceId} and parent_id is not distinct from ${request.parentId}`);
    const lower = last.rows[0]?.position ?? null;
    return positionBetween(lower, positionBetween(lower, null));
  }

  async #settle(
    tx: Transaction,
    actor: Principal,
    plan: Plan,
    located: Located,
    parentId: string | null,
    confirmed: string,
  ): Promise<void> {
    const spaceId = located.targetSpaceId;
    await this.#lockSpaceWithoutWaiting(tx, spaceId);
    if ((await this.#currentAccess(actor, plan, located, parentId)) !== confirmed) throw new CopyRetry();
    if (parentId === null) return;
    const read = sql`select space_id, path::text as path, (trash_entry_id is null and archived_root_id is null) as in_tree
      from tree_items where id = ${parentId}`;
    const current = (await this.#database.execute<{ space_id: string; path: string; in_tree: boolean }>(read))
      .rows[0];
    if (!current?.in_tree || current.space_id !== spaceId) {
      throw new SpaceError("invalidPlacement", "The place of the copy was moved or deleted while copying");
    }
    const seen = (await tx.execute<{ path: string }>(read)).rows[0];
    if (seen?.path !== current.path) throw new CopyRetry();
  }

  async #currentAccess(
    actor: Principal,
    plan: Plan,
    located: Located,
    parentId: string | null,
  ): Promise<string> {
    try {
      await this.#database.transaction(async (fresh) => {
        throw new CurrentAccess(digest((await this.#access(fresh, actor, plan, located, parentId)).gains));
      });
    } catch (error) {
      if (error instanceof CurrentAccess) return error.digest;
      throw error;
    }
    throw new Error("The current access of the copy was not computed");
  }

  async #lockSpaceWithoutWaiting(tx: Transaction, spaceId: string): Promise<void> {
    for (let attempt = 0; attempt < SPACE_LOCK_ATTEMPTS; attempt += 1) {
      try {
        await tx.transaction((savepoint) =>
          savepoint.execute(sql`select id from spaces where id = ${spaceId} for no key update nowait`),
        );
        return;
      } catch (error) {
        const cause = (error as { cause?: unknown }).cause ?? error;
        if ((cause as { code?: unknown }).code !== "55P03") throw error;
        await new Promise((resolve) => setTimeout(resolve, SPACE_LOCK_PAUSE_MS));
      }
    }
    throw new CopyRetry();
  }

  async #titles(
    tx: Transaction,
    actor: Principal,
    plan: Plan,
    spaceId: string,
  ): Promise<Map<string, string>> {
    const existing = await tx.execute<{ title: string }>(sql`
      select distinct lower(t.title) as title from tree_items t join spaces s on s.id = t.space_id
      where t.space_id = ${spaceId} and ${visibleItem(this.#authorization, actor, sql`t`, sql`s`)}`);
    const taken = new Set(existing.rows.map((row) => row.title));
    const language = actor.type === "account" ? await this.#language(actor.id) : "en";
    const titles = new Map<string, string>();
    for (const item of plan.items) {
      let title = item.title;
      for (let attempt = 1; taken.has(title.toLowerCase()); attempt += 1) {
        title = copyTitle(language, item.title, attempt);
      }
      taken.add(title.toLowerCase());
      titles.set(item.id, title);
    }
    return titles;
  }

  #mapping(context: CopyContext, attachments: Map<string, CopiedAttachmentPlan>): CopyMapping {
    return {
      attachment: (reference) => {
        const copied = attachments.get(reference.id);
        if (!copied) return reference;
        return {
          id: copied.id,
          version:
            reference.version === null ? null : (copied.numbers.get(reference.version) ?? copied.published),
        };
      },
      page: (id) => {
        const copied = context.copies.get(id);
        return copied ? { id: copied.copyId, spaceId: context.located.targetSpaceId } : null;
      },
      href: (href) => {
        const match = ITEM_PATH.exec(href);
        const copied = match?.[2] ? context.copies.get(match[2].toLowerCase()) : undefined;
        if (!match || !copied) return href;
        return `/spaces/${encodeURIComponent(context.located.targetKey)}/${match[1]}/${copied.copyId}${href.slice(match[0].length)}`;
      },
    };
  }

  async #copyAttachments(
    context: CopyContext,
    item: PlannedItem,
    references: readonly CopiedAttachment[],
  ): Promise<Map<string, CopiedAttachmentPlan>> {
    const { tx, actorId } = context;
    const result = await tx.execute<{
      attachment_id: string;
      name: string;
      name_key: string;
      published_number: number;
      number: number;
      file_id: string;
      version_name: string;
    }>(sql`
      select a.id as attachment_id, a.name, a.name_key, pv.number as published_number, v.number, v.file_id,
        v.name as version_name
      from attachments a
      join attachment_versions pv on pv.id = a.published_version_id
      join attachment_versions v on v.attachment_id = a.id
      where a.item_id = ${item.id}
      order by a.id, v.number`);
    const pinned = new Map<string, Set<number>>();
    for (const reference of references) {
      if (reference.version === null) continue;
      pinned.set(reference.id, (pinned.get(reference.id) ?? new Set()).add(reference.version));
    }
    const byAttachment = new Map<string, typeof result.rows>();
    for (const row of result.rows) {
      const keep = row.number === row.published_number || pinned.get(row.attachment_id)?.has(row.number);
      if (keep) byAttachment.set(row.attachment_id, [...(byAttachment.get(row.attachment_id) ?? []), row]);
    }
    const copied = new Map<string, CopiedAttachmentPlan>();
    for (const [sourceId, versions] of byAttachment) {
      const first = versions[0] as (typeof versions)[number];
      const id = uuidv7();
      await tx.execute(sql`
        insert into attachments (id, item_id, name, name_key, created_by)
        values (${id}, ${item.copyId}, ${first.name}, ${first.name_key}, ${actorId})`);
      const numbers = new Map<number, number>();
      let publishedVersionId = "";
      for (const [index, version] of versions.entries()) {
        const versionId = uuidv7();
        await tx.execute(sql`
          insert into attachment_versions (id, attachment_id, number, file_id, name, uploaded_by, published_at)
          values (${versionId}, ${id}, ${index + 1}, ${version.file_id}, ${version.version_name}, ${actorId}, now())`);
        numbers.set(version.number, index + 1);
        if (version.number === version.published_number) publishedVersionId = versionId;
      }
      await tx.execute(sql`
        update attachments set current_version_id = ${publishedVersionId}, published_version_id = ${publishedVersionId}
        where id = ${id}`);
      copied.set(sourceId, { id, numbers, published: numbers.get(first.published_number) ?? 1 });
    }
    return copied;
  }

  async #copyPage(context: CopyContext, item: PlannedItem): Promise<void> {
    const { tx, actorId } = context;
    const source = await tx.execute<{
      mode: PageMode;
      snapshot: unknown;
      schema_version: number;
      version_document: unknown;
      version_schema: number | null;
    }>(sql`
      select t.mode, d.snapshot, d.schema_version, v.document as version_document, v.schema_version as version_schema
      from tree_items t join page_documents d on d.item_id = t.id
      left join page_versions v on v.id = t.published_version_id
      where t.id = ${item.id}`);
    const row = source.rows[0];
    if (!row) throw new SpaceError("itemNotFound", "A page to copy has no content");
    const document =
      row.mode === "live" || row.version_schema === null
        ? migrated(row.snapshot, row.schema_version)
        : migrated(row.version_document, row.version_schema);
    const attachments = await this.#copyAttachments(context, item, documentAttachments(document));
    const copied = await copyDrawingScenes(
      copyPageDocument(document, this.#mapping(context, attachments)),
      attachmentScenes(tx, this.#files, item.copyId, async (id) => attachments.get(id)?.id ?? null),
    );
    await insertInitialDocument(tx, item.copyId, actorId, copied);
    await insertFirstVersion(tx, item.copyId, actorId, { itemId: item.id, title: item.title });
    const stored = await tx.execute<{ snapshot: DocumentJson }>(
      sql`select snapshot from page_documents where item_id = ${item.copyId}`,
    );
    const content = stored.rows[0]?.snapshot ?? copied;
    context.linked.push({ itemId: item.copyId, content });
    await this.#activity.readerContentChanged(tx, item.copyId, content, actorId, false);
    await this.#activity.created(tx, item.copyId, actorId);
  }

  async #copyWhiteboard(context: CopyContext, item: PlannedItem): Promise<void> {
    const { tx, actorId } = context;
    const source = await tx.execute<{ scene: unknown; preview_file_id: string | null }>(sql`
      select d.scene, p.file_id as preview_file_id
      from whiteboard_documents d left join whiteboard_previews p on p.id = d.preview_id
      where d.item_id = ${item.id}`);
    const row = source.rows[0];
    if (!row) throw new SpaceError("itemNotFound", "A whiteboard to copy has no content");
    const validated = validateScene(row.scene);
    if (!validated.ok) throw new SpaceError("invalidScene", "A whiteboard to copy has invalid content");
    const attachments = await this.#copyAttachments(context, item, []);
    const mapping = this.#mapping(context, attachments);
    const scene = copyScene(validated.scene, {
      attachment: (id) => attachments.get(id)?.id ?? id,
      href: mapping.href,
    });
    const doc = yDocFromScene(scene);
    const state = encodeState(doc);
    const stateVector = Buffer.from(Y.encodeStateVector(doc));
    doc.destroy();
    let previewId: string | null = null;
    await tx.execute(sql`
      insert into whiteboard_documents (item_id, state, scene, updated_by)
      values (${item.copyId}, ${state}, ${JSON.stringify(scene)}::jsonb, ${actorId})`);
    if (row.preview_file_id) {
      previewId = uuidv7();
      await tx.execute(sql`
        insert into whiteboard_previews (id, item_id, file_id, revision, created_by)
        select ${previewId}, ${item.copyId}, ${row.preview_file_id}, revision, ${actorId}
        from whiteboard_documents where item_id = ${item.copyId}`);
      await tx.execute(
        sql`update whiteboard_documents set preview_id = ${previewId} where item_id = ${item.copyId}`,
      );
    }
    await tx.execute(sql`
      insert into whiteboard_versions (id, item_id, number, title, scene, reason, copied_from_id, copied_from_title,
        revision, state_vector, preview_id, contributors, created_by)
      select ${uuidv7()}, ${item.copyId}, 1, ${item.title}, ${JSON.stringify(scene)}::jsonb, 'copied', ${item.id},
        ${item.title}, revision, ${stateVector}, ${previewId}, ${sql.param(actorId ? [actorId] : [])}::uuid[], ${actorId}
      from whiteboard_documents where item_id = ${item.copyId}`);
    await tx.execute(
      sql`update whiteboard_documents set versioned_revision = revision where item_id = ${item.copyId}`,
    );
    await this.#activity.created(tx, item.copyId, actorId);
  }

  #summary(row: CopyRow): CopySummary {
    const running = row.state === "queued" || row.state === "running";
    return {
      id: row.id,
      state: row.state,
      title: row.title,
      descendants: row.descendants,
      sourceItemId: row.source_item_id,
      targetSpaceId: row.target_space_id,
      progress: {
        done: running ? Math.min(Number(row.done ?? 0), row.total) : row.state === "done" ? row.total : 0,
        total: row.total,
      },
      copied: row.copied,
      hidden: row.hidden,
      skipped: row.skipped,
      item:
        row.root_copy_id &&
        row.item_space_id &&
        row.item_space_key &&
        row.item_kind &&
        row.item_title !== null
          ? {
              id: row.root_copy_id,
              spaceId: row.item_space_id,
              spaceKey: row.item_space_key,
              kind: row.item_kind,
              title: row.item_title,
            }
          : null,
      errorCode: row.error_code,
      createdAt: new Date(row.created_at),
      finishedAt: row.finished_at ? new Date(row.finished_at) : null,
    };
  }
}

interface CopiedAttachmentPlan {
  id: string;
  numbers: Map<number, number>;
  published: number;
}
