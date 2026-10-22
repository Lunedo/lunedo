import { uuidv7 } from "@lunedo/shared";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import { actorIdOf, auditScopeOf, SpaceError } from "./common.js";
import { lockSpaces } from "./items.js";
import type { TreeItemKind } from "./schema.js";
import { signalSpaceChange } from "./signals.js";
import { visibleItem } from "./visibility.js";

export const SHORTCUT_LABEL_MAX_LENGTH = 80;
export const SHORTCUT_URL_MAX_LENGTH = 2000;
export const MAX_SHORTCUTS = 20;

export type ShortcutTarget = { itemId: string } | { url: string };

export interface ShortcutItem {
  id: string;
  kind: TreeItemKind;
  title: string;
  spaceKey: string;
}

export interface Shortcut {
  id: string;
  label: string;
  url: string | null;
  item: ShortcutItem | null;
  hidden: boolean;
  position: number;
}

type Row = {
  id: string;
  label: string;
  url: string | null;
  item_id: string | null;
  position: number;
  visible: boolean;
  kind: TreeItemKind | null;
  title: string | null;
  key: string | null;
};

function cleanLabel(label: string): string {
  const value = label.replace(/\s+/g, " ").trim();
  if (value.length === 0 || value.length > SHORTCUT_LABEL_MAX_LENGTH) {
    throw new SpaceError("invalidShortcut", `The label needs 1 to ${SHORTCUT_LABEL_MAX_LENGTH} characters`);
  }
  return value;
}

export function cleanShortcutUrl(url: string): string {
  const value = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SpaceError(
      "invalidShortcut",
      "The address needs to be complete and start with https:// or http://",
    );
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.href.length > SHORTCUT_URL_MAX_LENGTH) {
    throw new SpaceError(
      "invalidShortcut",
      "The address needs to be complete and start with https:// or http://",
    );
  }
  return parsed.href;
}

