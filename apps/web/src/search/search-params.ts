import { contentLanguages } from "@pagehall/shared";
import { z } from "zod";

export const searchTypes = ["page", "blogPost", "comment"] as const;
export type SearchType = (typeof searchTypes)[number];
export const updatedRanges = ["week", "month", "year"] as const;
export type UpdatedRange = (typeof updatedRanges)[number];
export const searchSorts = ["relevance", "newest"] as const;
export type SearchSort = (typeof searchSorts)[number];

const RANGE_DAYS: Record<UpdatedRange, number> = { week: 7, month: 30, year: 365 };
const MAX_VALUES = 20;
const DAY_MS = 86_400_000;

const list = z.string().max(2000).optional().catch(undefined);

export const searchPageSearch = z.object({
  q: z.string().max(500).optional().catch(undefined),
  spaces: list,
  types: list,
  labels: list,
  authors: list,
  statuses: list,
  languages: list,
  updated: z.enum(updatedRanges).optional().catch(undefined),
  archived: z.boolean().optional().catch(undefined),
  sort: z.enum(searchSorts).optional().catch(undefined),
});

export type SearchPageSearch = z.output<typeof searchPageSearch>;

export interface SearchFilters {
  spaceIds: string[];
  types: SearchType[];
  labels: string[];
  authorIds: string[];
  statusIds: string[];
  languages: string[];
  updated: UpdatedRange | null;
  includeArchived: boolean;
  sort: SearchSort;
}

export const noFilters: SearchFilters = {
  spaceIds: [],
  types: [],
  labels: [],
  authorIds: [],
  statusIds: [],
  languages: [],
  updated: null,
  includeArchived: false,
  sort: "relevance",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function values(value: string | undefined, valid: (entry: string) => boolean = () => true): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0 && entry.length <= 100 && valid(entry)),
    ),
  ].slice(0, MAX_VALUES);
}

const isId = (entry: string) => UUID.test(entry);

export function fromSearchParams(search: SearchPageSearch): { query: string; filters: SearchFilters } {
  return {
    query: search.q ?? "",
    filters: {
      spaceIds: values(search.spaces, isId),
      types: values(search.types, (entry) =>
        (searchTypes as readonly string[]).includes(entry),
      ) as SearchType[],
      labels: values(search.labels),
      authorIds: values(search.authors, isId),
      statusIds: values(search.statuses, isId),
      languages: values(search.languages, (entry) => (contentLanguages as readonly string[]).includes(entry)),
      updated: search.updated ?? null,
      includeArchived: search.archived ?? false,
      sort: search.sort ?? "relevance",
    },
  };
}

function joined(entries: readonly string[]): string | undefined {
  return entries.length > 0 ? entries.join(",") : undefined;
}

export function toSearchParams(query: string, filters: SearchFilters): SearchPageSearch {
  const search: SearchPageSearch = {};
  if (query.trim()) search.q = query;
  const assign = (
    key: "spaces" | "types" | "labels" | "authors" | "statuses" | "languages",
    entries: string[],
  ) => {
    const value = joined(entries);
    if (value) search[key] = value;
  };
  assign("spaces", filters.spaceIds);
  assign("types", filters.types);
  assign("labels", filters.labels);
  assign("authors", filters.authorIds);
  assign("statuses", filters.statusIds);
  assign("languages", filters.languages);
  if (filters.updated) search.updated = filters.updated;
  if (filters.includeArchived) search.archived = true;
  if (filters.sort !== "relevance") search.sort = filters.sort;
  return search;
}

export function activeFilterCount(filters: SearchFilters): number {
  return (
    filters.spaceIds.length +
    filters.types.length +
    filters.labels.length +
    filters.authorIds.length +
    filters.statusIds.length +
    filters.languages.length +
    (filters.updated ? 1 : 0) +
    (filters.includeArchived ? 1 : 0)
  );
}

export function clearedFilters(filters: SearchFilters): SearchFilters {
  return { ...noFilters, sort: filters.sort };
}

export function updatedAfter(range: UpdatedRange | null, now: number): string | undefined {
  return range ? new Date(now - RANGE_DAYS[range] * DAY_MS).toISOString() : undefined;
}

export function apiFilters(filters: SearchFilters, now: number) {
  const after = updatedAfter(filters.updated, now);
  return {
    ...(joined(filters.spaceIds) ? { spaceIds: joined(filters.spaceIds) } : {}),
    ...(joined(filters.types) ? { types: joined(filters.types) } : {}),
    ...(joined(filters.labels) ? { labels: joined(filters.labels) } : {}),
    ...(joined(filters.authorIds) ? { authorIds: joined(filters.authorIds) } : {}),
    ...(joined(filters.statusIds) ? { statusIds: joined(filters.statusIds) } : {}),
    ...(joined(filters.languages) ? { languages: joined(filters.languages) } : {}),
    ...(after ? { updatedAfter: after } : {}),
    ...(filters.includeArchived ? { includeArchived: "true" as const } : {}),
    sort: filters.sort,
  };
}

export function toggled<T extends string>(entries: readonly T[], entry: T, on: boolean): T[] {
  const rest = entries.filter((existing) => existing !== entry);
  return on ? [...rest, entry] : rest;
}
