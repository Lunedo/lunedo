import {
  Avatar,
  Badge,
  Button,
  buttonClassName,
  IconButton,
  Menu,
  type MenuItem,
  Notice,
  PageHeader,
  Skeleton,
  useToast,
} from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  CalendarX,
  ListChecks,
  Lock,
  MoreHorizontal,
  NotebookPen,
  Plus,
  Repeat,
  Settings,
  Trash2,
  UserRoundPlus,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { ApiError, request } from "../api/request.js";
import { TaskTable } from "../collaboration/task-table.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { GiveAccessButton } from "../sharing/give-access.js";
import { useDeleteItem } from "../spaces/content-actions.js";
import { itemSlug } from "../spaces/item-paths.js";
import { spaceDisplayName } from "../spaces/space-badge.js";
import { useSpace } from "../spaces/space-context.js";
import { pagePath } from "../spaces/space-queries.js";
import { DecisionsSection } from "./decisions-section.js";
import { MeetingDateDialog, type MeetingTarget, useCloseMeeting } from "./meeting-actions.js";
import { MeetingsList } from "./meetings-list.js";
import { type MeetingSummary, type Series, seriesNotesQuery, seriesQuery } from "./queries.js";
import { describeRhythm, type Rhythm } from "./rhythm.js";
import { SeriesSettingsDialog } from "./series-settings-dialog.js";
import { SuccessorDialog } from "./successor-dialog.js";
import { TopicDialog } from "./topic-dialog.js";
import { TopicsSection } from "./topics-section.js";

const route = getRouteApi("/app/spaces/$spaceKey/meetings/$seriesId");

export function SeriesScreen() {
  const { t } = useTranslation();
  const { seriesId } = route.useParams();
  const series = useQuery({ ...seriesQuery(seriesId), retry: false });
  useDocumentTitle(series.data?.title ?? t("meetings.title"));
  if (series.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-page flex-col gap-4 px-4 pt-6 md:px-8">
        <Skeleton className="h-field w-2/3" />
        <Skeleton className="h-field w-full" />
      </div>
    );
  }
  if (series.isError) {
    return (
      <div className="p-6">
        {series.error instanceof ApiError && series.error.status === 404 ? (
          <Notice variant="warning" title={t("meetings.series.notFoundTitle")}>
            {t("meetings.series.notFoundDescription")}
          </Notice>
        ) : (
          <LoadError
            what={t("meetings.series.loadFailed")}
            error={series.error}
            onRetry={() => series.refetch()}
          />
        )}
      </div>
    );
  }
  return <SeriesView series={series.data} />;
}

function targetOf(series: Series, meeting: MeetingSummary): MeetingTarget {
  return {
    id: meeting.id,
    title: meeting.title,
    timeZone: series.schedule.timeZone,
    rhythm: series.schedule.recurrence !== null,
    startsAt: meeting.startsAt,
  };
}

