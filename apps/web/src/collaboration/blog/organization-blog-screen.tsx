import { Button, EmptyState, Field, Input, PageHeader, Select, Skeleton } from "@pagehall/ui";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { Newspaper } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { fetchAllPages } from "../../api/queries.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { useDocumentTitle } from "../../screens/settings/settings-page.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { collaborationKeys } from "../queries.js";
import { BlogList } from "./blog-list.js";

const route = getRouteApi("/app/blog");

export function OrganizationBlogScreen() {
  const { t } = useTranslation();
  const search = route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const state = useOrganizationState();
  const organizationId = state.organizationId;
  const [label, setLabel] = useState(search.label ?? "");
  useDocumentTitle(t("blog.organizationTitle"));
  useEffect(() => setLabel(search.label ?? ""), [search.label]);
  const filters = {
    ...(search.space ? { spaceId: search.space } : {}),
    ...(search.label ? { label: search.label } : {}),
  };
  const spaces = useQuery({
    queryKey: ["spaces", "list", { search: "", organizationId }, "blogFilter"],
    queryFn: () =>
      fetchAllPages((cursor) =>
        request(() =>
          api.GET("/api/v1/spaces", {
            params: {
              query: {
                limit: 200,
                ...(organizationId ? { organizationId } : {}),
                ...(cursor ? { cursor } : {}),
              },
            },
          }),
        ),
      ),
    enabled: organizationId !== null,
  });
  const posts = useInfiniteQuery({
    queryKey: collaborationKeys.organizationBlog(organizationId ?? "", filters),
    enabled: organizationId !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/blog", {
          params: {
            path: { organizationId: organizationId ?? "" },
            query: { limit: 30, ...filters, ...(pageParam ? { cursor: pageParam } : {}) },
          },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const setFilters = (next: { space?: string | undefined; label?: string | undefined }) =>
    void navigate({ to: "/blog", search: { ...search, ...next }, replace: true });
  const items = posts.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Boolean(search.space || search.label);

  return (
    <main
      id="main"
      tabIndex={0}
      className="min-w-0 flex-1 overflow-y-auto outline-none focus-visible:focus-ring"
    >
      <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
        <PageHeader
          title={t("blog.organizationTitle")}
          description={
            state.organization
              ? t("blog.organizationDescription", { organization: state.organization.name })
              : t("blog.noOrganization")
          }
          icon={Newspaper}
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-field max-w-full">
            <Field label={t("blog.filterSpace")}>
              <Select
                value={search.space ?? "all"}
                onValueChange={(value) => setFilters({ space: value === "all" ? undefined : value })}
                options={[
                  { value: "all", label: t("blog.allSpaces") },
                  ...(spaces.data ?? []).map((space) => ({
                    value: space.id,
                    label: space.name || space.key,
                  })),
                ]}
              />
            </Field>
          </div>
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setFilters({ label: label.trim() || undefined });
            }}
          >
            <div className="w-field max-w-full">
              <Field label={t("blog.filterLabel")}>
                <Input
                  value={label}
                  placeholder={t("blog.filterLabelExample")}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </Field>
            </div>
            <Button type="submit" variant="secondary">
              {t("blog.applyFilter")}
            </Button>
          </form>
          {filtered ? (
            <Button variant="outline" onClick={() => setFilters({ space: undefined, label: undefined })}>
              {t("blog.clearFilters")}
            </Button>
          ) : null}
        </div>
        {posts.isPending && organizationId ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-field w-full" />
            <Skeleton className="h-field w-full" />
          </div>
        ) : null}
        {posts.isError ? (
          <LoadError what={t("blog.loadFailed")} error={posts.error} onRetry={() => posts.refetch()} />
        ) : null}
        {posts.data && items.length === 0 ? (
          <EmptyState
            icon={Newspaper}
            title={filtered ? t("blog.noMatchesTitle") : t("blog.organizationEmptyTitle")}
            description={filtered ? t("blog.noMatchesDescription") : t("blog.organizationEmptyDescription")}
            action={
              filtered ? (
                <Button
                  variant="secondary"
                  onClick={() => setFilters({ space: undefined, label: undefined })}
                >
                  {t("blog.clearFilters")}
                </Button>
              ) : undefined
            }
          />
        ) : null}
        {items.length > 0 && organizationId ? (
          <BlogList
            posts={items}
            level="organization"
            showSpace
            canPin={state.can("organization.blog.pin")}
            onPin={async (post, pinned) => {
              await request(() =>
                api.PUT("/api/v1/organizations/{organizationId}/blog/pinned/{postId}", {
                  params: { path: { organizationId, postId: post.id } },
                  body: { pinned },
                }),
              );
              await queryClient.invalidateQueries({ queryKey: collaborationKeys.allBlogs });
            }}
            hasMore={posts.hasNextPage}
            loadingMore={posts.isFetchingNextPage}
            onMore={() => void posts.fetchNextPage()}
          />
        ) : null}
      </div>
    </main>
  );
}
