import { uuidv7 } from "@pagehall/shared";
import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import { type AuthorizationService, ForbiddenError } from "../authorization/service.js";
import type { ContentActivity } from "../collaboration/content.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { SettingsService } from "../settings/service.js";
import { actorIdOf, auditScopeOf, SpaceError } from "./common.js";
import { lockSpaces } from "./items.js";
import type { PeopleService } from "./people.js";
import type { BuiltInPageStatus, PageStatusColor } from "./schema.js";
import { pageStatusEnabledSetting } from "./settings.js";
import { signalSpaceChange } from "./signals.js";

export const PAGE_STATUS_NAME_MAX_LENGTH = 40;
export const MAX_PAGE_STATUS_VALUES = 20;

export const DEFAULT_PAGE_STATUSES: readonly { builtIn: BuiltInPageStatus; color: PageStatusColor }[] = [
  { builtIn: "roughDraft", color: "neutral" },
  { builtIn: "inProgress", color: "info" },
  { builtIn: "readyForReview", color: "warning" },
  { builtIn: "verified", color: "success" },
];

export const BUILT_IN_STATUS_NAMES: Record<BuiltInPageStatus, string> = {
  roughDraft: "Rough draft",
  inProgress: "In progress",
  readyForReview: "Ready for review",
  verified: "Verified",
};

export interface PageStatus {
  id: string;
  builtIn: BuiltInPageStatus | null;
  name: string | null;
  color: PageStatusColor;
}

export interface PageStatusValue extends PageStatus {
  position: number;
  pages: number;
}

export interface PageStatusChange {
  id: string;
  status: Omit<PageStatus, "id"> & { id: string | null };
  removed: boolean;
  actor: { id: string; name: string | null } | null;
  changedAt: Date;
}

const STATUS_KINDS = ["page"] as const;

function cleanName(name: string): string {
  const value = name.replace(/\s+/g, " ").trim();
  if (value.length === 0 || value.length > PAGE_STATUS_NAME_MAX_LENGTH) {
    throw new SpaceError(
      "invalidStatus",
      `The name of a status needs 1 to ${PAGE_STATUS_NAME_MAX_LENGTH} characters`,
    );
  }
  return value;
}

export function statusLabel(status: { builtIn: string | null; name: string | null }): string {
  return status.name ?? BUILT_IN_STATUS_NAMES[status.builtIn as BuiltInPageStatus] ?? "";
}

export async function insertDefaultPageStatuses(tx: Transaction, spaceId: string): Promise<void> {
  for (const [position, value] of DEFAULT_PAGE_STATUSES.entries()) {
    await tx.execute(sql`
      insert into page_status_values (id, space_id, built_in, color, position)
      values (${uuidv7()}, ${spaceId}, ${value.builtIn}, ${value.color}, ${position})`);
  }
}

export function nearestStatusColor(color: string | null): PageStatusColor {
  const match = /^#?([0-9a-f]{6})$/i.exec(color?.trim() ?? "");
  if (!match?.[1]) return "neutral";
  const [red, green, blue] = [0, 2, 4].map(
    (offset) => Number.parseInt(match[1]?.slice(offset, offset + 2) ?? "0", 16) / 255,
  ) as [number, number, number];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  if (max === 0 || (max - min) / max < 0.2) return "neutral";
  const delta = max - min;
  const hue =
    max === red
      ? (60 * ((green - blue) / delta) + 360) % 360
      : max === green
        ? 60 * ((blue - red) / delta) + 120
        : 60 * ((red - green) / delta) + 240;
  if (hue < 20 || hue >= 330) return "danger";
  if (hue < 70) return "warning";
  if (hue < 170) return "success";
  if (hue < 235) return "info";
  return "accent";
}

