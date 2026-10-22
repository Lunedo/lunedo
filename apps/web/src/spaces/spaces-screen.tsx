import { Badge, Button, EmptyState, Input, PageHeader, Select, Skeleton } from "@lunedo/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { FileInput, Layers, Lock, Plus, Search, User, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { useDebounced } from "../components/table-state.js";
import { LoadError } from "../errors/failure.js";
import { OneOnOneDialog } from "../meetings/one-on-one-dialog.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { DiscoverableSpaces } from "../sharing/discoverable-spaces.js";
import { useOrganizationState } from "../shell/shell-context.js";
import { CreateSpaceDialog } from "./create-space-dialog.js";
import { DeletedSpaces } from "./deleted-spaces.js";
import { SpaceBadge, spaceDisplayName } from "./space-badge.js";
import { type Space, spaceKeys } from "./space-queries.js";

const route = getRouteApi("/app/spaces");

export function SpacesScreen() {
  const { t } = useTranslation();
  useDocumentTitle(t("spaces.list.title"));
  const search = route.useSearch();
  const navigate = useNavigate({ from: "/spaces" });
  const state = useOrganizationState();
  const [text, setText] = useState(search.q ?? "");
  const query = useDebounced(text.trim(), 250);
  const organizationFilter = search.organization ?? null;
  const deleted = search.deleted === true;
  const oneOnOnes = search.oneOnOnes === true && !deleted;
  const archived = search.archived === true && !oneOnOnes && !deleted;
  const [creating, setCreating] = useState(false);
  const [creatingOneOnOne, setCreatingOneOnOne] = useState(false);
  const spaces = useInfiniteQuery({
    queryKey: [...spaceKeys.list({ search: query, organizationId: organizationFilter }), archived, oneOnOnes],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request(() =>
        api.GET("/api/v1/spaces", {
          params: {
            query: {
              limit: 50,
              ...(query ? { q: query } : {}),
              ...(organizationFilter ? { organizationId: organizationFilter } : {}),
              ...(archived ? { archived: "true" as const } : {}),
              ...(oneOnOnes ? { oneOnOne: "true" as const } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !deleted,
  });
  const items = spaces.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = query !== "" || organizationFilter !== null || archived || oneOnOnes;
  const canCreate = state.can("organization.spaces.create");

  const setFilter = (next: {
    q?: string;
    organization?: string | null;
    archived?: boolean;
    oneOnOnes?: boolean;
    deleted?: boolean;
  }) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        ...("q" in next ? { q: next.q || undefined } : {}),
        ...("organization" in next ? { organization: next.organization ?? undefined } : {}),
        ...("archived" in next ? { archived: next.archived || undefined } : {}),
        ...("oneOnOnes" in next ? { oneOnOnes: next.oneOnOnes || undefined } : {}),
        ...("deleted" in next ? { deleted: next.deleted || undefined } : {}),
      }),
      replace: true,
    });
  };

  return (
    <main
      id="main"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the content area scrolls and must be reachable by keyboard
      tabIndex={0}
      className="min-w-0 flex-1 overflow-y-auto outline-none focus-visible:focus-ring"
    >
      <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
        <PageHeader
          title={t("spaces.list.title")}
          description={t("spaces.list.description")}
          icon={Layers}
          actions={
            <>
              <Button
                variant="secondary"
                icon={User}
                onClick={() => void navigate({ to: "/personal-space" })}
              >
                {t("spaces.personal.open")}
              </Button>
              <Button variant="secondary" icon={Users} onClick={() => setCreatingOneOnOne(true)}>
                {t("meetings.oneOnOne.new")}
              </Button>
              {canCreate ? (
                <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                  {t("spaces.create.action")}
                </Button>
              ) : null}
            </>
          }
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Input
              type="search"
              aria-label={t("spaces.list.search")}
              placeholder={t("spaces.list.searchPlaceholder")}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setFilter({ q: event.target.value });
              }}
              className="pl-10"
            />
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2 top-1/2 size-icon -translate-y-1/2 text-text-muted"
            />
          </div>
          <div className="sm:w-field">
            <Select
              aria-label={t("spaces.list.archiveFilter")}
              value={deleted ? "deleted" : oneOnOnes ? "oneOnOnes" : archived ? "archived" : "active"}
              onValueChange={(value) =>
                setFilter({
                  archived: value === "archived",
                  oneOnOnes: value === "oneOnOnes",
                  deleted: value === "deleted",
                })
              }
              options={[
                { value: "active", label: t("spaces.list.activeSpaces") },
                { value: "archived", label: t("spaces.list.archivedSpaces") },
                { value: "oneOnOnes", label: t("spaces.list.oneOnOnes") },
                { value: "deleted", label: t("spaces.list.deletedSpaces") },
              ]}
            />
          </div>
          {state.multipleOrganizations && !deleted ? (
            <div className="sm:w-field">
              <Select
                aria-label={t("spaces.list.organizationFilter")}
                value={organizationFilter ?? "all"}
                onValueChange={(value) => setFilter({ organization: value === "all" ? null : value })}
                options={[
                  { value: "all", label: t("spaces.list.allOrganizations") },
                  ...state.organizations.map((organization) => ({
                    value: organization.id,
                    label: organization.name,
                  })),
                ]}
              />
            </div>
          ) : null}
        </div>
        {deleted ? (
          <DeletedSpaces
            search={query}
            onClearSearch={() => {
              setText("");
              setFilter({ q: "" });
            }}
            onShowActive={() => setFilter({ deleted: false })}
          />
        ) : null}
        {spaces.isError ? (
          <LoadError
            what={t("spaces.list.loadFailed")}
            error={spaces.error}
            onRetry={() => spaces.refetch()}
          />
        ) : null}
        {spaces.isPending && !deleted ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : null}
        {spaces.isSuccess && items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={Search}
              title={t("spaces.list.noMatch")}
              description={t("spaces.list.noMatchDescription")}
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setText("");
                    setFilter({
                      q: "",
                      organization: null,
                      archived: false,
                      oneOnOnes: false,
                      deleted: false,
                    });
                  }}
                >
                  {t("spaces.list.clearFilters")}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Layers}
              title={t("spaces.list.none")}
              description={t("spaces.list.noneDescription")}
              action={
                canCreate ? (
                  <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                    {t("spaces.create.action")}
                  </Button>
                ) : undefined
              }
            />
          )
        ) : null}
        {items.length > 0 ? (
          <ul aria-label={t("spaces.list.title")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((space) => (
              <SpaceCard key={space.id} space={space} showOrganization={state.multipleOrganizations} />
            ))}
          </ul>
        ) : null}
        {spaces.hasNextPage ? (
          <div className="flex justify-center">
            <Button
              variant="secondary"
              loading={spaces.isFetchingNextPage}
              onClick={() => void spaces.fetchNextPage()}
            >
              {t("spaces.list.more")}
            </Button>
          </div>
        ) : null}
        {!archived && !deleted && (organizationFilter ?? state.organizationId) ? (
          <DiscoverableSpaces organizationId={organizationFilter ?? state.organizationId ?? ""} />
        ) : null}
      </div>
      <CreateSpaceDialog open={creating} onOpenChange={setCreating} />
      <OneOnOneDialog open={creatingOneOnOne} onOpenChange={setCreatingOneOnOne} />
    </main>
  );
}

