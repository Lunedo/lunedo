import { type SQL, sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";

const PENDING = sql`change = 'permission' and applied_at is null and item_id is not null
  and details ->> 'scope' = 'page' and details ->> 'restriction' = 'view'
  and details ->> 'action' in ('restrict', 'unlistHolder')`;

export function narrowsView(details: Record<string, unknown>): boolean {
  return (
    details.scope === "page" &&
    details.restriction === "view" &&
    (details.action === "restrict" || details.action === "unlistHolder")
  );
}

export function heldBy(details: Record<string, unknown>): string[] {
  return Array.isArray(details.heldBy)
    ? details.heldBy.filter((id): id is string => typeof id === "string")
    : [];
}

export function holdsChange(held: SQL, change: SQL): SQL {
  return sql`(${held}.import_id = ${change}.import_id and ${held}.change = 'permission'
    and ${held}.applied_at is null and ${held}.details ->> 'scope' = 'page'
    and ${held}.details ->> 'restriction' = 'view' and ${held}.details ->> 'action' in ('restrict', 'unlistHolder')
    and (${held}.item_id = ${change}.item_id or ${held}.item_id::text in (
      select jsonb_array_elements_text(coalesce(${change}.details -> 'heldBy', '[]'::jsonb)))))`;
}

export function heldCondition(change: SQL): SQL {
  return sql`(${change}.kind = 'page' and ${change}.change in ('conflict', 'updated', 'new', 'labels')
    and exists (select 1 from import_changes held where ${holdsChange(sql`held`, change)}))`;
}

export async function pendingNarrowing(executor: Executor, importId: string): Promise<Set<string>> {
  const result = await executor.execute<{ item_id: string }>(sql`
    select distinct item_id from import_changes where import_id = ${importId} and ${PENDING}`);
  return new Set(result.rows.map((row) => row.item_id));
}

export interface NarrowedPage {
  readonly sourceId?: string | null;
  readonly itemId?: string | null;
  readonly parentItemId?: string | null;
  readonly heldBy?: readonly string[];
}

export class Narrowing {
  readonly #pending: ReadonlySet<string>;
  readonly #below: ReadonlyMap<string, readonly string[]>;
  readonly #sourceParents: ReadonlyMap<string, string | null>;
  readonly #sourceItems: ReadonlyMap<string, string>;
  readonly #sourceCauses = new Map<string, readonly string[]>();

  private constructor(
    pending: ReadonlySet<string>,
    below: ReadonlyMap<string, readonly string[]>,
    sourceParents: ReadonlyMap<string, string | null>,
    sourceItems: ReadonlyMap<string, string>,
  ) {
    this.#pending = pending;
    this.#below = below;
    this.#sourceParents = sourceParents;
    this.#sourceItems = sourceItems;
  }

  static none(): Narrowing {
    return new Narrowing(new Set(), new Map(), new Map(), new Map());
  }

  static async load(
    executor: Executor,
    input: {
      spaceId: string;
      pending: ReadonlySet<string>;
      sourceParents: ReadonlyMap<string, string | null>;
      sourceItems: ReadonlyMap<string, string>;
    },
  ): Promise<Narrowing> {
    if (input.pending.size === 0) return Narrowing.none();
    const pending = [...input.pending];
    const result = await executor.execute<{ id: string; causes: string[] }>(sql`
      select t.id, array(select p from unnest(t.path) p where p = any(${sql.param(pending)}::uuid[])) as causes
      from tree_items t
      where t.space_id = ${input.spaceId} and t.path && ${sql.param(pending)}::uuid[]`);
    const below = new Map(result.rows.map((row) => [row.id, row.causes]));
    return new Narrowing(input.pending, below, input.sourceParents, input.sourceItems);
  }

  get pending(): ReadonlySet<string> {
    return this.#pending;
  }

  causes(page: NarrowedPage): string[] {
    if (this.#pending.size === 0) return [];
    const causes = new Set<string>();
    for (const itemId of [page.itemId, page.parentItemId]) {
      if (!itemId) continue;
      if (this.#pending.has(itemId)) causes.add(itemId);
      for (const cause of this.#below.get(itemId) ?? []) causes.add(cause);
    }
    if (page.sourceId) for (const cause of this.#fromSource(page.sourceId)) causes.add(cause);
    for (const cause of page.heldBy ?? []) if (this.#pending.has(cause)) causes.add(cause);
    return [...causes].sort();
  }

  holds(page: NarrowedPage): boolean {
    return this.causes(page).length > 0;
  }

  #fromSource(sourceId: string): readonly string[] {
    const known = this.#sourceCauses.get(sourceId);
    if (known) return known;
    const path: string[] = [];
    const seen = new Set<string>();
    let current: string | null = sourceId;
    let inherited: readonly string[] = [];
    while (current !== null && !seen.has(current)) {
      const cached = this.#sourceCauses.get(current);
      if (cached) {
        inherited = cached;
        break;
      }
      seen.add(current);
      path.push(current);
      current = this.#sourceParents.get(current) ?? null;
    }
    let causes = inherited;
    for (const id of path.reverse()) {
      const itemId = this.#sourceItems.get(id);
      causes = itemId && this.#pending.has(itemId) ? [...new Set([...causes, itemId])] : causes;
      this.#sourceCauses.set(id, causes);
    }
    return this.#sourceCauses.get(sourceId) ?? [];
  }
}
