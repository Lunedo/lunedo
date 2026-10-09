import { Badge, Button, EmptyState, PageHeader, Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarClock, Plus, Repeat } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "../errors/failure.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { spaceDisplayName } from "../spaces/space-badge.js";
import { useSpace } from "../spaces/space-context.js";
import { CreateSeriesDialog } from "./create-series-dialog.js";
import { seriesPath, spaceSeriesQuery } from "./queries.js";

export function SeriesListScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const { space, canEdit } = useSpace();
  const [creating, setCreating] = useState(false);
  useDocumentTitle(t("meetings.list.documentTitle", { space: spaceDisplayName(t, space) }));
  const series = useQuery(spaceSeriesQuery(space.id));
  const newSeries = canEdit ? (
    <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
      {t("meetings.list.create")}
    </Button>
  ) : undefined;
  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
      <PageHeader
        title={t("meetings.title")}
        description={t("meetings.list.description")}
        icon={Repeat}
        breadcrumbs={[
          { label: spaceDisplayName(t, space), href: `/spaces/${space.key}` },
          { label: t("meetings.title") },
        ]}
        actions={newSeries}
      />
      {series.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-field w-full" />
          <Skeleton className="h-field w-full" />
        </div>
      ) : null}
      {series.isError ? (
        <LoadError
          what={t("meetings.list.loadFailed")}
          error={series.error}
          onRetry={() => series.refetch()}
        />
      ) : null}
      {series.data && series.data.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title={t("meetings.list.emptyTitle")}
          description={canEdit ? t("meetings.list.emptyEditor") : t("meetings.list.emptyReader")}
          action={newSeries}
        />
      ) : null}
      {series.data && series.data.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {series.data.map((entry) => (
            <li key={entry.id}>
              <Link
                to={seriesPath(space.key, entry.id)}
                className="flex min-h-hit flex-wrap items-center gap-3 px-4 py-3 hover:bg-hover focus-visible:focus-ring"
              >
                <Repeat aria-hidden className="size-icon text-text-muted" />
                <span className="min-w-0 flex-1 basis-field truncate font-semibold" title={entry.title}>
                  {entry.title}
                </span>
                {entry.archived ? <Badge>{t("meetings.ended")}</Badge> : null}
                {!entry.archived ? (
                  <span className="flex items-center gap-1 text-sm text-text-muted">
                    <CalendarClock aria-hidden className="size-icon" />
                    {entry.upcomingAt
                      ? t("meetings.list.next", { date: format.dateTime(entry.upcomingAt) })
                      : t("meetings.notScheduled")}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <CreateSeriesDialog space={space} open={creating} onOpenChange={setCreating} />
    </div>
  );
}
