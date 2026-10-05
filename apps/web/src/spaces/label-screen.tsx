import { EmptyState, PageHeader, Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { FileText, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { itemSlug } from "./item-paths.js";
import { spaceDisplayName } from "./space-badge.js";
import { useSpace } from "./space-context.js";
import { pagePath, spaceKeys } from "./space-queries.js";

const route = getRouteApi("/app/spaces/$spaceKey/labels/$label");

export function LabelScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const { label } = route.useParams();
  const { space } = useSpace();
  const display = label;
  useDocumentTitle(t("labels.pagesTitle", { label: display }));
  const pages = useQuery({
    queryKey: spaceKeys.labelPages(space.id, label),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/labels/{label}/pages", {
          params: { path: { spaceId: space.id, label } },
        }),
      ),
  });
  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
      <PageHeader
        title={t("labels.pagesTitle", { label: display })}
        description={t("labels.pagesDescription", { space: spaceDisplayName(t, space) })}
        icon={Tag}
        breadcrumbs={[
          { label: spaceDisplayName(t, space), href: `/spaces/${space.key}` },
          { label: display },
        ]}
      />
      {pages.isPending ? <Skeleton className="h-24 w-full" /> : null}
      {pages.isError ? (
        <LoadError what={t("labels.pagesFailed")} error={pages.error} onRetry={() => pages.refetch()} />
      ) : null}
      {pages.data && pages.data.length === 0 ? (
        <EmptyState
          icon={Tag}
          title={t("labels.noPages")}
          description={t("labels.noPagesDescription", { label: display })}
        />
      ) : null}
      {pages.data && pages.data.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {pages.data.map((page) => (
            <li key={page.itemId}>
              <Link
                to={pagePath(space.key, page.itemId, itemSlug(page.title))}
                className="flex min-h-hit items-center gap-3 px-4 py-3 hover:bg-hover focus-visible:focus-ring"
              >
                <FileText aria-hidden="true" className="size-icon shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1 truncate font-medium" title={page.title}>
                  {page.title}
                </span>
                <span className="hidden text-sm text-text-muted sm:block">
                  {format.date(page.contentUpdatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
