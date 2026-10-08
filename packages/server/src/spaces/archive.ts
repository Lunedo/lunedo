import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { ContentActivity } from "../collaboration/content.js";
import type { Database } from "../database/database.js";
import { actorIdOf, auditScopeOf, SpaceError } from "./common.js";
import { lockSpaces } from "./items.js";
import type { TreeItemKind } from "./schema.js";
import { signalSpaceChange } from "./signals.js";
import { placeBack } from "./trash.js";
import { publishedFor, refreshReaderVisibility } from "./visibility.js";

export interface ArchivedItem {
  id: string;
  kind: TreeItemKind;
  title: string;
  hasChildren: boolean;
  archivedAt: Date | null;
  archivedBy: { id: string; name: string | null } | null;
}

export class ArchiveService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #authorization: AuthorizationService;
  readonly #activity: ContentActivity;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    authorization: AuthorizationService;
    activity: ContentActivity;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#authorization = options.authorization;
    this.#activity = options.activity;
  }

  async list(viewer: Principal, spaceId: string): Promise<ArchivedItem[]> {
    const result = await this.#database.execute<{
      id: string;
      kind: TreeItemKind;
      title: string;
      has_children: boolean;
      archived_at: Date | string | null;
      archived_by: string | null;
      archived_by_name: string | null;
    }>(sql`
      select t.id, t.kind, t.title, t.archived_at, t.archived_by, a.name as archived_by_name,
        exists (select 1 from tree_items c where c.parent_id = t.id and c.trash_entry_id is null
          and ${publishedFor(this.#authorization, viewer, sql`c`, sql`s`)}) as has_children
      from tree_items t join spaces s on s.id = t.space_id left join accounts a on a.id = t.archived_by
      where t.space_id = ${spaceId} and t.archived_root_id = t.id and t.trash_entry_id is null
        and ${publishedFor(this.#authorization, viewer, sql`t`, sql`s`)}
      order by lower(t.title), t.id limit 1000`);
    return result.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      hasChildren: row.has_children,
      archivedAt: row.archived_at ? new Date(row.archived_at) : null,
      archivedBy: row.archived_by ? { id: row.archived_by, name: row.archived_by_name } : null,
    }));
  }

  async archive(actor: Principal, itemId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const located = await tx.execute<{ space_id: string }>(
        sql`select space_id from tree_items where id = ${itemId}`,
      );
      const spaceId = located.rows[0]?.space_id;
      if (!spaceId) throw new SpaceError("itemNotFound", "The item does not exist");
      await lockSpaces(tx, [spaceId]);
      const item = await tx.execute<{
        kind: TreeItemKind;
        title: string;
        in_tree: boolean;
        organization_id: string | null;
        overview: boolean;
      }>(sql`
        select t.kind, t.title, (t.trash_entry_id is null and t.archived_root_id is null) as in_tree,
          s.organization_id, s.overview_item_id = t.id as overview
        from tree_items t join spaces s on s.id = t.space_id where t.id = ${itemId} for update of t`);
      const row = item.rows[0];
      if (!row?.in_tree) throw new SpaceError("itemNotFound", "The item is not in the page tree");
      const subtree = await tx.execute<{ id: string }>(sql`
        with recursive down as (
          select id from tree_items where id = ${itemId}
          union all
          select t.id from tree_items t join down on t.parent_id = down.id where t.trash_entry_id is null
        )
        select id from down`);
      const ids = subtree.rows.map((entry) => entry.id);
      const overview = await tx.execute<{ id: string }>(
        sql`select id from spaces where overview_item_id = any(${sql.param(ids)}::uuid[])`,
      );
      if (row.overview || overview.rows[0]) {
        throw new SpaceError("overviewPage", "The overview page of a space cannot be archived");
      }
      await tx.execute(sql`
        update tree_items set archived_root_id = ${itemId}, updated_at = now() where id = any(${sql.param(ids)}::uuid[])`);
      await tx.execute(sql`
        update tree_items set restore_parent_id = parent_id, restore_position = position, parent_id = null,
          archived_at = now(), archived_by = ${actorIdOf(actor)}
        where id = ${itemId}`);
      await refreshReaderVisibility(tx, [itemId]);
      await this.#audit.record(tx, {
        name: "page.archived",
        actor,
        targetId: itemId,
        fields: { spaceId, title: row.title, itemKind: row.kind, descendants: ids.length - 1 },
        scope: auditScopeOf({ organizationId: row.organization_id }),
      });
      await signalSpaceChange(tx, { spaceId, kind: "tree", itemId });
      await signalSpaceChange(tx, { spaceId, kind: "access", itemId });
    });
  }

  async unarchive(actor: Principal, itemId: string): Promise<{ parentId: string | null }> {
    return this.#database.transaction(async (tx) => {
      const located = await tx.execute<{ space_id: string }>(
        sql`select space_id from tree_items where id = ${itemId}`,
      );
      const spaceId = located.rows[0]?.space_id;
      if (!spaceId) throw new SpaceError("itemNotFound", "The item does not exist");
      await lockSpaces(tx, [spaceId]);
      const item = await tx.execute<{
        kind: TreeItemKind;
        title: string;
        archived_root_id: string | null;
        trash_entry_id: string | null;
        restore_parent_id: string | null;
        restore_position: string | null;
        organization_id: string | null;
      }>(sql`
        select t.kind, t.title, t.archived_root_id, t.trash_entry_id, t.restore_parent_id, t.restore_position,
          s.organization_id
        from tree_items t join spaces s on s.id = t.space_id where t.id = ${itemId} for update of t`);
      const row = item.rows[0];
      if (!row || row.trash_entry_id || row.archived_root_id !== itemId) {
        throw new SpaceError("notArchived", "Only an archived page or folder can be brought back");
      }
      const parentId = await placeBack(tx, spaceId, itemId, row.restore_parent_id, row.restore_position);
      await tx.execute(
        sql`update tree_items set archived_at = null, archived_by = null where id = ${itemId}`,
      );
      await this.#activity.revealed(tx, await refreshReaderVisibility(tx, [itemId]));
      await this.#audit.record(tx, {
        name: "page.unarchived",
        actor,
        targetId: itemId,
        fields: { spaceId, title: row.title, itemKind: row.kind, parentId },
        scope: auditScopeOf({ organizationId: row.organization_id }),
      });
      await signalSpaceChange(tx, { spaceId, kind: "tree", itemId });
      await signalSpaceChange(tx, { spaceId, kind: "access", itemId });
      return { parentId };
    });
  }

  async setSpaceArchived(actor: Principal, spaceId: string, archived: boolean): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await lockSpaces(tx, [spaceId]);
      const space = await tx.execute<{ name: string; organization_id: string | null; archived: boolean }>(sql`
        select name, organization_id, archived_at is not null as archived from spaces where id = ${spaceId}`);
      const row = space.rows[0];
      if (!row) throw new SpaceError("spaceNotFound", "The space does not exist");
      if (row.archived === archived) return;
      await tx.execute(sql`
        update spaces set archived_at = ${archived ? sql`now()` : sql`null`},
          archived_by = ${archived ? actorIdOf(actor) : null}, updated_at = now()
        where id = ${spaceId}`);
      await this.#audit.record(tx, {
        name: archived ? "space.archived" : "space.unarchived",
        actor,
        targetId: spaceId,
        fields: { name: row.name },
        scope: auditScopeOf({ organizationId: row.organization_id }),
      });
      await signalSpaceChange(tx, { spaceId, kind: "space", itemId: null });
      await signalSpaceChange(tx, { spaceId, kind: "access", itemId: null });
    });
  }
}
