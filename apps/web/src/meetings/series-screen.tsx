import {
  Button,
  buttonClassName,
  IconButton,
  Menu,
  type MenuItem,
  Notice,
  Skeleton,
  Tabs,
  useToast,
} from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  CalendarPlus,
  LayoutGrid,
  Lock,
  MoreHorizontal,
  NotebookPen,
  Settings,
  Trash2,
  UserRoundPlus,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { ApiError, request } from "../api/request.js";
import { PersonAvatar } from "../components/person-avatar.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { WatchMenu } from "../notifications/watch-menu.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { GiveAccessButton } from "../sharing/give-access.js";
import { useDeleteItem } from "../spaces/content-actions.js";
import { itemSlug } from "../spaces/item-paths.js";
import { PageBar } from "../spaces/page-bar.js";
import { spaceDisplayName } from "../spaces/space-badge.js";
import { useSpace } from "../spaces/space-context.js";
import { pagePath } from "../spaces/space-queries.js";
import { peopleWithoutAccess } from "./access.js";
import { ExtraMeetingForm } from "./meeting-header.js";
import { type Series, seriesNotesQuery, seriesQuery } from "./queries.js";
import { describeRhythm, type Rhythm } from "./rhythm.js";
import { SeriesOverview, type SeriesTab } from "./series-overview.js";
import { SeriesSettingsDialog } from "./series-settings-dialog.js";
import { DecisionsTab, MeetingsTab, TasksTab, TopicsTab } from "./series-tabs.js";
import { SuccessorDialog } from "./successor-dialog.js";

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

