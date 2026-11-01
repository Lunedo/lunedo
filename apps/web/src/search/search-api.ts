import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { paths } from "../api/generated/schema.js";
import { ApiError, request } from "../api/request.js";
import { apiFilters, noFilters, type SearchFilters, searchTypes } from "./search-params.js";

type Json<T> = T extends { content: { "application/json": infer Body } } ? Body : never;
type Ok<Path extends keyof paths, Method extends "get" | "post" | "patch"> = Json<
  NonNullable<paths[Path][Method]> extends { responses: infer Responses }
    ? Responses[keyof Responses & (200 | 201)]
    : never
>;

export type SearchResponse = Ok<"/api/v1/organizations/{organizationId}/search", "get">;
export type SearchHit = SearchResponse["results"][number];
export type SearchFacets = NonNullable<SearchResponse["facets"]>;
export type RecentSearch = Ok<"/api/v1/organizations/{organizationId}/search/recent", "get">[number];
export type SavedSearch = Ok<"/api/v1/organizations/{organizationId}/search/saved", "get">[number];
export type Person = Ok<"/api/v1/people", "get">["items"][number];
export type RecentItem = Ok<"/api/v1/recent", "get">[number];

export const QUICK_DEBOUNCE_MS = 150;
const BUSY_RETRY_MS = 2_000;

export function searchBusy(error: unknown): boolean {
  return error instanceof ApiError && error.code === "searchBusy";
}

function retryWhenBusy(failures: number, error: unknown): boolean {
  return failures < 1 && searchBusy(error);
}

function busyRetryDelay(_attempt: number, error: unknown): number {
  const seconds = error instanceof ApiError ? error.problem.retryAfterSeconds : undefined;
  return typeof seconds === "number" ? Math.min(seconds * 1000, BUSY_RETRY_MS) : BUSY_RETRY_MS;
}
const PAGE_SIZE = 20;

export const searchKeys = {
  all: ["search"] as const,
  quick: (organizationId: string, query: string, spaceId: string | null) =>
    ["search", organizationId, "quick", query, spaceId] as const,
  page: (organizationId: string, query: string, filters: SearchFilters) =>
    ["search", organizationId, "page", query, filters] as const,
  recent: (organizationId: string) => ["search", organizationId, "recent"] as const,
  saved: (organizationId: string) => ["search", organizationId, "saved"] as const,
  people: (query: string, limit: number) => ["search", "people", query, limit] as const,
  spaces: (organizationId: string, query: string, limit: number) =>
    ["search", organizationId, "spaces", query, limit] as const,
};

export function quickSearchQuery(organizationId: string, query: string, spaceId: string | null) {
  return queryOptions({
    queryKey: searchKeys.quick(organizationId, query, spaceId),
    queryFn: ({ signal }) =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/search", {
          params: {
            path: { organizationId },
            query: { q: query, mode: "quick", ...(spaceId ? { spaceId } : {}) },
          },
          signal,
        }),
      ),
    staleTime: 10_000,
    placeholderData: keepPreviousData,
    retry: retryWhenBusy,
    retryDelay: busyRetryDelay,
  });
}

export function searchPage(
  organizationId: string,
  query: string,
  filters: SearchFilters,
  cursor: string | null,
  signal: AbortSignal,
) {
  return request(() =>
    api.GET("/api/v1/organizations/{organizationId}/search", {
      params: {
        path: { organizationId },
        query: {
          q: query,
          ...apiFilters(filters, Date.now()),
          limit: PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        },
      },
      signal,
    }),
  );
}

export function searchResultsQuery(organizationId: string, query: string, filters: SearchFilters) {
  return infiniteQueryOptions({
    queryKey: searchKeys.page(organizationId, query, filters),
    queryFn: ({ pageParam, signal }) => searchPage(organizationId, query, filters, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: SearchResponse) => last.nextCursor,
    retry: retryWhenBusy,
    retryDelay: busyRetryDelay,
  });
}