export class ShortcutService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #audit: AuditLog;

  constructor(options: { database: Database; authorization: AuthorizationService; audit: AuditLog }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#audit = options.audit;
  }

  async #rows(executor: Executor, viewer: Principal, spaceId: string): Promise<Row[]> {
    const result = await executor.execute<Row>(sql`
      select sc.id, sc.label, sc.url, sc.item_id, sc.position,
        (sc.item_id is null or coalesce(${visibleItem(this.#authorization, viewer, sql`t`, sql`ts`)}, false)) as visible,
        t.kind, t.title, ts.key
      from space_shortcuts sc
      left join tree_items t on t.id = sc.item_id left join spaces ts on ts.id = t.space_id
      where sc.space_id = ${spaceId}
      order by sc.position, sc.id`);
    return result.rows;
  }

  #toShortcut(row: Row): Shortcut {
    return {
      id: row.id,
      label: row.label,
      url: row.url,
      item:
        row.item_id && row.visible && row.kind && row.title !== null && row.key
          ? { id: row.item_id, kind: row.kind, title: row.title, spaceKey: row.key }
          : null,
      hidden: !row.visible,
      position: row.position,
    };
  }

  async list(viewer: Principal, spaceId: string): Promise<Shortcut[]> {
    const rows = await this.#rows(this.#database, viewer, spaceId);
    return rows.filter((row) => row.visible).map((row) => this.#toShortcut(row));
  }

  async manage(viewer: Principal, spaceId: string): Promise<Shortcut[]> {
    const rows = await this.#rows(this.#database, viewer, spaceId);
    return rows.map((row) => this.#toShortcut(row));
  }

  async #target(
    tx: Transaction,
    actor: Principal,
    target: ShortcutTarget,
  ): Promise<{ itemId: string | null; url: string | null }> {
    if ("url" in target) return { itemId: null, url: cleanShortcutUrl(target.url) };
    const decision = await this.#authorization.explain(
      actor,
      "item.view",
      { type: "item", id: target.itemId },
      { executor: tx, fresh: true },
    );
    const exists = decision.allowed
      ? await tx.execute(sql`
          select 1 from tree_items where id = ${target.itemId} and trash_entry_id is null
            and kind in ('page', 'folder', 'blogPost', 'meetingSeries')`)
      : { rows: [] };
    if (exists.rows.length === 0) {
      throw new SpaceError("shortcutTargetNotFound", "The content does not exist or you cannot open it");
    }
    return { itemId: target.itemId, url: null };
  }

  async #changed(
    tx: Transaction,
    actor: Principal,
    spaceId: string,
    fields: {
      operation: "added" | "changed" | "removed" | "reordered";
      shortcutId: string | null;
      name: string | null;
      url: string | null;
      itemId: string | null;
    },
  ): Promise<void> {
    const space = await tx.execute<{ organization_id: string | null }>(
      sql`select organization_id from spaces where id = ${spaceId}`,
    );
    await this.#audit.record(tx, {
      name: "space.shortcutsChanged",
      actor,
      targetId: spaceId,
      fields,
      scope: auditScopeOf({ organizationId: space.rows[0]?.organization_id ?? null }),
    });
    await signalSpaceChange(tx, { spaceId, kind: "space", itemId: null });
  }

  async #find(tx: Transaction, actor: Principal, spaceId: string, shortcutId: string): Promise<Shortcut> {
    const found = (await this.#rows(tx, actor, spaceId)).find((row) => row.id === shortcutId);
    if (!found) throw new SpaceError("shortcutNotFound", "The shortcut does not exist anymore");
    return this.#toShortcut(found);
  }

  async add(
    actor: Principal,
    spaceId: string,
    input: { label: string; target: ShortcutTarget },
  ): Promise<Shortcut> {
    const label = cleanLabel(input.label);
    return this.#database.transaction(async (tx) => {
      await lockSpaces(tx, [spaceId]);
      const count = await tx.execute<{ count: number; position: number | null }>(sql`
        select count(*)::int as count, max(position) as position from space_shortcuts where space_id = ${spaceId}`);
      if ((count.rows[0]?.count ?? 0) >= MAX_SHORTCUTS) {
        throw new SpaceError("tooManyShortcuts", `A space can have up to ${MAX_SHORTCUTS} shortcuts`);
      }
      const target = await this.#target(tx, actor, input.target);
      const id = uuidv7();
      await tx.execute(sql`
        insert into space_shortcuts (id, space_id, label, item_id, url, position, created_by)
        values (${id}, ${spaceId}, ${label}, ${target.itemId}, ${target.url},
          ${(count.rows[0]?.position ?? -1) + 1}, ${actorIdOf(actor)})`);
      await this.#changed(tx, actor, spaceId, { operation: "added", shortcutId: id, name: label, ...target });
      return this.#find(tx, actor, spaceId, id);
    });
  }

  async update(
    actor: Principal,
    spaceId: string,
    shortcutId: string,
    changes: { label?: string | undefined; target?: ShortcutTarget | undefined },
  ): Promise<Shortcut> {
    const label = changes.label === undefined ? undefined : cleanLabel(changes.label);
    return this.#database.transaction(async (tx) => {
      await lockSpaces(tx, [spaceId]);
      const current = await this.#find(tx, actor, spaceId, shortcutId);
      const target = changes.target ? await this.#target(tx, actor, changes.target) : null;
      await tx.execute(sql`
        update space_shortcuts set label = ${label ?? current.label},
          item_id = ${target ? target.itemId : sql`item_id`}, url = ${target ? target.url : sql`url`},
          updated_at = now()
        where id = ${shortcutId}`);
      const updated = await this.#find(tx, actor, spaceId, shortcutId);
      await this.#changed(tx, actor, spaceId, {
        operation: "changed",
        shortcutId,
        name: updated.label,
        url: target ? target.url : current.url,
        itemId: target ? target.itemId : (current.item?.id ?? null),
      });
      return updated;
    });
  }

  async reorder(actor: Principal, spaceId: string, order: readonly string[]): Promise<Shortcut[]> {
    await this.#database.transaction(async (tx) => {
      await lockSpaces(tx, [spaceId]);
      const current = await tx.execute<{ id: string }>(
        sql`select id from space_shortcuts where space_id = ${spaceId}`,
      );
      const ids = new Set(current.rows.map((row) => row.id));
      if (
        order.length !== ids.size ||
        new Set(order).size !== order.length ||
        order.some((id) => !ids.has(id))
      ) {
        throw new SpaceError(
          "invalidShortcut",
          "Name every shortcut of the space exactly once; reload the list",
        );
      }
      for (const [position, id] of order.entries()) {
        await tx.execute(
          sql`update space_shortcuts set position = ${position}, updated_at = now() where id = ${id}`,
        );
      }
      await this.#changed(tx, actor, spaceId, {
        operation: "reordered",
        shortcutId: null,
        name: null,
        url: null,
        itemId: null,
      });
    });
    return this.manage(actor, spaceId);
  }

  async remove(actor: Principal, spaceId: string, shortcutId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await lockSpaces(tx, [spaceId]);
      const removed = await tx.execute<{ label: string; url: string | null; item_id: string | null }>(sql`
        delete from space_shortcuts where id = ${shortcutId} and space_id = ${spaceId}
        returning label, url, item_id`);
      const row = removed.rows[0];
      if (!row) throw new SpaceError("shortcutNotFound", "The shortcut does not exist anymore");
      await this.#changed(tx, actor, spaceId, {
        operation: "removed",
        shortcutId,
        name: row.label,
        url: row.url,
        itemId: row.item_id,
      });
    });
  }
}