function SeriesView({ series }: { series: Series }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const format = useFormat();
  const navigate = useNavigate();
  const search = route.useSearch();
  const { space, canEdit } = useSpace();
  const deleteItem = useDeleteItem(space);
  const [settings, setSettings] = useState(false);
  const [changingPerson, setChangingPerson] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [planningExtra, setPlanningExtra] = useState(false);
  const writable = canEdit && !series.archived;
  const tab: SeriesTab = search.tab ?? "overview";
  const upcoming = series.upcoming;
  const withoutAccess = peopleWithoutAccess(series.members);
  const rhythm = describeRhythm(t, series.schedule.rhythm as Rhythm | null, i18n.language);
  const openTab = (next: SeriesTab) => {
    setCustomizing(false);
    void navigate({ to: ".", search: { tab: next === "overview" ? undefined : next }, replace: true });
  };

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
    <div className="flex min-h-full flex-col">
      <PageBar
        breadcrumbs={[
          { label: spaceDisplayName(t, space), href: `/spaces/${space.key}` },
          { label: t("meetings.title"), href: `/spaces/${space.key}/meetings` },
        ]}
      >
        {writable && tab === "overview" ? (
          customizing ? (
            <Button size="sm" variant="primary" onClick={() => setCustomizing(false)}>
              {t("meetings.overview.done")}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" icon={LayoutGrid} onClick={() => setCustomizing(true)}>
              {t("meetings.overview.customize")}
            </Button>
          )
        ) : null}
        {writable ? (
          <Button size="sm" variant="secondary" icon={Settings} onClick={() => setSettings(true)}>
            {t("meetings.series.settingsShort")}
          </Button>
        ) : null}
        <WatchMenu target={{ type: "item", id: series.id }} name={series.title} />
        {menu.length > 0 ? (
          <Menu
            trigger={<IconButton label={t("meetings.series.more")} icon={MoreHorizontal} />}
            items={menu}
          />
        ) : null}
      </PageBar>
      <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-4 pb-12 md:px-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-heading">{series.title}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
            <span className="flex -space-x-1">
              <span className="sr-only">{t("meetings.series.membersLabel")}</span>
              {series.members.slice(0, 6).map((member) => (
                <span
                  key={member.id}
                  title={member.name ?? t("meetings.unknownPerson")}
                  className="inline-flex"
                >
                  <PersonAvatar
                    id={member.id}
                    name={member.name ?? "?"}
                    pictureRef={member.pictureRef}
                    size="sm"
                  />
                </span>
              ))}
            </span>
            <span>
              {[
                series.schedule.recurrence === null ? rhythm : `${rhythm}, ${series.schedule.startTime}`,
                t("meetings.series.members", { count: series.members.length }),
                series.template.name ? t("meetings.series.template", { name: series.template.name }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </p>
        </header>
        {series.oneOnOne ? (
          <Notice variant="info" title={t("meetings.oneOnOne.privateTitle")}>
            <span className="inline-flex items-start gap-2">
              <Lock aria-hidden className="size-icon-md shrink-0" />
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
        {upcoming ? (
          <section
            aria-labelledby="next-meeting"
            className="flex flex-wrap items-center gap-4 border-y border-border border-l-4 border-l-accent py-3 pl-4"
          >
            <div className="flex min-w-0 flex-1 basis-field flex-col">
              <span className="text-sm text-text-muted">{t("meetings.series.next")}</span>
              <h2 id="next-meeting" className="text-lg font-semibold">
                {upcoming.startsAt ? format.dateTime(upcoming.startsAt) : t("meetings.notScheduled")}
              </h2>
              <span className="text-sm text-text-muted">
                {[
                  t("meetings.series.openTopics", { count: series.openTopics }),
                  t("meetings.series.invited", { count: upcoming.attendees }),
                ].join(" · ")}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {writable ? (
                <Button variant="secondary" icon={CalendarPlus} onClick={() => setPlanningExtra(true)}>
                  {t("meetings.extra.short")}
                </Button>
              ) : null}
              <Link
                to={pagePath(space.key, upcoming.id, itemSlug(upcoming.title))}
                className={buttonClassName({ variant: "primary" })}
              >
                <NotebookPen aria-hidden className="size-icon-md" />
                {t("meetings.series.openAgenda")}
              </Link>
            </div>
          </section>
        ) : null}
        {planningExtra ? (
          <ExtraMeetingForm
            seriesId={series.id}
            timeZone={series.schedule.timeZone}
            spaceKey={space.key}
            onDone={() => setPlanningExtra(false)}
          />
        ) : null}
        <Tabs
          label={t("meetings.tabs.label")}
          value={tab}
          onValueChange={(value) => openTab(value as SeriesTab)}
          tabs={[
            { value: "overview", label: t("meetings.tabs.overview") },
            { value: "topics", label: t("meetings.tabs.topics"), count: series.openTopics },
            { value: "tasks", label: t("meetings.tabs.tasks") },
            { value: "decisions", label: t("meetings.tabs.decisions") },
            { value: "meetings", label: t("meetings.tabs.meetings") },
          ]}
        >
          {tab === "overview" ? (
            <div className="flex flex-col gap-10">
              <SeriesOverview
                series={series}
                spaceKey={space.key}
                customizing={writable && customizing}
                onOpenTab={openTab}
              />
              <OwnNotes seriesId={series.id} spaceKey={space.key} />
            </div>
          ) : tab === "topics" ? (
            <TopicsTab
              series={series}
              spaceKey={space.key}
              status={search.status ?? "open"}
              writable={writable}
            />
          ) : tab === "tasks" ? (
            <TasksTab series={series} />
          ) : tab === "decisions" ? (
            <DecisionsTab series={series} spaceKey={space.key} />
          ) : (
            <MeetingsTab series={series} spaceKey={space.key} />
          )}
        </Tabs>
      </div>
      {writable ? <SeriesSettingsDialog series={series} open={settings} onOpenChange={setSettings} /> : null}
      {changingPerson ? <SuccessorDialog series={series} open onOpenChange={setChangingPerson} /> : null}
    </div>
  );
}

function OwnNotes({ seriesId, spaceKey }: { seriesId: string; spaceKey: string }) {
  const { t } = useTranslation();
  const format = useFormat();
  const notes = useQuery(seriesNotesQuery(seriesId));
  if (!notes.data || notes.data.length === 0) return null;
  return (
    <section aria-labelledby="series-notes" className="flex flex-col gap-2">
      <h2 id="series-notes" className="flex items-center gap-2 font-semibold">
        <Lock aria-hidden className="size-icon-md text-text-muted" />
        {t("meetings.notes.ownTitle")}
        <span className="text-sm font-normal text-text-muted">{t("meetings.notes.ownDescription")}</span>
      </h2>
      <ul className="flex flex-col">
        {notes.data.map((entry) => (
          <li key={entry.meetingId} className="border-t border-border">
            <Link
              to={pagePath(spaceKey, entry.meetingId, itemSlug(entry.meetingTitle))}
              search={{ notes: true }}
              className="flex min-h-hit items-center gap-2 py-2 hover:bg-hover focus-visible:focus-ring"
            >
              <NotebookPen aria-hidden className="size-icon-md text-text-muted" />
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