function SpaceCard({ space, showOrganization }: { space: Space; showOrganization: boolean }) {
  const { t } = useTranslation();
  const name = spaceDisplayName(t, space);
  return (
    <li className="min-w-0">
      <Link
        to="/spaces/$spaceKey"
        params={{ spaceKey: space.key }}
        className="flex h-full flex-col gap-2 rounded-md border border-border bg-surface p-4 transition-colors focus-visible:focus-ring hover:bg-hover motion-reduce:transition-none"
      >
        <div className="flex items-center gap-3">
          <SpaceBadge space={space} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-semibold" title={name}>
              {name}
            </span>
            <span className="truncate text-sm text-text-muted">
              {space.personal
                ? t("spaces.personal.label")
                : showOrganization
                  ? t("spaces.list.inOrganization", { organization: space.organizationName ?? "" })
                  : space.key}
            </span>
          </div>
        </div>
        {space.description ? (
          <p className="line-clamp-2 text-sm text-text-muted">{space.description}</p>
        ) : null}
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Badge variant="neutral">{t(`spaces.visibility.${space.visibility}.short`)}</Badge>
          {space.quarantined ? (
            <Badge variant="warning" icon={FileInput}>
              {t("imports.quarantine.title")}
            </Badge>
          ) : null}
          {space.confidential ? (
            <Badge variant="accent" icon={Lock}>
              {space.oneOnOne ? t("confidential.oneOnOneBadge") : t("confidential.badge")}
            </Badge>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