function SeriesView({ series }: { series: Series }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const format = useFormat();
  const { space, canEdit } = useSpace();
  const deleteItem = useDeleteItem(space);
  const close = useCloseMeeting();
  const [settings, setSettings] = useState(false);
  const [addingTopic, setAddingTopic] = useState(false);
  const [changingPerson, setChangingPerson] = useState(false);
  const [dialog, setDialog] = useState<"close" | "skip" | "move" | null>(null);
  const writable = canEdit && !series.archived;
  const upcoming = series.upcoming;
  const target = upcoming ? targetOf(series, upcoming) : null;
  const withoutAccess = series.members.filter((member) => !member.canRead);
  const rhythm = describeRhythm(t, series.schedule.rhythm as Rhythm | null, i18n.language);

  const setEnded = async (ended: boolean) => {
    try {
      await request(() =>
        api.PUT("/api/v1/meeting-series/{seriesId}/ended", {
          params: { path: { seriesId: series.id } },
          body: { ended },
        }),
      );
      toast({
        variant: "success",
        title: ended ? t("meetings.series.endedToast") : t("meetings.series.continuedToast"),
      });
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.series.endFailed"),
        description: problemMessage(t, failure),
      });
    }
  };

  const menu: MenuItem[] = [];
  if (series.oneOnOne && space.role === "admin" && !series.archived) {
    menu.push({
      label: t("meetings.successor.action"),
      icon: UserRoundPlus,
      onSelect: () => setChangingPerson(true),
    });
  }
  if (canEdit) {
    menu.push(
      series.archived
        ? { label: t("meetings.series.continue"), icon: ArchiveRestore, onSelect: () => void setEnded(false) }
        : { label: t("meetings.series.end"), icon: Archive, onSelect: () => void setEnded(true) },
      { type: "separator" },
      {
        label: t("meetings.series.delete"),
        icon: Trash2,
        danger: true,
        onSelect: () =>
          void deleteItem(
            { id: series.id, title: series.title, kind: "meetingSeries", spaceId: series.spaceId },
            { leave: true },
          ),
      },
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
      <PageHeader
        title={series.title}
        description={[
          series.schedule.recurrence === null ? rhythm : `${rhythm}, ${series.schedule.startTime}`,
          t("meetings.series.members", { count: series.members.length }),
          series.template.name ? t("meetings.series.template", { name: series.template.name }) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        icon={Repeat}
        breadcrumbs={[
          { label: spaceDisplayName(t, space), href: `/spaces/${space.key}` },
          { label: t("meetings.title"), href: `/spaces/${space.key}/meetings` },
          { label: series.title },
        ]}
        actions={
          <>
            {writable ? (
              <Button variant="secondary" icon={Settings} onClick={() => setSettings(true)}>
                {t("meetings.series.settings")}
              </Button>
            ) : null}
            {menu.length > 0 ? (
              <Menu
                trigger={<IconButton label={t("meetings.series.more")} icon={MoreHorizontal} />}
                items={menu}
              />
            ) : null}
          </>
        }
      />
      <ul aria-label={t("meetings.series.membersLabel")} className="flex flex-wrap gap-2">
        {series.members.map((member) => (
          <li
            key={member.id}
            className="flex items-center gap-2 rounded-full border border-border py-1 pr-3 pl-1 text-sm"
          >
            <Avatar name={member.name ?? "?"} size="sm" decorative />
            <span>{member.name ?? t("meetings.unknownPerson")}</span>
            {member.canRead ? null : <Badge variant="warning">{t("meetings.series.noAccess")}</Badge>}
          </li>
        ))}
      </ul>
      {series.oneOnOne ? (
        <Notice variant="info" title={t("meetings.oneOnOne.privateTitle")}>
          <span className="inline-flex items-start gap-2">
            <Lock aria-hidden className="size-icon shrink-0" />
            {t("meetings.oneOnOne.privateDescription")}
          </span>
        </Notice>
      ) : null}
      {withoutAccess.length > 0 ? (
        <Notice
          variant="warning"
          title={t("meetings.series.withoutAccessTitle", { count: withoutAccess.length })}
          action={space.role === "admin" ? <GiveAccessButton spaceId={space.id} /> : undefined}
        >
          {t(
            space.role === "admin" ? "meetings.series.withoutAccessAdmin" : "meetings.series.withoutAccess",
            {
              names: new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(
                withoutAccess.map((member) => member.name ?? t("meetings.unknownPerson")),
              ),
            },
          )}
        </Notice>
      ) : null}
      {series.archived ? (
        <Notice variant="warning" title={t("meetings.series.endedTitle")}>
          {t("meetings.series.endedDescription")}
        </Notice>
      ) : null}
      {upcoming && target ? (
        <section
          aria-labelledby="next-meeting"
          className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-surface-sunken p-4"
        >
          <div className="flex shrink-0 items-center justify-center rounded-md bg-accent-soft p-3 text-accent">
            <CalendarClock aria-hidden className="size-icon-md" />
          </div>
          <div className="flex min-w-0 flex-1 basis-field flex-col gap-1">
            <h2 id="next-meeting" className="font-semibold">
              {upcoming.startsAt
                ? t("meetings.series.nextAt", { date: format.dateTime(upcoming.startsAt) })
                : t("meetings.series.nextUnscheduled")}
            </h2>
            <p className="text-sm text-text-muted">
              {[
                t("meetings.series.openTopics", { count: series.openTopics }),
                t("meetings.series.invited", { count: upcoming.attendees }),
              ].join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {writable ? (
              <Button variant="secondary" icon={Plus} onClick={() => setAddingTopic(true)}>
                {t("meetings.topics.add")}
              </Button>
            ) : null}
            {writable ? (
              <Menu
                trigger={
                  <Button variant="secondary" icon={MoreHorizontal}>
                    {t("meetings.series.nextActions")}
                  </Button>
                }
                items={[
                  {
                    label: t("meetings.move.action"),
                    icon: CalendarClock,
                    onSelect: () => setDialog("move"),
                  },
                  { label: t("meetings.skip.action"), icon: CalendarX, onSelect: () => setDialog("skip") },
                  {
                    label: t("meetings.close.action"),
                    icon: ListChecks,
                    onSelect: () => (target.rhythm ? void close(target) : setDialog("close")),
                  },
                ]}
              />
            ) : null}
            <Link
              to={pagePath(space.key, upcoming.id, itemSlug(upcoming.title))}
              className={buttonClassName({ variant: "primary" })}
            >
              <NotebookPen aria-hidden className="size-icon" />
              {t("meetings.series.openAgenda")}
            </Link>
          </div>
        </section>
      ) : null}
      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="series-meetings" className="flex flex-col gap-3">
          <h2 id="series-meetings" className="text-lg font-semibold">
            {t("meetings.series.meetingsTitle")}
          </h2>
          <MeetingsList seriesId={series.id} spaceKey={space.key} />
        </section>
        <div className="flex flex-col gap-8">
          <TopicsSection
            seriesId={series.id}
            spaceKey={space.key}
            canEdit={writable}
            onAdd={() => setAddingTopic(true)}
          />
          <section aria-labelledby="series-tasks" className="flex flex-col gap-3">
            <h2 id="series-tasks" className="flex items-center gap-2 text-lg font-semibold">
              <ListChecks aria-hidden className="size-icon text-text-muted" />
              {t("meetings.series.openTasks")}
            </h2>
            <TaskTable
              query={{ seriesId: series.id, status: "open", due: "any", limit: 50 }}
              showAssignee
              emptyTitle={t("meetings.series.noTasksTitle")}
              emptyDescription={t("meetings.series.noTasksDescription")}
            />
          </section>
          <DecisionsSection seriesId={series.id} spaceKey={space.key} />
          <OwnNotes seriesId={series.id} spaceKey={space.key} />
        </div>
      </div>
      {writable ? <SeriesSettingsDialog series={series} open={settings} onOpenChange={setSettings} /> : null}
      <TopicDialog seriesId={series.id} open={addingTopic} onOpenChange={setAddingTopic} />
      {changingPerson ? <SuccessorDialog series={series} open onOpenChange={setChangingPerson} /> : null}
      {target && dialog ? (
        <MeetingDateDialog
          meeting={target}
          purpose={dialog}
          open
          onOpenChange={(open) => !open && setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function OwnNotes({ seriesId, spaceKey }: { seriesId: string; spaceKey: string }) {
  const { t } = useTranslation();
  const format = useFormat();
  const notes = useQuery(seriesNotesQuery(seriesId));
  if (!notes.data || notes.data.length === 0) return null;
  return (
    <section aria-labelledby="series-notes" className="flex flex-col gap-3">
      <h2 id="series-notes" className="flex items-center gap-2 text-lg font-semibold">
        <Lock aria-hidden className="size-icon text-text-muted" />
        {t("meetings.notes.ownTitle")}
      </h2>
      <p className="text-sm text-text-muted">{t("meetings.notes.ownDescription")}</p>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {notes.data.map((entry) => (
          <li key={entry.meetingId}>
            <Link
              to={pagePath(spaceKey, entry.meetingId, itemSlug(entry.meetingTitle))}
              search={{ notes: true }}
              className="flex min-h-hit items-center gap-2 px-3 py-2 hover:bg-hover focus-visible:focus-ring"
            >
              <NotebookPen aria-hidden className="size-icon text-text-muted" />
              <span className="min-w-0 flex-1 truncate">
                {entry.startsAt ? format.date(entry.startsAt) : entry.meetingTitle}
              </span>
              <span className="text-sm text-text-muted">
                {t("meetings.notes.savedAt", { date: format.dateTime(entry.updatedAt) })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
