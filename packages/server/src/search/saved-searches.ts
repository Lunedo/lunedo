import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Principal } from "../accounts/principal.js";
import type { Database, Executor } from "../database/database.js";
import { searchContentTypes, searchSorts, searchUpdatedRanges } from "./adapter.js";
import { MAX_QUERY_LENGTH } from "./query.js";
import { recentSearches, savedSearches } from "./schema.js";

export const RECENT_SEARCH_LIMIT = 10;
export const SAVED_SEARCH_LIMIT = 100;
export const MAX_SAVED_SEARCH_NAME = 100;
const MAX_FILTER_VALUES = 20;

const ids = (description: string) =>
  z.array(z.uuid().describe(description)).max(MAX_FILTER_VALUES).default([]).describe(`${description}s.`);

export const searchFiltersSchema = z
  .object({
    spaceIds: ids("ID of a space"),
    types: z
      .array(
        z
          .enum(searchContentTypes)
          .describe("A type: `page`, `blogPost`, `comment`, `attachment`, `topic` or `decision`."),
      )
      .max(searchContentTypes.length)
      .default([])
      .describe("Types of results."),
    labels: z
      .array(z.string().min(1).max(100).describe("A label."))
      .max(MAX_FILTER_VALUES)
      .default([])
      .describe("Labels."),
    authorIds: ids("ID of an author"),
    statusIds: ids("ID of a status value"),
    languages: z
      .array(z.string().min(1).max(20).describe("A content language code, such as `en`."))
      .max(MAX_FILTER_VALUES)
      .default([])
      .describe("Content languages."),
    updated: z
      .enum(searchUpdatedRanges)
      .nullable()
      .default(null)
      .describe(
        "Changed within the last `week`, `month` (30 days) or `year` (365 days), or null for any time.",
      ),
    includeArchived: z.boolean().default(false).describe("Whether archived pages are included."),
    sort: z.enum(searchSorts).default("relevance").describe("`relevance` or `newest`."),
  })
  .strict()
  .describe("Filters of a search, as on the search page.");

export type SearchFilterValues = z.output<typeof searchFiltersSchema>;

export const searchQueryTextSchema = z
  .string()
  .trim()
  .max(MAX_QUERY_LENGTH)
  .describe("The search text, with operators.");

export interface RecentSearch {
  id: string;
  query: string;
  filters: SearchFilterValues;
  searchedAt: Date;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  filters: SearchFilterValues;
  createdAt: Date;
  updatedAt: Date;
}

export class SavedSearchLimitError extends Error {
  constructor() {
    super(`A person can keep up to ${SAVED_SEARCH_LIMIT} saved searches per organization`);
  }
}

export class SavedSearchNameError extends Error {
  constructor() {
    super("The name of a saved search must not be empty");
  }
}

function canonical(filters: SearchFilterValues): SearchFilterValues {
  const sorted = (values: readonly string[]) => [...new Set(values)].sort();
  return {
    spaceIds: sorted(filters.spaceIds.map((id) => id.toLowerCase())),
    types: [...new Set(filters.types)].sort(),
    labels: sorted(filters.labels),
    authorIds: sorted(filters.authorIds.map((id) => id.toLowerCase())),
    statusIds: sorted(filters.statusIds.map((id) => id.toLowerCase())),
    languages: sorted(filters.languages),
    updated: filters.updated,
    includeArchived: filters.includeArchived,
    sort: filters.sort,
  };
}

function storedFilters(value: unknown): SearchFilterValues {
  const parsed = searchFiltersSchema.safeParse(value);
  return parsed.success ? parsed.data : searchFiltersSchema.parse({});
}

function ownerOf(actor: Principal): string {
  if (actor.type !== "account") throw new Error("Only accounts keep searches");
  return actor.id;
}

export class SavedSearchService {
  readonly #database: Database;

  constructor(options: { database: Database }) {
    this.#database = options.database;
  }

  async recent(actor: Principal, organizationId: string): Promise<RecentSearch[]> {
    const rows = await this.#database
      .select()
      .from(recentSearches)
      .where(
        and(eq(recentSearches.organizationId, organizationId), eq(recentSearches.accountId, ownerOf(actor))),
      )
      .orderBy(desc(recentSearches.searchedAt), desc(recentSearches.id))
      .limit(RECENT_SEARCH_LIMIT);
    return rows.map((row) => ({
      id: row.id,
      query: row.query,
      filters: storedFilters(row.filters),
      searchedAt: row.searchedAt,
    }));
  }