export async function applyImportedStatus(
  tx: Transaction,
  spaceId: string,
  itemId: string,
  imported: { name: string; color: string | null },
): Promise<void> {
  const name = imported.name.replace(/\s+/g, " ").trim().slice(0, PAGE_STATUS_NAME_MAX_LENGTH);
  if (!name) return;
  await tx.execute(sql`select id from spaces where id = ${spaceId} for update`);
  const values = await tx.execute<{
    id: string;
    built_in: string | null;
    name: string | null;
    color: PageStatusColor;
  }>(
    sql`select id, built_in, name, color from page_status_values where space_id = ${spaceId} order by position, id`,
  );
  let found = values.rows.find(
    (value) =>
      statusLabel({ builtIn: value.built_in, name: value.name }).toLowerCase() === name.toLowerCase(),
  );
  if (!found) {
    if (values.rows.length >= MAX_PAGE_STATUS_VALUES) return;
    const id = uuidv7();
    const color = nearestStatusColor(imported.color);
    await tx.execute(sql`
      insert into page_status_values (id, space_id, name, color, position)
      values (${id}, ${spaceId}, ${name}, ${color},
        (select coalesce(max(position), -1) + 1 from page_status_values where space_id = ${spaceId}))`);
    found = { id, built_in: null, name, color };
  }
  await tx.execute(sql`update tree_items set status_id = ${found.id}, status_changed_at = now(), status_changed_by = null
    where id = ${itemId}`);
  await tx.execute(sql`
    insert into page_status_changes (id, item_id, status_id, built_in, name, color, actor_id)
    values (${uuidv7()}, ${itemId}, ${found.id}, ${found.built_in}, ${found.name}, ${found.color}, null)`);
}

export function pageStatusEnabledCondition(space: SQL): SQL {
  return sql`coalesce((select (sv.value)::boolean from setting_values sv
    where sv.key = ${pageStatusEnabledSetting.key} and sv.level = 'space' and sv.scope_id = ${space}.id
      and sv.value is not null), true)`;
}

