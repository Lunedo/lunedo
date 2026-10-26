import { Button, Section } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { HomeEmpty, HomeRow, HomeRowsSkeleton } from "../collaboration/home-rows.js";
import { PersonAvatar } from "../components/person-avatar.js";
import { LoadError } from "../errors/failure.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { itemSlug } from "../spaces/item-paths.js";
import { pagePath } from "../spaces/space-queries.js";
import { OneOnOneDialog } from "./one-on-one-dialog.js";
import { isToday, oneOnOnesQuery, seriesPath, upcomingQuery } from "./queries.js";

export function UpcomingMeetings() {
  const { t } = useTranslation();
  const format = useFormat();
  const upcoming = useQuery({ ...upcomingQuery(false), throwOnError: false });
  return (
    <Section title={t("meetings.home.upcoming")}>
      {upcoming.isPending ? <HomeRowsSkeleton /> : null}
      {upcoming.isError ? (
        <LoadError
          what={t("meetings.home.upcoming")}
          error={upcoming.error}
          onRetry={() => upcoming.refetch()}
        />
      ) : null}
      {upcoming.data?.length === 0 ? <HomeEmpty text={t("meetings.home.noUpcoming")} /> : null}
      {upcoming.data?.map((meeting) => (
        <HomeRow
          key={meeting.id}
          to={pagePath(meeting.spaceKey, meeting.id, itemSlug(meeting.title))}
          leading={<CalendarDays aria-hidden="true" className="size-icon-md" />}
          title={meeting.seriesTitle ?? meeting.title}
          meta={meeting.startsAt ? format.weekdayDateTime(meeting.startsAt) : t("meetings.notScheduled")}
        />
      ))}
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
      actions={
        <Button size="sm" variant="secondary" icon={Plus} onClick={() => setCreating(true)}>
          {t("meetings.oneOnOne.new")}
        </Button>
      }
    >
      {list.isPending ? <HomeRowsSkeleton /> : null}
      {list.isError ? (
        <LoadError what={t("meetings.home.oneOnOnes")} error={list.error} onRetry={() => list.refetch()} />
      ) : null}
      {list.data?.length === 0 ? <HomeEmpty text={t("meetings.home.noOneOnOnes")} /> : null}
      {list.data?.map((entry) => {
        const name =
          entry.partners.map((partner) => partner.name ?? t("meetings.unknownPerson")).join(", ") ||
          t("meetings.home.alone");
        const partner = entry.partners.length === 1 ? entry.partners[0] : undefined;
        return (
          <HomeRow
            key={entry.spaceId}
            to={entry.seriesId ? seriesPath(entry.spaceKey, entry.seriesId) : `/spaces/${entry.spaceKey}`}
            leading={
              <PersonAvatar
                id={partner?.id ?? null}
                name={name}
                pictureRef={partner?.pictureRef ?? null}
                size="sm"
                decorative
              />
            }
            title={name}
            meta={
              entry.nextMeeting?.startsAt
                ? isToday(entry.nextMeeting.startsAt, format.settings.timeZone)
                  ? t("meetings.home.today", { time: format.time(entry.nextMeeting.startsAt) })
                  : t("meetings.home.next", { date: format.weekdayDateTime(entry.nextMeeting.startsAt) })
                : t("meetings.notScheduled")
            }
          />
        );
      })}
      <OneOnOneDialog open={creating} onOpenChange={setCreating} />
    </Section>
  );
}
