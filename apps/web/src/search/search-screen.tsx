import {
  Button,
  Drawer,
  EmptyState,
  IconButton,
  Notice,
  PageHeader,
  Popover,
  SegmentedControl,
  Skeleton,
  useToast,
} from "@pagehall/ui";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { CircleHelp, Clock, Search, SearchX, SlidersHorizontal, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { useOrganizationState } from "../shell/shell-context.js";
import { useClearRecentSearches } from "./recent-searches.js";
import { SavedSearchList, SaveSearchButton } from "./saved-searches.js";
import {
  filtersOf,
  type RecentSearch,
  recentSearchesQuery,
  type SearchResponse,
  searchKeys,
  searchPage,
  useForgetSearch,
  useRememberSearch,
} from "./search-api.js";
import { SearchFilterPanel } from "./search-filters.js";
import {
  activeFilterCount,
  clearedFilters,
  fromSearchParams,
  type SearchFilters,
  type SearchSort,
  toSearchParams,
} from "./search-params.js";
import { SearchResult } from "./search-results.js";

const route = getRouteApi("/app/search");

const OPERATORS = [
  ['"exact phrase"', "search.operators.phrase"],
  ["-word", "search.operators.exclude"],
  ["vpn OR proxy", "search.operators.or"],
  ["space:KEY", "search.operators.space"],
  ["label:runbook", "search.operators.label"],
  ["author:anna", "search.operators.author"],
  ["status:verified", "search.operators.status"],
  ["type:blog", "search.operators.type"],
] as const;

function OperatorsHelp() {
  const { t } = useTranslation();
  return (
    <Popover
      label={t("search.operators.title")}
      align="end"
      trigger={<Button icon={CircleHelp}>{t("search.operators.button")}</Button>}
    >
      <div className="flex w-panel max-w-full flex-col gap-2">
        <p className="font-semibold">{t("search.operators.title")}</p>
        <table className="text-sm">
          <tbody>
            {OPERATORS.map(([example, key]) => (
              <tr key={example}>
                <td className="py-1 pr-3 align-top font-mono whitespace-nowrap">{example}</td>
                <td className="py-1 text-text-muted">{t(key)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-sm text-text-muted">{t("search.operators.filtersHint")}</p>
      </div>
    </Popover>
  );
}

export function SearchScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const organization = useOrganizationState();
  const organizationId = organization.organizationId;
  const params = route.useSearch();
  const { query, filters } = fromSearchParams(params);
  const [text, setText] = useState(query);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const remember = useRememberSearch(organizationId);
  useDocumentTitle(query ? t("search.titleWithQuery", { query }) : t("search.title"));

  useEffect(() => {
    setText(query);
  }, [query]);

  const show = (nextQuery: string, nextFilters: SearchFilters, replace = false) =>
    void navigate({ to: "/search", search: toSearchParams(nextQuery, nextFilters), replace });

  const searchable = query.trim().length > 0 || activeFilterCount(filters) > 0;
  const results = useInfiniteQuery({
    queryKey: searchKeys.page(organizationId ?? "", query, filters),
    queryFn: ({ pageParam, signal }) => searchPage(organizationId ?? "", query, filters, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: SearchResponse) => last.nextCursor,
    enabled: organizationId !== null && searchable,
    placeholderData: keepPreviousData,
    throwOnError: false,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed) remember.mutate({ query: trimmed, filters });
    show(trimmed, filters);
  };

  const first = results.data?.pages[0];
  const hits = results.data?.pages.flatMap((page) => page.results) ?? [];
  const count = activeFilterCount(filters);
  const facets = first?.facets ?? null;

  if (organizationId === null) {
    return (
      <SearchFrame>
        <EmptyState icon={Search} title={t("search.title")} description={t("search.noOrganization")} />
      </SearchFrame>
    );
  }

  const panel = (
    <SearchFilterPanel
      facets={facets}
      filters={filters}
      onChange={(next) => show(query, next)}
      footer={<SavedSearchList organizationId={organizationId} />}
    />
  );

  return (
    <SearchFrame>
      <search>
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-field">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-icon -translate-y-1/2 text-text-muted"
            />
            <input
              type="search"
              aria-label={t("search.field")}
              placeholder={t("search.placeholder")}
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="h-control-lg w-full rounded-md border border-control-border bg-control pr-3 pl-10 text-content text-text placeholder:text-text-muted focus-visible:focus-ring"
            />
          </div>
          <Button type="submit" variant="primary">
            {t("search.submit")}
          </Button>
          <OperatorsHelp />
          {searchable ? (
            <SaveSearchButton organizationId={organizationId} query={query} filters={filters} />
          ) : null}
        </form>
      </search>
      <div className="flex items-start gap-8">
        <aside aria-label={t("search.filters.title")} className="hidden w-field shrink-0 md:block">
          {panel}
        </aside>
        <section aria-label={t("search.results")} className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-3 border-b border-border pb-3">
            <Button className="md:hidden" icon={SlidersHorizontal} onClick={() => setFiltersOpen(true)}>
              {count > 0 ? t("search.filters.buttonWithCount", { count }) : t("search.filters.button")}
            </Button>
            <p aria-live="polite" className="min-w-0 flex-1 font-semibold">
              {searchable && first ? t("search.total", { count: first.total }) : null}
            </p>
            <SegmentedControl
              label={t("search.sort.label")}
              value={filters.sort}
              onValueChange={(value) => show(query, { ...filters, sort: value as SearchSort })}
              options={[
                { value: "relevance", label: t("search.sort.relevance") },
                { value: "newest", label: t("search.sort.newest") },
              ]}
            />
          </div>
          {first?.index.building ? (
            <div className="pt-3">
              <Notice variant="info" title={t("search.indexBuilding")}>
                {t("search.indexBuildingDescription")}
              </Notice>
            </div>
          ) : null}
          {!searchable ? (
            <FirstUse
              organizationId={organizationId}
              onSearch={(entry) => show(entry.query, filtersOf(entry.filters))}
            />
          ) : results.isError && !results.data ? (
            <div className="pt-4">
              <LoadError what={t("search.failed")} error={results.error} onRetry={() => results.refetch()} />
            </div>
          ) : results.isPending ? (
            <ResultSkeleton />
          ) : first && first.total === 0 ? (
            <NoResults
              query={query}
              filters={filters}
              suggestion={first.suggestion}
              onShow={(nextQuery, nextFilters) => show(nextQuery, nextFilters)}
            />
          ) : (
            <>
              <div className={results.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
                {hits.map((hit) => (
                  <SearchResult key={`${hit.type}:${hit.id}`} hit={hit} />
                ))}
              </div>
              {results.isFetchNextPageError ? (
                <div className="pt-4">
                  <LoadError
                    what={t("search.moreFailed")}
                    error={results.error}
                    onRetry={() => results.fetchNextPage()}
                  />
                </div>
              ) : null}
              {results.hasNextPage ? (
                <div className="flex justify-center pt-4">
                  <Button loading={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>
                    {t("search.loadMore")}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
      <Drawer
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title={t("search.filters.title")}
        side="right"
        size="panel"
      >
        {panel}
      </Drawer>
    </SearchFrame>
  );
}

function SearchFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto outline-none">
      <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
        <PageHeader title={t("search.title")} icon={Search} />
        {children}
      </div>
    </main>
  );
}

function ResultSkeleton() {
  return (
    <div className="flex flex-col">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex gap-3 border-b border-border py-4">
          <Skeleton className="size-8" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="w-1/3" />
            <Skeleton className="w-2/3" />
            <Skeleton className="w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function FirstUse({
  organizationId,
  onSearch,
}: {
  organizationId: string;
  onSearch: (entry: RecentSearch) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const recent = useQuery({ ...recentSearchesQuery(organizationId), throwOnError: false });
  const forget = useForgetSearch(organizationId);
  const clearRecent = useClearRecentSearches(organizationId);
  const entries = recent.data ?? [];

  const clearAll = () => clearRecent(entries);

  return (
    <div className="flex flex-col gap-4 pt-4">
      <EmptyState
        icon={Search}
        title={t("search.firstUse.title")}
        description={t("search.firstUse.description")}
      />
      {entries.length > 0 ? (
        <section aria-labelledby="recent-searches" className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 id="recent-searches" className="flex-1 text-xs font-semibold text-text-muted uppercase">
              {t("search.recent.title")}
            </h2>
            <Button variant="outline" size="sm" onClick={clearAll}>
              {t("search.recent.clearAll")}
            </Button>
          </div>
          <ul className="flex flex-col">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSearch(entry)}
                  className="flex min-h-hit min-w-0 flex-1 items-center gap-2 rounded-sm px-2 text-left hover:bg-hover focus-visible:focus-ring"
                >
                  <Clock aria-hidden="true" className="size-icon shrink-0 text-text-muted" />
                  <span className="truncate" title={entry.query}>
                    {entry.query}
                  </span>
                </button>
                <IconButton
                  label={t("search.recent.remove", { query: entry.query })}
                  icon={X}
                  size="sm"
                  onClick={() =>
                    forget.mutate(entry.id, {
                      onError: (error) =>
                        toast({
                          title: t("search.recent.removeFailed", { query: entry.query }),
                          description: problemMessage(t, error),
                          variant: "error",
                        }),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function NoResults({
  query,
  filters,
  suggestion,
  onShow,
}: {
  query: string;
  filters: SearchFilters;
  suggestion: string | null;
  onShow: (query: string, filters: SearchFilters) => void;
}) {
  const { t } = useTranslation();
  const count = activeFilterCount(filters);
  const onlySpace = filters.spaceIds.length === 1 ? filters.spaceIds[0] : undefined;
  const space = useQuery({
    queryKey: ["search", "space", onlySpace],
    queryFn: () =>
      request(() => api.GET("/api/v1/spaces/{spaceId}", { params: { path: { spaceId: onlySpace ?? "" } } })),
    enabled: onlySpace !== undefined,
    throwOnError: false,
  });
  const spaceName = space.data?.name;
  const title = !query.trim()
    ? t("search.zero.titleFiltersOnly")
    : count === 0
      ? t("search.zero.title", { query })
      : spaceName && count === 1
        ? t("search.zero.titleInSpace", { query, space: spaceName })
        : t("search.zero.titleFiltered", { query });
  return (
    <div className="pt-4">
      <EmptyState
        icon={SearchX}
        title={title}
        description={
          <span className="flex flex-col gap-2">
            {suggestion ? (
              <span>
                {t("search.zero.didYouMean")}{" "}
                <Link
                  to="/search"
                  search={toSearchParams(suggestion, filters)}
                  className="font-semibold text-accent hover:underline focus-visible:focus-ring"
                >
                  {suggestion}
                </Link>
              </span>
            ) : null}
            <span>{t("search.zero.hint")}</span>
          </span>
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {filters.spaceIds.length > 0 ? (
              <Button onClick={() => onShow(query, { ...filters, spaceIds: [] })}>
                {t("search.zero.allSpaces")}
              </Button>
            ) : null}
            {!filters.includeArchived ? (
              <Button onClick={() => onShow(query, { ...filters, includeArchived: true })}>
                {t("search.zero.includeArchived")}
              </Button>
            ) : null}
            {count > 0 ? (
              <Button onClick={() => onShow(query, clearedFilters(filters))}>
                {t("search.zero.clearFilters", { count })}
              </Button>
            ) : null}
          </div>
        }
      />
    </div>
  );
}
