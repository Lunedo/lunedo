import { uuidv7 } from "@lunedo/shared";
import { sql } from "drizzle-orm";
import { type Principal, SYSTEM } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { ContentActivity } from "../collaboration/content.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { Logger } from "../logging/logger.js";
import type { SettingsService } from "../settings/service.js";
import { actorIdOf, auditScopeOf, SpaceError } from "./common.js";
import { formerAdministratorCondition } from "./former-administrators.js";
import { positionBetween } from "./fractional-index.js";
import { lockSpaces } from "./items.js";
import type { PeopleService } from "./people.js";
import type { TrashEntryKind, TreeItemKind } from "./schema.js";
import { trashFirstStageDaysSetting, trashSecondStageDaysSetting } from "./settings.js";
import { signalSpaceChange } from "./signals.js";
import { refreshReaderVisibility } from "./visibility.js";

export const ERASURE_REASON_MAX_LENGTH = 500;
const PURGE_BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrashEntry {
  id: string;
  spaceId: string;
  spaceKey: string;
  spaceName: string;
  kind: TrashEntryKind;
  itemId: string | null;
  itemKind: TreeItemKind | null;
  title: string;
  descendants: number;
  stage: 1 | 2;
  deletedAt: Date;
  deletedBy: { id: string; name: string | null } | null;
  stageTwoAt: Date | null;
  removedAt: Date;
  formerParentEntryId: string | null;
}

type EntryRow = {
  id: string;
  space_id: string;
  space_key: string;
  space_name: string;
  organization_id: string | null;
  personal: boolean;
  confidential: boolean;
  kind: TrashEntryKind;
  root_item_id: string | null;
  item_kind: TreeItemKind | null;
  title: string;
  descendants: number;
  stage: number;
  purging: boolean;
  deleted_at: Date | string;
  deleted_by: string | null;
  stage_two_at: Date | string | null;
  former_parent_entry_id: string | null;
};

const ENTRY_COLUMNS = sql`e.id, e.space_id, s.key as space_key, s.name as space_name, s.organization_id,
  s.personal_of is not null as personal, s.confidential, e.kind, e.root_item_id, e.item_kind, e.title, e.descendants, e.stage,
  e.purging, e.deleted_at, e.deleted_by, e.stage_two_at,
  (select pe.id from tree_items root
    join tree_items parent on parent.id = root.restore_parent_id
    join trash_entries pe on pe.id = parent.trash_entry_id and pe.kind = 'items' and not pe.purging
    where root.id = e.root_item_id and e.kind = 'items' and root.archived_root_id is distinct from root.id
  ) as former_parent_entry_id`;

export interface ReturnOptions {
  withParents?: boolean;
  mayRestore?: (entry: TrashEntry) => Promise<boolean>;
}

export interface PurgeOptions {
  signal?: AbortSignal;
  batchSize?: number;
}

export interface RetentionResult {
  moved: number;
  purged: number;
  failed: number;
}

function cleanReason(reason: string): string {
  const value = reason.replace(/\s+/g, " ").trim();
  if (value.length === 0 || value.length > ERASURE_REASON_MAX_LENGTH) {
    throw new SpaceError(
      "reasonRequired",
      `Name the reason for the immediate deletion in 1 to ${ERASURE_REASON_MAX_LENGTH} characters`,
    );
  }
  return value;
}

function failureOf(error: unknown): { error: string; code?: string; constraint?: string } {
  const cause = (error as { cause?: unknown }).cause ?? error;
  const details = cause as { code?: unknown; constraint?: unknown };
  return {
    error: error instanceof Error ? error.name : typeof error,
    ...(typeof details.code === "string" ? { code: details.code } : {}),
    ...(typeof details.constraint === "string" ? { constraint: details.constraint } : {}),
  };
}

function chainOf(row: { organization_id: string | null; space_id: string }) {
  return { ...(row.organization_id ? { organization: row.organization_id } : {}), space: row.space_id };
}