export class PageStatusService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #settings: SettingsService;
  readonly #people: PeopleService;
  readonly #audit: AuditLog;
  readonly #activity: ContentActivity;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    settings: SettingsService;
    people: PeopleService;
    audit: AuditLog;
    activity: ContentActivity;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#settings = options.settings;
    this.#people = options.people;
    this.#audit = options.audit;
    this.#activity = options.activity;
  }

  async enabled(spaceId: string): Promise<boolean> {
    const space = await this.#database.execute<{ organization_id: string | null }>(
      sql`select organization_id from spaces where id = ${spaceId}`,
    );
    return this.#settings.get(pageStatusEnabledSetting, {
      ...(space.rows[0]?.organization_id ? { organization: space.rows[0].organization_id } : {}),
      space: spaceId,
    });
  }

  async values(spaceId: string, executor: Executor = this.#database): Promise<PageStatusValue[]> {
    const result = await executor.execute<{
      id: string;
      built_in: BuiltInPageStatus | null;
      name: string | null;
      color: PageStatusColor;
      position: number;
      pages: number;
    }>(sql`
      select v.id, v.built_in, v.name, v.color, v.position,
        (select count(*)::int from tree_items t where t.status_id = v.id and t.trash_entry_id is null) as pages
      from page_status_values v where v.space_id = ${spaceId}
      order by v.position, v.id`);
    return result.rows.map((row) => ({
      id: row.id,
      builtIn: row.built_in,
      name: row.name,
      color: row.color,
      position: row.position,
      pages: Number(row.pages),
    }));
  }

  async #requireManage(tx: Transaction, actor: Principal, spaceId: string): Promise<void> {
    const decision = await this.#authorization.explain(
      actor,
      "space.manage",
      { type: "space", id: spaceId },
      { executor: tx, fresh: true },
    );
    if (!decision.allowed) throw new ForbiddenError(decision);
  }

  async #organizationOf(tx: Transaction, spaceId: string): Promise<string | null> {
    const result = await tx.execute<{ organization_id: string | null }>(
      sql`select organization_id from spaces where id = ${spaceId}`,
    );
    return result.rows[0]?.organization_id ?? null;
  }

  async #changed(
    tx: Transaction,
    actor: Principal,
    spaceId: string,
    fields: {
      operation: "added" | "changed" | "removed" | "reordered";
      valueId: string | null;
      name: string | null;
      pages: number;
    },
  ): Promise<void> {
    await this.#audit.record(tx, {
      name: "space.pageStatusValuesChanged",
      actor,
      targetId: spaceId,
      fields,
      scope: auditScopeOf({ organizationId: await this.#organizationOf(tx, spaceId) }),
    });
    await signalSpaceChange(tx, { spaceId, kind: "space", itemId: null });
  }

  async add(
    actor: Principal,
    spaceId: string,
    input: { name: string; color: PageStatusColor },
  ): Promise<PageStatusValue> {
    const name = cleanName(input.name);
    const id = await this.#database.transaction(async (tx) => {
      await lockSpaces(tx, [spaceId]);
      await this.#requireManage(tx, actor, spaceId);
      const current = await this.values(spaceId, tx);
      if (current.length >= MAX_PAGE_STATUS_VALUES) {
        throw new SpaceError(
          "tooManyStatusValues",
          `A space can have up to ${MAX_PAGE_STATUS_VALUES} status values`,
        );
      }
      if (current.some((value) => statusLabel(value).toLowerCase() === name.toLowerCase())) {
        throw new SpaceError("statusExists", "A status with this name exists already");
      }
      const valueId = uuidv7();
      await tx.execute(sql`
        insert into page_status_values (id, space_id, name, color, position)
        values (${valueId}, ${spaceId}, ${name}, ${input.color},
          ${Math.max(-1, ...current.map((value) => value.position)) + 1})`);
      await this.#changed(tx, actor, spaceId, { operation: "added", valueId, name, pages: 0 });
      return valueId;
    });
    const created = (await this.values(spaceId)).find((value) => value.id === id);
    if (!created) throw new Error("The status was not created");
    return created;
  }

  async #value(tx: Transaction, spaceId: string, valueId: string) {
    const result = await tx.execute<{ id: string; built_in: string | null; name: string | null }>(sql`
      select id, built_in, name from page_status_values
      where id = ${valueId} and space_id = ${spaceId} for update`);
    const row = result.rows[0];
    if (!row) throw new SpaceError("statusNotFound", "The status does not exist anymore");
    return row;
  }

  async update(
    actor: Principal,
    spaceId: string,
    valueId: string,
    changes: { name?: string | undefined; color?: PageStatusColor | undefined },
  ): Promise<PageStatusValue> {
    const name = changes.name === undefined ? undefined : cleanName(changes.name);
    await this.#database.transaction(async (tx) => {
      await lockSpaces(tx, [spaceId]);
      await this.#requireManage(tx, actor, spaceId);
      const value = await this.#value(tx, spaceId, valueId);
      if (name !== undefined) {
        const others = (await this.values(spaceId, tx)).filter((other) => other.id !== valueId);
        if (others.some((other) => statusLabel(other).toLowerCase() === name.toLowerCase())) {
          throw new SpaceError("statusExists", "A status with this name exists already");
        }
      }
      await tx.execute(sql`
        update page_status_values set
          name = coalesce(${name ?? null}, name),
          color = coalesce(${changes.color ?? null}::page_status_color, color),
          updated_at = now()
        where id = ${valueId}`);
      await this.#changed(tx, actor, spaceId, {
        operation: "changed",
        valueId,
        name: name ?? statusLabel({ builtIn: value.built_in, name: value.name }),
        pages: 0,
      });
    });
    const updated = (await this.values(spaceId)).find((value) => value.id === valueId);
    if (!updated) throw new SpaceError("statusNotFound", "The status does not exist anymore");
    return updated;
  }

  async reorder(actor: Principal, spaceId: string, order: readonly string[]): Promise<PageStatusValue[]> {
    await this.#database.transaction(async (tx) => {
      await lockSpaces(tx, [spaceId]);
      await this.#requireManage(tx, actor, spaceId);
      const current = await this.values(spaceId, tx);
      const ids = new Set(current.map((value) => value.id));
      if (
        order.length !== ids.size ||
        new Set(order).size !== order.length ||
        order.some((id) => !ids.has(id))
      ) {
        throw new SpaceError("invalidStatus", "Name every status of the space exactly once; reload the list");
      }
      for (const [position, id] of order.entries()) {
        await tx.execute(
          sql`update page_status_values set position = ${position}, updated_at = now() where id = ${id}`,
        );
      }
      await this.#changed(tx, actor, spaceId, {
        operation: "reordered",
        valueId: null,
        name: null,
        pages: 0,
      });
    });
    return this.values(spaceId);
  }

  async remove(actor: Principal, spaceId: string, valueId: string, confirmedPages: number): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await lockSpaces(tx, [spaceId]);
      await this.#requireManage(tx, actor, spaceId);
      const value = await this.#value(tx, spaceId, valueId);
      const used = await tx.execute<{ pages: number }>(sql`
        select count(*)::int as pages from tree_items where status_id = ${valueId} and trash_entry_id is null`);
      const pages = Number(used.rows[0]?.pages ?? 0);
      if (pages !== confirmedPages) {
        throw new SpaceError(
          "statusInUse",
          `${pages} ${pages === 1 ? "page has" : "pages have"} this status and will lose it. Confirm with this number to remove the status.`,
          { pages },
        );
      }
      await tx.execute(sql`delete from page_status_values where id = ${valueId}`);
      await tx.execute(sql`
        with ordered as (
          select id, row_number() over (order by position, id) - 1 as position
          from page_status_values where space_id = ${spaceId})
        update page_status_values v set position = ordered.position from ordered where v.id = ordered.id`);
      await this.#changed(tx, actor, spaceId, {
        operation: "removed",
        valueId,
        name: statusLabel({ builtIn: value.built_in, name: value.name }),
        pages,
      });
      if (pages > 0) await signalSpaceChange(tx, { spaceId, kind: "tree", itemId: null });
    });
  }

  async set(actor: Principal, itemId: string, statusId: string | null): Promise<PageStatus | null> {
    const actorId = actorIdOf(actor);
    return this.#database.transaction(async (tx) => {
      const item = await tx.execute<{ space_id: string; kind: string; status_id: string | null }>(sql`
        select space_id, kind, status_id from tree_items where id = ${itemId} for update`);
      const row = item.rows[0];
      if (!row) throw new SpaceError("itemNotFound", "The item does not exist");
      const decision = await this.#authorization.explain(
        actor,
        "item.edit",
        { type: "item", id: itemId },
        { executor: tx, fresh: true },
      );
      if (!decision.allowed) throw new ForbiddenError(decision);
      if (!(STATUS_KINDS as readonly string[]).includes(row.kind)) {
        throw new SpaceError("invalidStatus", "Only pages have a status");
      }
      if (!(await this.enabled(row.space_id))) {
        throw new SpaceError("statusDisabled", "Page status is turned off in this space");
      }
      let status: PageStatus | null = null;
      if (statusId !== null) {
        const value = await tx.execute<{
          id: string;
          built_in: BuiltInPageStatus | null;
          name: string | null;
          color: PageStatusColor;
        }>(sql`
          select id, built_in, name, color from page_status_values
          where id = ${statusId} and space_id = ${row.space_id}`);
        const found = value.rows[0];
        if (!found) throw new SpaceError("statusNotFound", "The status does not exist anymore");
        status = { id: found.id, builtIn: found.built_in, name: found.name, color: found.color };
      }
      if (row.status_id === statusId) return status;
      await tx.execute(sql`
        update tree_items set status_id = ${statusId}, status_changed_at = now(), status_changed_by = ${actorId}
        where id = ${itemId}`);
      await tx.execute(sql`
        insert into page_status_changes (id, item_id, status_id, built_in, name, color, actor_id)
        values (${uuidv7()}, ${itemId}, ${statusId}, ${status?.builtIn ?? null}, ${status?.name ?? null},
          ${status?.color ?? null}, ${actorId})`);
      await signalSpaceChange(tx, { spaceId: row.space_id, kind: "tree", itemId });
      await this.#activity.statusChanged(tx, itemId, { actorId, status });
      return status;
    });
  }

  async history(viewer: Principal, itemId: string): Promise<PageStatusChange[]> {
    const result = await this.#database.execute<{
      id: string;
      status_id: string | null;
      built_in: BuiltInPageStatus | null;
      name: string | null;
      color: PageStatusColor | null;
      actor_id: string | null;
      changed_at: Date | string;
    }>(sql`
      select id, status_id, built_in, name, color, actor_id, changed_at from page_status_changes
      where item_id = ${itemId} order by changed_at desc, id desc limit 200`);
    const names = await this.#people.visibleNames(
      viewer,
      result.rows.map((row) => row.actor_id).filter((id): id is string => id !== null),
    );
    return result.rows.map((row) => ({
      id: row.id,
      status: { id: row.status_id, builtIn: row.built_in, name: row.name, color: row.color ?? "neutral" },
      removed: row.color === null,
      actor: row.actor_id ? { id: row.actor_id, name: names.get(row.actor_id) ?? null } : null,
      changedAt: new Date(row.changed_at),
    }));
  }
}
