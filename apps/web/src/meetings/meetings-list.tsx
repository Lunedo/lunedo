import { Badge, Button, Skeleton } from "@lunedo/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { yearInZone } from "../format/zoned.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { itemSlug } from "../spaces/item-paths.js";
import { pagePath } from "../spaces/space-queries.js";
import { type MeetingSummary, meetingKeys } from "./queries.js";

const STATE_BADGE = {
  upcoming: "info",
  reopened: "warning",
  closed: "neutral",
  skipped: "neutral",
} as const;

function yearOf(meeting: MeetingSummary, timeZone: string): string {
  return meeting.startsAt ? yearInZone(new Date(meeting.startsAt), timeZone) : "";
}

export function MeetingsList({ seriesId, spaceKey }: { seriesId: string; spaceKey: string }) {
  const { t } = useTranslation();
  const format = useFormat();
  const meetings = useInfiniteQuery({
    queryKey: meetingKeys.seriesMeetings(seriesId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request(() =>
        api.GET("/api/v1/meeting-series/{seriesId}/meetings", {
          params: { path: { seriesId }, query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  if (meetings.isPending) return <Skeleton className="h-field w-full" />;
  if (meetings.isError) {
    return (
      <LoadError
        what={t("meetings.series.meetingsFailed")}
        error={meetings.error}
        onRetry={() => meetings.refetch()}
      />
    );
  }
  const items = meetings.data.pages.flatMap((page) => page.items);
  const groups: { year: string; items: MeetingSummary[] }[] = [];
  for (const meeting of items) {
    const year = yearOf(meeting, format.settings.timeZone);
    const last = groups.at(-1);
    if (last && last.year === year) last.items.push(meeting);
    else groups.push({ year, items: [meeting] });
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.year || "unscheduled"} aria-label={group.year || t("meetings.notScheduled")}>
          {group.year ? (
            <h3 className="mb-1 text-xs font-semibold tracking-label text-text-muted uppercase">
              {group.year}
            </h3>
          ) : null}
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {group.items.map((meeting) => (
              <li key={meeting.id}>
                <Link
                  to={pagePath(spaceKey, meeting.id, itemSlug(meeting.title))}
                  className="flex min-h-hit flex-wrap items-center gap-3 px-3 py-2 hover:bg-hover focus-visible:focus-ring"
                >
                  <CalendarDays aria-hidden className="size-icon-md text-text-muted" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium" title={meeting.title}>
                      {meeting.startsAt ? format.date(meeting.startsAt) : t("meetings.notScheduled")}
                    </span>
                    <span className="text-sm text-text-muted">
                      {meeting.state === "closed" || meeting.state === "reopened"
                        ? t("meetings.series.attended", { count: meeting.present, total: meeting.attendees })
                        : t("meetings.series.invited", { count: meeting.attendees })}
                    </span>
                  </span>
                  <Badge variant={STATE_BADGE[meeting.state as keyof typeof STATE_BADGE] ?? "neutral"}>
                    {translateKey(t, `meetings.state.${meeting.state}`)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {meetings.hasNextPage ? (
        <Button
          variant="secondary"
          loading={meetings.isFetchingNextPage}
          onClick={() => void meetings.fetchNextPage()}
        >
          {t("meetings.series.loadOlder")}
        </Button>
      ) : null}
    </div>
  );
}