  async remember(
    actor: Principal,
    organizationId: string,
    query: string,
    filters: SearchFilterValues,
  ): Promise<RecentSearch | null> {
    const text = searchQueryTextSchema.parse(query);
    if (text.length === 0) return null;
    const accountId = ownerOf(actor);
    const values = canonical(searchFiltersSchema.parse(filters));
    const fingerprint = JSON.stringify([text, values]);
    return this.#database.transaction(async (tx) => {
      await lock(tx, organizationId, accountId);
      const [row] = await tx
        .insert(recentSearches)
        .values({ organizationId, accountId, query: text, filters: values, fingerprint })
        .onConflictDoUpdate({
          target: [recentSearches.organizationId, recentSearches.accountId, recentSearches.fingerprint],
          set: { searchedAt: sql`now()` },
        })
        .returning();
      await tx.execute(sql`
        delete from recent_searches where organization_id = ${organizationId} and account_id = ${accountId}
          and id not in (select id from recent_searches
            where organization_id = ${organizationId} and account_id = ${accountId}
            order by searched_at desc, id desc limit ${RECENT_SEARCH_LIMIT})`);
      if (!row) return null;
      return { id: row.id, query: row.query, filters: values, searchedAt: row.searchedAt };
    });
  }

  async forget(actor: Principal, organizationId: string, id: string): Promise<boolean> {
    const deleted = await this.#database
      .delete(recentSearches)
      .where(
        and(
          eq(recentSearches.id, id),
          eq(recentSearches.organizationId, organizationId),
          eq(recentSearches.accountId, ownerOf(actor)),
        ),
      )
      .returning({ id: recentSearches.id });
    return deleted.length > 0;
  }

  async forgetAll(actor: Principal, organizationId: string): Promise<void> {
    await this.#database
      .delete(recentSearches)
      .where(
        and(eq(recentSearches.organizationId, organizationId), eq(recentSearches.accountId, ownerOf(actor))),
      );
  }

  async saved(actor: Principal, organizationId: string): Promise<SavedSearch[]> {
    const rows = await this.#database
      .select()
      .from(savedSearches)
      .where(
        and(eq(savedSearches.organizationId, organizationId), eq(savedSearches.accountId, ownerOf(actor))),
      )
      .orderBy(sql`lower(${savedSearches.name})`, savedSearches.id);
    return rows.map(toSaved);
  }

  async save(
    actor: Principal,
    organizationId: string,
    input: { name: string; query: string; filters: SearchFilterValues },
  ): Promise<SavedSearch> {
    const accountId = ownerOf(actor);
    const name = savedName(input.name);
    const query = searchQueryTextSchema.parse(input.query);
    const filters = canonical(searchFiltersSchema.parse(input.filters));
    return this.#database.transaction(async (tx) => {
      await lock(tx, organizationId, accountId);
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(savedSearches)
        .where(and(eq(savedSearches.organizationId, organizationId), eq(savedSearches.accountId, accountId)));
      if ((count?.n ?? 0) >= SAVED_SEARCH_LIMIT) throw new SavedSearchLimitError();
      const [row] = await tx
        .insert(savedSearches)
        .values({ organizationId, accountId, name, query, filters })
        .returning();
      if (!row) throw new Error("The saved search was not stored");
      return toSaved(row);
    });
  }

  async update(
    actor: Principal,
    organizationId: string,
    id: string,
    changes: {
      name?: string | undefined;
      query?: string | undefined;
      filters?: SearchFilterValues | undefined;
    },
  ): Promise<SavedSearch | null> {
    const set: Partial<typeof savedSearches.$inferInsert> = {};
    if (changes.name !== undefined) set.name = savedName(changes.name);
    if (changes.query !== undefined) set.query = searchQueryTextSchema.parse(changes.query);
    if (changes.filters !== undefined) set.filters = canonical(searchFiltersSchema.parse(changes.filters));
    const owned = and(
      eq(savedSearches.id, id),
      eq(savedSearches.organizationId, organizationId),
      eq(savedSearches.accountId, ownerOf(actor)),
    );
    if (Object.keys(set).length === 0) {
      const [row] = await this.#database.select().from(savedSearches).where(owned);
      return row ? toSaved(row) : null;
    }
    const [row] = await this.#database.update(savedSearches).set(set).where(owned).returning();
    return row ? toSaved(row) : null;
  }

  async remove(actor: Principal, organizationId: string, id: string): Promise<boolean> {
    const deleted = await this.#database
      .delete(savedSearches)
      .where(
        and(
          eq(savedSearches.id, id),
          eq(savedSearches.organizationId, organizationId),
          eq(savedSearches.accountId, ownerOf(actor)),
        ),
      )
      .returning({ id: savedSearches.id });
    return deleted.length > 0;
  }

  async afterMembershipEnded(executor: Executor, organizationId: string, accountId: string): Promise<void> {
    await executor.execute(
      sql`delete from recent_searches where organization_id = ${organizationId} and account_id = ${accountId}`,
    );
    await executor.execute(
      sql`delete from saved_searches where organization_id = ${organizationId} and account_id = ${accountId}`,
    );
  }
}

function savedName(value: string): string {
  const name = value.trim().slice(0, MAX_SAVED_SEARCH_NAME);
  if (name.length === 0) throw new SavedSearchNameError();
  return name;
}

function toSaved(row: typeof savedSearches.$inferSelect): SavedSearch {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    filters: storedFilters(row.filters),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function lock(executor: Executor, organizationId: string, accountId: string): Promise<void> {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`searches:${organizationId}:${accountId}`}, 0))`,
  );
}