export class TrashService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #settings: SettingsService;
  readonly #people: PeopleService;
  readonly #activity: ContentActivity;
  readonly #authorization: AuthorizationService;
  readonly #logger: Logger;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    settings: SettingsService;
    people: PeopleService;
    activity: ContentActivity;
    authorization: AuthorizationService;
    logger: Logger;
  }) {
    this.#authorization = options.authorization;
    this.#logger = options.logger;
    this.#database = options.database;
    this.#audit = options.audit;
    this.#settings = options.settings;
    this.#people = options.people;
    this.#activity = options.activity;
  }

  async #periods(row: { organization_id: string | null; space_id: string }) {
    const chain = chainOf(row);
    return {
      first: await this.#settings.get(trashFirstStageDaysSetting, chain),
      second: await this.#settings.get(trashSecondStageDaysSetting, chain),
    };
  }

  async #toEntries(rows: EntryRow[]): Promise<TrashEntry[]> {
    const names = await this.#people.names(rows.flatMap((row) => (row.deleted_by ? [row.deleted_by] : [])));
    const entries: TrashEntry[] = [];
    const listed = new Set(rows.map((row) => row.id));
    for (const row of rows) {
      const periods = await this.#periods(row);
      const deletedAt = new Date(row.deleted_at);
      const stageTwoAt = row.stage_two_at ? new Date(row.stage_two_at) : null;
      const stage = row.stage === 2 ? 2 : 1;
      const secondStageStart = stageTwoAt ?? new Date(deletedAt.getTime() + periods.first * DAY_MS);
      entries.push({
        id: row.id,
        spaceId: row.space_id,
        spaceKey: row.space_key,
        spaceName: row.space_name,
        kind: row.kind,
        itemId: row.root_item_id,
        itemKind: row.item_kind,
        title: row.title,
        descendants: Number(row.descendants),
        stage,
        deletedAt,
        deletedBy: row.deleted_by ? { id: row.deleted_by, name: names.get(row.deleted_by) ?? null } : null,
        stageTwoAt,
        removedAt: new Date(secondStageStart.getTime() + periods.second * DAY_MS),
        formerParentEntryId:
          row.former_parent_entry_id && listed.has(row.former_parent_entry_id)
            ? row.former_parent_entry_id
            : null,
      });
    }
    return entries;
  }

  async #entry(executor: Executor, entryId: string, lock = false): Promise<EntryRow | null> {
    const result = await executor.execute<EntryRow>(sql`
      select ${ENTRY_COLUMNS} from trash_entries e join spaces s on s.id = e.space_id
      where e.id = ${entryId} ${lock ? sql`for update of e` : sql``}`);
    return result.rows[0] ?? null;
  }

  async get(entryId: string): Promise<TrashEntry | null> {
    const row = await this.#entry(this.#database, entryId);
    return row ? ((await this.#toEntries([row]))[0] ?? null) : null;
  }

  async accessible(viewer: Principal, entryId: string): Promise<boolean> {
    const result = await this.#database.execute<{ accessible: boolean }>(sql`
      select (rt.id is null or ${this.#authorization.itemFilter(viewer, sql`rt`, sql`s`, "editor")}) as accessible
      from trash_entries e join spaces s on s.id = e.space_id left join tree_items rt on rt.id = e.root_item_id
      where e.id = ${entryId}`);
    return result.rows[0]?.accessible === true;
  }

  async spaceOf(entryId: string): Promise<{
    spaceId: string;
    organizationId: string | null;
    personal: boolean;
    confidential: boolean;
  } | null> {
    const row = await this.#entry(this.#database, entryId);
    return row
      ? {
          spaceId: row.space_id,
          organizationId: row.organization_id,
          personal: row.personal,
          confidential: row.confidential,
        }
      : null;
  }

  async listSpace(
    viewer: Principal,
    spaceId: string,
    options: { secondStage?: boolean } = {},
  ): Promise<TrashEntry[]> {
    const result = await this.#database.execute<EntryRow>(sql`
      select ${ENTRY_COLUMNS} from trash_entries e join spaces s on s.id = e.space_id
      left join tree_items rt on rt.id = e.root_item_id
      where e.space_id = ${spaceId} and e.kind = 'items' and not e.purging
        and ${options.secondStage ? sql`e.stage = 2 and s.confidential` : sql`e.stage = 1`}
        and (rt.id is null or ${this.#authorization.itemFilter(viewer, sql`rt`, sql`s`, "editor")})
      order by e.deleted_at desc, e.id limit 1000`);
    return this.#toEntries(result.rows);
  }

  async listOrganization(organizationId: string): Promise<TrashEntry[]> {
    const result = await this.#database.execute<EntryRow>(sql`
      select ${ENTRY_COLUMNS} from trash_entries e join spaces s on s.id = e.space_id
      where s.organization_id = ${organizationId} and not e.purging and not s.confidential
        and (e.kind = 'space' or s.deleted_at is null)
      order by e.stage desc, e.deleted_at desc, e.id limit 1000`);
    return this.#toEntries(result.rows);
  }

  async listPersonal(): Promise<TrashEntry[]> {
    const result = await this.#database.execute<EntryRow>(sql`
      select ${ENTRY_COLUMNS} from trash_entries e join spaces s on s.id = e.space_id
      where s.personal_of is not null and (e.kind = 'space' or (e.stage = 2 and s.deleted_at is null))
        and not e.purging
      order by e.deleted_at desc, e.id limit 1000`);
    return this.#toEntries(result.rows);
  }

  async listDeletedSpaces(viewer: Principal): Promise<TrashEntry[]> {
    if (viewer.type !== "account") return [];
    const result = await this.#database.execute<EntryRow>(sql`
      select ${ENTRY_COLUMNS} from trash_entries e join spaces s on s.id = e.space_id
      where e.kind = 'space' and ${formerAdministratorCondition(sql`e.id`, sql`${viewer.id}::uuid`)}
      order by e.deleted_at desc, e.id limit 1000`);
    return this.#toEntries(result.rows);
  }

  async countDeletedConfidential(organizationId: string): Promise<number> {
    const result = await this.#database.execute<{ count: string }>(sql`
      select count(*) as count from trash_entries e join spaces s on s.id = e.space_id
      where s.organization_id = ${organizationId} and s.confidential and e.kind = 'space' and not e.purging`);
    return Number(result.rows[0]?.count ?? 0);
  }

  async deleteItem(actor: Principal, itemId: string): Promise<TrashEntry> {
    const entryId = await this.#database.transaction((tx) => this.deleteItemWithin(tx, actor, itemId));
    const entry = await this.get(entryId);
    if (!entry) throw new SpaceError("trashEntryNotFound", "The trash entry does not exist");
    return entry;
  }

  async deleteItemWithin(tx: Transaction, actor: Principal, itemId: string): Promise<string> {
    const located = await tx.execute<{ space_id: string }>(
      sql`select space_id from tree_items where id = ${itemId}`,
    );
    const spaceId = located.rows[0]?.space_id;
    if (!spaceId) throw new SpaceError("itemNotFound", "The item does not exist");
    await lockSpaces(tx, [spaceId]);
    const item = await tx.execute<{
      kind: TreeItemKind;
      title: string;
      parent_id: string | null;
      position: string;
      trash_entry_id: string | null;
      archived_root_id: string | null;
      organization_id: string | null;
      overview: boolean;
    }>(sql`
      select t.kind, t.title, t.parent_id, t.position, t.trash_entry_id, t.archived_root_id, s.organization_id,
        s.overview_item_id = t.id as overview
      from tree_items t join spaces s on s.id = t.space_id where t.id = ${itemId} for update of t`);
    const row = item.rows[0];
    if (!row || row.trash_entry_id) throw new SpaceError("itemNotFound", "The item does not exist");
    if (row.overview) throw new SpaceError("overviewPage", "The overview page of a space cannot be deleted");
    const subtree = await tx.execute<{ id: string }>(sql`
      with recursive down as (
        select id from tree_items where id = ${itemId}
        union all
        select t.id from tree_items t join down on t.parent_id = down.id
          or (t.parent_id is null and t.restore_parent_id = down.id and t.archived_root_id = t.id)
        where t.trash_entry_id is null
      )
      select id from down`);
    const ids = subtree.rows.map((entry) => entry.id);
    const overview = await tx.execute<{ id: string }>(sql`
      select id from spaces where overview_item_id = any(${sql.param(ids)}::uuid[])`);
    if (overview.rows[0]) {
      throw new SpaceError("overviewPage", "The overview page of a space cannot be deleted");
    }
    const id = uuidv7();
    await tx.execute(sql`
      insert into trash_entries (id, space_id, kind, root_item_id, title, item_kind, descendants, deleted_by)
      values (${id}, ${spaceId}, 'items', ${itemId}, ${row.title}, ${row.kind}, ${ids.length - 1},
        ${actorIdOf(actor)})`);
    await tx.execute(sql`
      update tree_items set trash_entry_id = ${id}, updated_at = now() where id = any(${sql.param(ids)}::uuid[])`);
    if (row.archived_root_id !== itemId) {
      await tx.execute(sql`
        update tree_items set restore_parent_id = parent_id, restore_position = position, parent_id = null
        where id = ${itemId}`);
    }
    if (row.archived_root_id && row.archived_root_id !== itemId) {
      await tx.execute(sql`
        update tree_items set archived_root_id = null, archived_at = null
        where id = any(${sql.param(ids)}::uuid[]) and archived_root_id = ${row.archived_root_id}`);
    }
    await this.#audit.record(tx, {
      name: "trash.itemsDeleted",
      actor,
      targetId: id,
      fields: {
        spaceId,
        title: row.title,
        kind: "items",
        itemKind: row.kind,
        descendants: ids.length - 1,
        itemId,
      },
      scope: auditScopeOf({ organizationId: row.organization_id }),
    });
    await this.#activity.revealed(tx, await refreshReaderVisibility(tx, [itemId]));
    await signalSpaceChange(tx, { spaceId, kind: "tree", itemId });
    return id;
  }

  async restore(
    actor: Principal,
    entryId: string,
    options: ReturnOptions = {},
  ): Promise<{ itemId: string | null; parentId: string | null; parentEntries: number }> {
    return this.#database.transaction(async (tx) => {
      const located = await this.#entry(tx, entryId);
      if (!located) throw new SpaceError("trashEntryNotFound", "The trash entry does not exist");
      await lockSpaces(tx, [located.space_id]);
      const entry = await this.#entry(tx, entryId, true);
      if (!entry || entry.purging)
        throw new SpaceError("trashEntryNotFound", "The trash entry does not exist");
      if (entry.kind === "space") {
        await tx.execute(
          sql`update spaces set deleted_at = null, updated_at = now() where id = ${entry.space_id}`,
        );
        await tx.execute(sql`delete from trash_entries where id = ${entryId}`);
        await this.#audit.record(tx, {
          name: "space.restored",
          actor,
          targetId: entry.space_id,
          fields: { name: entry.space_name, key: entry.space_key, personal: entry.personal },
          scope: auditScopeOf({ organizationId: entry.organization_id }),
        });
        await signalSpaceChange(tx, { spaceId: entry.space_id, kind: "space", itemId: null });
        await signalSpaceChange(tx, { spaceId: entry.space_id, kind: "access", itemId: null });
        return { itemId: null, parentId: null, parentEntries: 0 };
      }
      return this.#restoreItems(tx, actor, entry, options);
    });
  }

  async #restoreItems(
    tx: Transaction,
    actor: Principal,
    entry: EntryRow,
    options: ReturnOptions,
  ): Promise<{ itemId: string; parentId: string | null; parentEntries: number }> {
    const rootId = entry.root_item_id;
    if (!rootId) throw new SpaceError("trashEntryNotFound", "The trash entry does not exist");
    const root = await tx.execute<{
      restore_parent_id: string | null;
      restore_position: string | null;
      archived_root_id: string | null;
    }>(
      sql`select restore_parent_id, restore_position, archived_root_id from tree_items where id = ${rootId}`,
    );
    const rootRow = root.rows[0];
    if (!rootRow) throw new SpaceError("trashEntryNotFound", "The trash entry does not exist");
    const placed = rootRow.archived_root_id !== rootId;
    const parentEntries = placed
      ? await this.returnBelowParents(tx, actor, entry.space_id, rootId, rootRow.restore_parent_id, options)
      : 0;
    await tx.execute(
      sql`update tree_items set trash_entry_id = null where trash_entry_id = ${entry.id} and id <> ${rootId}`,
    );
    const parentId = placed
      ? await placeBack(tx, entry.space_id, rootId, rootRow.restore_parent_id, rootRow.restore_position)
      : null;
    await tx.execute(sql`update tree_items set trash_entry_id = null where id = ${rootId}`);
    await this.#activity.revealed(tx, await refreshReaderVisibility(tx, [rootId]));
    await tx.execute(sql`delete from trash_entries where id = ${entry.id}`);
    await this.#audit.record(tx, {
      name: "trash.itemsRestored",
      actor,
      targetId: entry.id,
      fields: {
        spaceId: entry.space_id,
        title: entry.title,
        kind: "items",
        itemKind: entry.item_kind,
        descendants: Number(entry.descendants),
        stage: entry.stage,
        parentId,
      },
      scope: auditScopeOf({ organizationId: entry.organization_id }),
    });
    await signalSpaceChange(tx, { spaceId: entry.space_id, kind: "tree", itemId: rootId });
    return { itemId: rootId, parentId, parentEntries };
  }

  async returnBelowParents(
    tx: Transaction,
    actor: Principal,
    spaceId: string,
    itemId: string,
    parentId: string | null,
    options: ReturnOptions,
  ): Promise<number> {
    if (await parentAvailable(tx, spaceId, parentId)) return 0;
    const restricted = await losesViewRestriction(tx, itemId);
    if (!restricted && !options.withParents) return 0;
    const chain = await parentChain(tx, spaceId, parentId);
    const restorable =
      chain.complete && chain.entries.length > 0 && (await this.#mayRestoreAll(chain.entries, options));
    if (!options.withParents || !restorable) {
      if (!restricted) return 0;
      throw await this.#restrictedParent(tx, actor, parentId, restorable ? chain.entries.length : 0);
    }
    for (const parentEntryId of [...chain.entries].reverse()) {
      const parentEntry = await this.#entry(tx, parentEntryId, true);
      if (!parentEntry || parentEntry.purging || parentEntry.kind !== "items") {
        if (!restricted) return 0;
        throw await this.#restrictedParent(tx, actor, parentId, 0);
      }
      await this.#restoreItems(tx, actor, parentEntry, {});
    }
    return chain.entries.length;
  }

  async #mayRestoreAll(entryIds: string[], options: ReturnOptions): Promise<boolean> {
    const check = options.mayRestore;
    if (!check) return false;
    for (const entryId of entryIds) {
      const entry = await this.get(entryId);
      if (!entry || !(await check(entry))) return false;
    }
    return true;
  }

  async #restrictedParent(
    tx: Transaction,
    actor: Principal,
    parentId: string | null,
    parentEntries: number,
  ): Promise<SpaceError> {
    const visible = parentId
      ? await tx.execute<{ title: string }>(sql`
          select p.title from tree_items p join spaces s on s.id = p.space_id
          where p.id = ${parentId} and ${this.#authorization.itemFilter(actor, sql`p`, sql`s`)}`)
      : null;
    const title = visible?.rows[0]?.title;
    const formerParent = parentId && title !== undefined ? { id: parentId, title } : null;
    const message = formerParent
      ? parentEntries > 0
        ? `"${formerParent.title}" is in the trash and restricts who can view this page. Restore the page together with its parent pages to keep that restriction.`
        : `"${formerParent.title}" is in the trash and restricts who can view this page. Ask a space or organization administrator to restore it first.`
      : parentEntries > 0
        ? "This page was below a restricted page. Restore it together with its parent pages, or ask a space or organization administrator."
        : "This page was below a restricted page. Ask a space or organization administrator to restore its parent pages first.";
    return new SpaceError("restrictedParentInTrash", message, { formerParent, parentEntries });
  }

  async empty(actor: Principal, spaceId: string): Promise<number> {
    return this.#database.transaction(async (tx) => {
      await lockSpaces(tx, [spaceId]);
      const space = await tx.execute<{ name: string; organization_id: string | null }>(
        sql`select name, organization_id from spaces where id = ${spaceId}`,
      );
      const spaceRow = space.rows[0];
      if (!spaceRow) throw new SpaceError("spaceNotFound", "The space does not exist");
      const moved = await tx.execute<EntryRow>(sql`
        update trash_entries e set stage = 2, stage_two_at = now()
        from spaces s
        where s.id = e.space_id and e.space_id = ${spaceId} and e.kind = 'items' and e.stage = 1 and not e.purging
        returning ${ENTRY_COLUMNS}`);
      const scope = auditScopeOf({ organizationId: spaceRow.organization_id });
      for (const row of moved.rows) {
        await this.#audit.record(tx, {
          name: "trash.movedToStageTwo",
          actor,
          targetId: row.id,
          fields: {
            spaceId,
            title: row.title,
            kind: row.kind,
            itemKind: row.item_kind,
            descendants: Number(row.descendants),
            cause: "emptied",
          },
          scope,
        });
      }
      await this.#audit.record(tx, {
        name: "trash.emptied",
        actor,
        targetId: spaceId,
        fields: { name: spaceRow.name, entries: moved.rows.length },
        scope,
      });
      await signalSpaceChange(tx, { spaceId, kind: "tree", itemId: null });
      return moved.rows.length;
    });
  }

  async deleteSpace(actor: Principal, spaceId: string, confirmation: string): Promise<TrashEntry> {
    const entryId = await this.#database.transaction(async (tx) => {
      await lockSpaces(tx, [spaceId]);
      const space = await tx.execute<{
        name: string;
        key: string;
        organization_id: string | null;
        personal: boolean;
        deleted: boolean;
      }>(sql`
        select name, key, organization_id, personal_of is not null as personal, deleted_at is not null as deleted
        from spaces where id = ${spaceId}`);
      const row = space.rows[0];
      if (!row || row.deleted) throw new SpaceError("spaceNotFound", "The space does not exist");
      const expected = row.personal && row.name === "" ? row.key : row.name;
      if (confirmation.trim() !== expected.trim()) {
        throw new SpaceError("confirmationMismatch", "Type the name of the space exactly to delete it");
      }
      const id = uuidv7();
      await tx.execute(sql`
        insert into trash_entries (id, space_id, kind, title, stage, deleted_by, stage_two_at)
        values (${id}, ${spaceId}, 'space', ${expected}, 2, ${actorIdOf(actor)}, now())`);
      await tx.execute(sql`
        insert into deleted_space_administrators (trash_entry_id, account_id)
        select ${id}, a.id from accounts a join spaces s on s.id = ${spaceId}
        where (s.personal_of = a.id and a.id = ${actorIdOf(actor)}) or (s.personal_of is null and exists (
          select 1 from space_permissions g where g.space_id = s.id and g.role = 'admin' and (
            (g.principal_kind = 'account' and g.principal_id = a.id)
            or (g.principal_kind = 'group' and exists (select 1 from group_members gm
              where gm.group_id = g.principal_id and gm.account_id = a.id
                and (gm.expires_at is null or gm.expires_at > now())))
            or (g.principal_kind = 'organizationMembers' and exists (select 1 from memberships m
              where m.organization_id = s.organization_id and m.account_id = a.id and m.kind = 'member'
                and (m.expires_at is null or m.expires_at > now())))
            or (g.principal_kind = 'instanceUsers' and a.type = 'standard'))))`);
      await tx.execute(sql`update spaces set deleted_at = now(), updated_at = now() where id = ${spaceId}`);
      await this.#audit.record(tx, {
        name: "space.deleted",
        actor,
        targetId: spaceId,
        fields: { name: row.name, key: row.key, personal: row.personal },
        scope: auditScopeOf({ organizationId: row.organization_id }),
      });
      await signalSpaceChange(tx, { spaceId, kind: "space", itemId: null });
      await signalSpaceChange(tx, { spaceId, kind: "access", itemId: null });
      return id;
    });
    const entry = await this.get(entryId);
    if (!entry) throw new SpaceError("trashEntryNotFound", "The trash entry does not exist");
    return entry;
  }

  async deleteImmediately(actor: Principal, entryId: string, reason: string): Promise<void> {
    const cleaned = cleanReason(reason);
    await this.#database.transaction(async (tx) => {
      const entry = await this.#entry(tx, entryId, true);
      if (!entry || entry.purging)
        throw new SpaceError("trashEntryNotFound", "The trash entry does not exist");
      await tx.execute(sql`update trash_entries set purging = true where id = ${entryId}`);
      await this.#audit.record(tx, {
        name: "trash.deletedImmediately",
        actor,
        targetId: entryId,
        fields: {
          spaceId: entry.space_id,
          title: entry.title,
          kind: entry.kind,
          itemKind: entry.item_kind,
          descendants: Number(entry.descendants),
          reason: cleaned,
        },
        scope: auditScopeOf({ organizationId: entry.organization_id }),
      });
    });
    await this.#purge(entryId, {}, false);
  }

  async applyRetention(options: PurgeOptions = {}): Promise<RetentionResult> {
    const result: RetentionResult = { moved: 0, purged: 0, failed: 0 };
    const attempt = async (row: EntryRow, step: () => Promise<boolean>, counted: "moved" | "purged") => {
      options.signal?.throwIfAborted();
      try {
        if (await step()) result[counted] += 1;
      } catch (error) {
        if (options.signal?.aborted) throw error;
        result.failed += 1;
        this.#logger.warn(
          { entryId: row.id, spaceId: row.space_id, ...failureOf(error) },
          "A trash entry could not be processed and is retried in the next run",
        );
      }
    };
    const firstStage = await this.#database.execute<EntryRow>(sql`
      select ${ENTRY_COLUMNS} from trash_entries e join spaces s on s.id = e.space_id
      where e.stage = 1 and not e.purging order by e.deleted_at limit 1000`);
    for (const row of firstStage.rows) {
      const periods = await this.#periods(row);
      if (new Date(row.deleted_at).getTime() + periods.first * DAY_MS > Date.now()) continue;
      await attempt(row, () => this.#moveToStageTwo(row.id), "moved");
    }
    const candidates = await this.#database.execute<EntryRow>(sql`
      select ${ENTRY_COLUMNS} from trash_entries e join spaces s on s.id = e.space_id
      where e.stage = 2 or e.purging order by e.stage_two_at nulls first limit 1000`);
    for (const row of candidates.rows) {
      if (!row.purging) {
        const periods = await this.#periods(row);
        const start = row.stage_two_at ? new Date(row.stage_two_at).getTime() : Date.now();
        if (start + periods.second * DAY_MS > Date.now()) continue;
      }
      await attempt(row, () => this.#purge(row.id, options, true), "purged");
    }
    return result;
  }

  async #moveToStageTwo(entryId: string): Promise<boolean> {
    return this.#database.transaction(async (tx) => {
      const locked = await tx.execute<EntryRow>(sql`
        select ${ENTRY_COLUMNS} from trash_entries e join spaces s on s.id = e.space_id
        where e.id = ${entryId} and e.stage = 1 and not e.purging for update of e skip locked`);
      const row = locked.rows[0];
      if (!row) return false;
      await tx.execute(sql`update trash_entries set stage = 2, stage_two_at = now() where id = ${entryId}`);
      await this.#audit.record(tx, {
        name: "trash.movedToStageTwo",
        actor: SYSTEM,
        targetId: entryId,
        fields: {
          spaceId: row.space_id,
          title: row.title,
          kind: row.kind,
          itemKind: row.item_kind,
          descendants: Number(row.descendants),
          cause: "expired",
        },
        scope: auditScopeOf({ organizationId: row.organization_id }),
      });
      await signalSpaceChange(tx, { spaceId: row.space_id, kind: "tree", itemId: null });
      return true;
    });
  }

  async #purge(entryId: string, options: PurgeOptions, audited: boolean): Promise<boolean> {
    const start = await this.#database.transaction(async (tx) => {
      const locked = await tx.execute<EntryRow>(sql`
        select ${ENTRY_COLUMNS} from trash_entries e join spaces s on s.id = e.space_id
        where e.id = ${entryId} for update of e skip locked`);
      const row = locked.rows[0];
      if (!row) return null;
      const below = row.kind === "items" ? await entriesBelow(tx, entryId) : [];
      await tx.execute(sql`
        update trash_entries set purging = true
        where id = any(${sql.param([entryId, ...below])}::uuid[]) and not purging`);
      return { ...row, below };
    });
    if (!start) return false;
    for (const below of start.below) await this.#purge(below, options, true);
    const batch = options.batchSize ?? PURGE_BATCH;
    const scope =
      start.kind === "space" ? sql`space_id = ${start.space_id}` : sql`trash_entry_id = ${entryId}`;
    for (;;) {
      options.signal?.throwIfAborted();
      const removed = await this.#database.transaction(async (tx) => {
        const leaves = await tx.execute<{ id: string }>(sql`
          select t.id from tree_items t where ${scope}
            and not exists (select 1 from tree_items c where c.parent_id = t.id)
          limit ${batch}`);
        const ids = leaves.rows.map((row) => row.id);
        if (ids.length === 0) return 0;
        await tx.execute(sql`
          delete from tree_items where kind = 'link' and link_item_id = any(${sql.param(ids)}::uuid[])
            and not (id = any(${sql.param(ids)}::uuid[]))`);
        await tx.execute(sql`delete from tree_items where id = any(${sql.param(ids)}::uuid[])`);
        return ids.length;
      });
      if (removed === 0) break;
    }
    await this.#database.transaction(async (tx) => {
      const remaining = await tx.execute<{ id: string }>(
        sql`select id from trash_entries where id = ${entryId} for update`,
      );
      if (!remaining.rows[0]) return;
      if (start.kind === "space") {
        await tx.execute(
          sql`delete from setting_values where level = 'space' and scope_id = ${start.space_id}`,
        );
        await tx.execute(sql`delete from spaces where id = ${start.space_id}`);
      } else {
        await tx.execute(sql`delete from trash_entries where id = ${entryId}`);
      }
      if (audited) {
        await this.#audit.record(tx, {
          name: "trash.deletedPermanently",
          actor: SYSTEM,
          targetId: entryId,
          fields: {
            spaceId: start.space_id,
            title: start.confidential ? "" : start.title,
            kind: start.kind,
            itemKind: start.item_kind,
            descendants: Number(start.descendants),
          },
          scope: auditScopeOf({ organizationId: start.organization_id }),
        });
      }
      if (start.kind === "items") {
        await signalSpaceChange(tx, { spaceId: start.space_id, kind: "tree", itemId: null });
      }
    });
    return true;
  }
}

async function entriesBelow(tx: Transaction, entryId: string): Promise<string[]> {
  const found = await tx.execute<{ id: string }>(sql`
    with recursive below(id, depth) as (
      select ${entryId}::uuid, 0
      union all
      select c.id, b.depth + 1 from below b
        join tree_items p on p.trash_entry_id = b.id
        join tree_items r on r.restore_parent_id = p.id and r.parent_id is null
        join trash_entries c on c.id = r.trash_entry_id and c.root_item_id = r.id and c.id <> b.id
      where b.depth < 1000
    )
    select id from below where id <> ${entryId} group by id order by max(depth) desc, id`);
  return found.rows.map((row) => row.id);
}

async function parentAvailable(tx: Transaction, spaceId: string, parentId: string | null): Promise<boolean> {
  if (!parentId) return true;
  const found = await tx.execute<{ id: string }>(sql`
    select id from tree_items
    where id = ${parentId} and space_id = ${spaceId} and trash_entry_id is null and kind <> 'link'`);
  return found.rows.length > 0;
}

async function losesViewRestriction(tx: Transaction, itemId: string): Promise<boolean> {
  const found = await tx.execute<{ loses: boolean }>(sql`
    select exists (
      select 1 from tree_items t join page_restrictions r
        on r.kind = 'view' and r.item_id = any(t.path[1:cardinality(t.path) - 1])
      where t.id = ${itemId}
    ) as loses`);
  return found.rows[0]?.loses === true;
}

async function parentChain(
  tx: Transaction,
  spaceId: string,
  parentId: string | null,
): Promise<{ entries: string[]; complete: boolean }> {
  const entries: string[] = [];
  let current = parentId;
  while (current) {
    const found = await tx.execute<{
      space_id: string;
      kind: TreeItemKind;
      trash_entry_id: string | null;
      entry_kind: TrashEntryKind | null;
      purging: boolean | null;
      root_item_id: string | null;
      archived_root_id: string | null;
      restore_parent_id: string | null;
    }>(sql`
      select t.space_id, t.kind, t.trash_entry_id, e.kind as entry_kind, e.purging, e.root_item_id,
        r.archived_root_id, r.restore_parent_id
      from tree_items t left join trash_entries e on e.id = t.trash_entry_id
        left join tree_items r on r.id = e.root_item_id
      where t.id = ${current}`);
    const row = found.rows[0];
    if (!row || row.space_id !== spaceId || row.kind === "link") return { entries, complete: false };
    if (!row.trash_entry_id) return { entries, complete: true };
    if (
      row.entry_kind !== "items" ||
      row.purging ||
      !row.root_item_id ||
      entries.includes(row.trash_entry_id)
    ) {
      return { entries, complete: false };
    }
    entries.push(row.trash_entry_id);
    if (row.archived_root_id === row.root_item_id) return { entries, complete: true };
    current = row.restore_parent_id;
  }
  return { entries, complete: true };
}

export async function placeBack(
  tx: Transaction,
  spaceId: string,
  itemId: string,
  parentId: string | null,
  position: string | null,
): Promise<string | null> {
  const parent = parentId
    ? await tx.execute<{ archived_root_id: string | null }>(sql`
        select archived_root_id from tree_items
        where id = ${parentId} and space_id = ${spaceId} and trash_entry_id is null and kind <> 'link'`)
    : null;
  const parentRow = parent?.rows[0];
  const target = parentRow ? parentId : null;
  const archivedRoot = parentRow ? parentRow.archived_root_id : null;
  const taken = position
    ? await tx.execute<{ id: string }>(sql`
        select id from tree_items where space_id = ${spaceId} and parent_id is not distinct from ${target}
          and position = ${position} and trash_entry_id is null and id <> ${itemId}
          and archived_root_id is distinct from id`)
    : null;
  let place = position;
  if (!place || (taken?.rows.length ?? 0) > 0) {
    const last = await tx.execute<{ position: string | null }>(sql`
      select max(position) as position from tree_items
      where space_id = ${spaceId} and parent_id is not distinct from ${target} and id <> ${itemId}`);
    place = positionBetween(last.rows[0]?.position ?? null, null);
  }
  await tx.execute(sql`
    update tree_items set parent_id = ${target}, position = ${place}, restore_parent_id = null,
      restore_position = null, updated_at = now()
    where id = ${itemId}`);
  await tx.execute(sql`
    with recursive down as (
      select id from tree_items where id = ${itemId}
      union all
      select t.id from tree_items t join down on t.parent_id = down.id where t.trash_entry_id is null
    )
    update tree_items set archived_root_id = ${archivedRoot},
      archived_at = case when ${archivedRoot}::uuid is null then null else archived_at end
    where id in (select id from down)`);
  return target;
}
