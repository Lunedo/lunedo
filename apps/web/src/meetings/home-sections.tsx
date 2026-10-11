import { Avatar, Button, Section, Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarClock, Plus, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "../errors/failure.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { itemSlug } from "../spaces/item-paths.js";
import { pagePath } from "../spaces/space-queries.js";
import { OneOnOneDialog } from "./one-on-one-dialog.js";
import { oneOnOnesQuery, seriesPath, upcomingQuery } from "./queries.js";

export function UpcomingMeetings() {
  const { t } = useTranslation();
  const format = useFormat();
  const upcoming = useQuery({ ...upcomingQuery(), throwOnError: false });
  return (
    <Section title={t("meetings.home.upcoming")} icon={CalendarClock}>
      {upcoming.isPending ? <Skeleton className="h-field w-full" /> : null}
      {upcoming.isError ? (
        <LoadError
          what={t("meetings.home.upcoming")}
          error={upcoming.error}
          onRetry={() => upcoming.refetch()}
        />
      ) : null}
      {upcoming.data?.length === 0 ? (
        <p className="px-2 py-2 text-sm text-text-muted">{t("meetings.home.noUpcoming")}</p>
      ) : null}
      {upcoming.data && upcoming.data.length > 0 ? (
        <ul className="flex flex-col">
          {upcoming.data.map((meeting) => (
            <li key={meeting.id}>
              <Link
                to={pagePath(meeting.spaceKey, meeting.id, itemSlug(meeting.title))}
                className="flex min-h-hit items-center gap-3 rounded-sm px-2 py-1 hover:bg-hover focus-visible:focus-ring"
              >
                <CalendarClock aria-hidden className="size-icon shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1 truncate" title={meeting.seriesTitle ?? meeting.title}>
                  {meeting.seriesTitle ?? meeting.title}
                </span>
                <span className="shrink-0 text-sm text-text-muted">
                  {meeting.startsAt ? format.dateTime(meeting.startsAt) : t("meetings.notScheduled")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

export function OneOnOnes() {
  const { t } = useTranslation();
  const format = useFormat();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ ...oneOnOnesQuery(), throwOnError: false });
  return (
    <Section
      title={t("meetings.home.oneOnOnes")}
      icon={Users}
      actions={
        <Button size="sm" variant="secondary" icon={Plus} onClick={() => setCreating(true)}>
          {t("meetings.oneOnOne.new")}
        </Button>
      }
    >
      {list.isPending ? <Skeleton className="h-field w-full" /> : null}
      {list.isError ? (
        <LoadError what={t("meetings.home.oneOnOnes")} error={list.error} onRetry={() => list.refetch()} />
      ) : null}
      {list.data?.length === 0 ? (
        <p className="px-2 py-2 text-sm text-text-muted">{t("meetings.home.noOneOnOnes")}</p>
      ) : null}
      {list.data && list.data.length > 0 ? (
        <ul className="flex flex-col">
          {list.data.map((entry) => {
            const name =
              entry.partners.map((partner) => partner.name ?? t("meetings.unknownPerson")).join(", ") ||
              t("meetings.home.alone");
            return (
              <li key={entry.spaceId}>
                <Link
                  to={
                    entry.seriesId ? seriesPath(entry.spaceKey, entry.seriesId) : `/spaces/${entry.spaceKey}`
                  }
                  className="flex min-h-hit items-center gap-3 rounded-sm px-2 py-1 hover:bg-hover focus-visible:focus-ring"
                >
                  <Avatar name={name} size="sm" decorative />
                  <span className="min-w-0 flex-1 truncate" title={name}>
                    {name}
                  </span>
                  <span className="shrink-0 text-sm text-text-muted">
                    {entry.nextMeeting?.startsAt
                      ? t("meetings.home.next", { date: format.date(entry.nextMeeting.startsAt) })
                      : t("meetings.notScheduled")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
      <OneOnOneDialog open={creating} onOpenChange={setCreating} />
    </Section>
  );
}