export function peopleQuery(query: string, limit = 3) {
  return queryOptions({
    queryKey: searchKeys.people(query, limit),
    queryFn: ({ signal }) =>
      request(() => api.GET("/api/v1/people", { params: { query: { q: query, limit } }, signal })),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function spacesQuery(organizationId: string, query: string, limit = 3) {
  return queryOptions({
    queryKey: searchKeys.spaces(organizationId, query, limit),
    queryFn: ({ signal }) =>
      request(() =>
        api.GET("/api/v1/spaces", { params: { query: { q: query, organizationId, limit } }, signal }),
      ),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function recentSearchesQuery(organizationId: string) {
  return queryOptions({
    queryKey: searchKeys.recent(organizationId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/search/recent", {
          params: { path: { organizationId } },
        }),
      ),
    staleTime: 10_000,
  });
}

export function savedSearchesQuery(organizationId: string) {
  return queryOptions({
    queryKey: searchKeys.saved(organizationId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/search/saved", {
          params: { path: { organizationId } },
        }),
      ),
    staleTime: 30_000,
  });
}

export const recentlyViewedQuery = queryOptions({
  queryKey: ["home", "recent"] as const,
  queryFn: () => request(() => api.GET("/api/v1/recent")),
  staleTime: 10_000,
});

export function useRememberSearch(organizationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ query, filters }: { query: string; filters?: SearchFilters }) => {
      if (!organizationId || !query.trim()) return Promise.resolve();
      return request(() =>
        api.POST("/api/v1/organizations/{organizationId}/search/recent", {
          params: { path: { organizationId } },
          body: { query, filters: filters ?? noFilters },
        }),
      ).then(() => undefined);
    },
    onSettled: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: searchKeys.recent(organizationId) });
    },
  });
}

export function useForgetSearch(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (searchId: string | null) =>
      searchId
        ? request(() =>
            api.DELETE("/api/v1/organizations/{organizationId}/search/recent/{searchId}", {
              params: { path: { organizationId, searchId } },
            }),
          )
        : request(() =>
            api.DELETE("/api/v1/organizations/{organizationId}/search/recent", {
              params: { path: { organizationId } },
            }),
          ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: searchKeys.recent(organizationId) }),
  });
}

export function useSaveSearch(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; query: string; filters: SearchFilters }) =>
      request(() =>
        api.POST("/api/v1/organizations/{organizationId}/search/saved", {
          params: { path: { organizationId } },
          body: input,
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: searchKeys.saved(organizationId) }),
  });
}

export function useRenameSavedSearch(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ searchId, name }: { searchId: string; name: string }) =>
      request(() =>
        api.PATCH("/api/v1/organizations/{organizationId}/search/saved/{searchId}", {
          params: { path: { organizationId, searchId } },
          body: { name },
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: searchKeys.saved(organizationId) }),
  });
}

export function useDeleteSavedSearch(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (searchId: string) =>
      request(() =>
        api.DELETE("/api/v1/organizations/{organizationId}/search/saved/{searchId}", {
          params: { path: { organizationId, searchId } },
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: searchKeys.saved(organizationId) }),
  });
}

export function useSavedSearches(organizationId: string | null) {
  return useQuery({
    ...savedSearchesQuery(organizationId ?? ""),
    enabled: organizationId !== null,
    throwOnError: false,
  });
}

export function filtersOf(stored: SavedSearch["filters"]): SearchFilters {
  return {
    spaceIds: stored.spaceIds,
    types: stored.types.filter((type): type is SearchFilters["types"][number] =>
      (searchTypes as readonly string[]).includes(type),
    ),
    labels: stored.labels,
    authorIds: stored.authorIds,
    statusIds: stored.statusIds,
    languages: stored.languages,
    updated: stored.updated,
    includeArchived: stored.includeArchived,
    sort: stored.sort,
  };
}
