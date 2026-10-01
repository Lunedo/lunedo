import { type SQL, type SQLWrapper, sql } from "drizzle-orm";

export type KeysetKey = string[];

export interface PageRequest {
  after?: KeysetKey | undefined;
  limit: number;
}

export interface Page<T> {
  items: T[];
  next: KeysetKey | null;
}

export const MAX_PAGE_SIZE = 1000;

export const FIRST_PAGE: PageRequest = { limit: MAX_PAGE_SIZE };

export function afterKey(columns: SQLWrapper[], after: KeysetKey | undefined): SQL | undefined {
  if (!after) return undefined;
  if (after.length !== columns.length) throw new Error("The cursor does not match the sort order");
  return sql`(${sql.join(columns, sql`, `)}) > (${sql.join(
    after.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

export function pageLimit(request: PageRequest): number {
  return Math.min(Math.max(request.limit, 1), MAX_PAGE_SIZE) + 1;
}

export function toPage<Row, Item>(
  rows: Row[],
  request: PageRequest,
  key: (row: Row) => KeysetKey,
  item: (row: Row) => Item,
): Page<Item> {
  const limit = pageLimit(request) - 1;
  const kept = rows.slice(0, limit);
  const last = kept.at(-1);
  return { items: kept.map(item), next: rows.length > limit && last ? key(last) : null };
}
