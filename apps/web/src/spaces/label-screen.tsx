import { EmptyState, Skeleton } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Tag } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { itemIcon } from "./item-icons.js";
import { itemSlug } from "./item-paths.js";
import { PageBar } from "./page-bar.js";
import { spaceDisplayName } from "./space-badge.js";
import { useSpace } from "./space-context.js";
import { pagePath, spaceKeys } from "./space-queries.js";

const route = getRouteApi("/app/spaces/$spaceKey/labels/$label");
const EVERYWHERE_LIMIT = 100;

type Scope = "space" | "everywhere";

interface LabelEntry {
  id: string;
  title: string;
  kind: string;
  href: string;
  where: string;
  date: string | null;
}

const CHIP =
  "inline-flex h-control-sm items-center rounded-sm px-2 text-sm focus-visible:focus-ring aria-pressed:bg-accent-soft aria-pressed:text-accent hover:bg-hover";

export function LabelScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const { label } = route.useParams();
  const { space } = useSpace();
  const [scope, setScope] = useState<Scope>("space");
  const spaceName = spaceDisplayName(t, space);
  useDocumentTitle(t("labels.pagesTitle", { label }));
  const inSpace = useQuery({
    queryKey: spaceKeys.labelPages(space.id, label),
    enabled: scope === "space",
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/labels/{label}/pages", {
          params: { path: { spaceId: space.id, label } },
        }),
      ),
  });
  const everywhere = useQuery({
    queryKey: ["reports", "contentByLabel", "label-page", label],
    enabled: scope === "everywhere",
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/reports/content-by-label", {
          params: { query: { labels: label, sort: "modified", limit: EVERYWHERE_LIMIT } },
        }),
      ),
  });
  const current = scope === "space" ? inSpace : everywhere;
  const entries: LabelEntry[] | undefined =
    scope === "space"
      ? inSpace.data?.map((page) => ({
          id: page.itemId,
          title: page.title,
          kind: "page",
          href: pagePath(space.key, page.itemId, itemSlug(page.title)),
          where: spaceName,
          date: page.contentUpdatedAt,
        }))
      : everywhere.data?.map((entry) => ({
          id: entry.id,
          title: entry.title,
          kind: entry.kind,
          href: entry.path,
          where: entry.space.name || t("spaces.personal.label"),
          date: null,
        }));

  return (
    <div className="flex min-h-full flex-col">
      <PageBar
        breadcrumbs={[{ label: spaceName, href: `/spaces/${space.key}` }, { label: t("labels.breadcrumb") }]}
      >
        {null}
      </PageBar>
      <div className="mx-auto flex w-full max-w-content flex-col gap-4 px-4 pt-6 pb-12 md:px-8">
        <header className="flex flex-col gap-2">
          <h1 className="flex min-w-0 items-center gap-3 text-xl font-semibold tracking-heading">
            <Tag aria-hidden="true" className="size-icon-lg shrink-0 text-text-muted" />
            <span className="min-w-0 truncate" title={label}>
              {label}
            </span>
          </h1>
          {entries && entries.length > 0 ? (
            <p className="text-text-muted">{t("labels.count", { count: entries.length })}</p>
          ) : null}
          <fieldset className="flex flex-wrap gap-1">
            <legend className="sr-only">{t("labels.scope")}</legend>
            <button
              type="button"
              aria-pressed={scope === "space"}
              className={CHIP}
              onClick={() => setScope("space")}
            >
              {t("labels.inThisSpace")}
            </button>
            <button
              type="button"
              aria-pressed={scope === "everywhere"}
              className={CHIP}
              onClick={() => setScope("everywhere")}
            >
              {t("labels.everywhere")}
            </button>
          </fieldset>
        </header>
        {current.isPending ? <Skeleton className="h-12 w-full" /> : null}
        {current.isError ? (
          <LoadError what={t("labels.pagesFailed")} error={current.error} onRetry={() => current.refetch()} />
        ) : null}
        {entries && entries.length === 0 ? (
          <EmptyState
            icon={Tag}
            title={t("labels.noPages")}
            description={t("labels.noPagesDescription", { label })}
          />
        ) : null}
        {entries && entries.length > 0 ? (
          <ul
            aria-label={t("labels.pagesTitle", { label })}
            className="flex flex-col divide-y divide-border border-y border-border"
          >
            {entries.map((entry) => {
              const Glyph = itemIcon(entry.kind);
              return (
                <li key={entry.id}>
                  <Link
                    to={entry.href as never}
                    className="flex min-h-hit items-center gap-3 py-3 hover:bg-hover focus-visible:focus-ring"
                  >
                    <Glyph aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate" title={entry.title}>
                        {entry.title}
                      </span>
                      <span className="truncate text-xs text-text-muted">
                        {entry.date ? (
                          <>
                            {entry.where} ·{" "}
                            <time dateTime={entry.date} title={format.dateTime(entry.date)}>
                              {format.day(entry.date)}
                            </time>
                          </>
                        ) : (
                          entry.where
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
