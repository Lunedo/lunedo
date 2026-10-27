import { closestCenter, DndContext, DragOverlay, type UniqueIdentifier, useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Badge, Button, Checkbox, Combobox, classNames, IconButton, Skeleton, useToast } from "@lunedo/ui";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  EyeOff,
  Flag,
  Link2,
  ListChecks,
  Plus,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { type TaskEntry, tasksQuery } from "../collaboration/queries.js";
import { useSetTaskStatus } from "../collaboration/task-actions.js";
import { PersonAvatar } from "../components/person-avatar.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { contentHref, itemSlug } from "../spaces/item-paths.js";
import { pagePath, topicPath } from "../spaces/space-queries.js";
import {
  attendanceQuery,
  decisionsQuery,
  meetingKeys,
  meetingStateAccent,
  meetingStateLabel,
  type Series,
  topicsQuery,
} from "./queries.js";
import {
  DropLine,
  useDropIndicator,
  useSortableAccessibility,
  useSortableItem,
  useSortableSensors,
} from "./sortable.js";

export const MODULE_ROWS = 5;
export type SeriesTab = "overview" | "topics" | "tasks" | "decisions" | "meetings";
type Layout = { columns: [string[], string[]]; hidden: string[]; links: string[] };
const COLUMN_IDS = ["column-0", "column-1"] as const;

export function seriesMeetingsQuery(seriesId: string) {
  return {
    queryKey: meetingKeys.seriesMeetings(seriesId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      request(() =>
        api.GET("/api/v1/meeting-series/{seriesId}/meetings", {
          params: { path: { seriesId }, query: { limit: 25, ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    getNextPageParam: (page: { nextCursor: string | null }) => page.nextCursor ?? undefined,
  };
}

export function ModuleRow({
  lead,
  title,
  meta,
  value,
  to,
}: {
  lead: ReactNode;
  title: ReactNode;
  meta: ReactNode;
  value?: ReactNode;
  to?: string;
}) {
  const text = (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate">{title}</span>
      <span className="truncate text-sm text-text-muted">{meta}</span>
    </span>
  );
  return (
    <li className="flex min-h-hit items-center gap-3 border-t border-border py-2">
      <span className="flex w-6 shrink-0 justify-center text-text-muted">{lead}</span>
      {to ? (
        <Link
          to={to}
          className="flex min-w-0 flex-1 rounded-sm text-text hover:underline focus-visible:focus-ring"
        >
          {text}
        </Link>
      ) : (
        text
      )}
      {value !== undefined ? <span className="shrink-0 text-sm text-text-muted">{value}</span> : null}
    </li>
  );
}

function useModule(id: string, series: Series, spaceKey: string) {
  const { t } = useTranslation();
  const format = useFormat();
  const quiet = { throwOnError: false } as const;
  const topics = useQuery({
    ...topicsQuery(series.id, { status: "open" }),
    enabled: id === "topics",
    ...quiet,
  });
  const tasks = useQuery({
    ...tasksQuery({ seriesId: series.id, status: "open", due: "any", limit: MODULE_ROWS }),
    enabled: id === "tasks",
    ...quiet,
  });
  const decisions = useQuery({
    ...decisionsQuery(series.id, { limit: MODULE_ROWS }),
    enabled: id === "decisions",
    ...quiet,
  });
  const meetings = useInfiniteQuery({
    ...seriesMeetingsQuery(series.id),
    enabled: id === "meetings",
    ...quiet,
  });
  const attendance = useQuery({ ...attendanceQuery(series.id), enabled: id === "attendance", ...quiet });
  const active = ({ topics, tasks, decisions, meetings, attendance } as const)[
    id as "topics" | "tasks" | "decisions" | "meetings" | "attendance"
  ];
  const failure = active?.isError ? { error: active.error, retry: () => void active.refetch() } : null;
  return { ...moduleContent(), failure };

  function moduleContent() {
    switch (id) {
      case "topics":
        return {
          loading: topics.isPending,
          count: topics.data?.length ?? null,
          tab: "topics" as const,
          rows: (topics.data ?? []).slice(0, MODULE_ROWS).map((topic) => (
            <ModuleRow
              key={topic.id}
              to={topicPath(spaceKey, topic.number, itemSlug(topic.title))}
              lead={
                topic.owner ? (
                  <PersonAvatar id={topic.owner.id} name={topic.owner.name ?? "?"} size="sm" decorative />
                ) : null
              }
              title={topic.title}
              meta={
                topic.lastUpdateText
                  ? t("meetings.agenda.lastUpdate", { text: topic.lastUpdateText })
                  : t("meetings.agenda.noUpdate")
              }
              {...(topic.openTasks > 0
                ? {
                    value: (
                      <span className="inline-flex items-center gap-1">
                        <ListChecks aria-hidden="true" className="size-icon-sm" />
                        {topic.openTasks}
                      </span>
                    ),
                  }
                : {})}
            />
          )),
        };
      case "tasks":
        return {
          loading: tasks.isPending,
          count: tasks.data?.counts.open ?? null,
          tab: "tasks" as const,
          rows: (tasks.data?.items ?? []).map((task) => <ModuleTask key={task.id} task={task} />),
        };
      case "decisions":
        return {
          loading: decisions.isPending,
          count: decisions.data?.length ?? null,
          tab: "decisions" as const,
          rows: (decisions.data ?? [])
            .slice(0, MODULE_ROWS)
            .map((decision) => (
              <ModuleRow
                key={decision.id}
                to={pagePath(spaceKey, decision.meeting.number, itemSlug(decision.meeting.title))}
                lead={<Flag aria-hidden="true" className="size-icon-md text-success" />}
                title={decision.text || t("meetings.decisions.noStatement")}
                meta={[
                  decision.meeting.startsAt
                    ? format.calendarDate(decision.meeting.startsAt)
                    : decision.meeting.title,
                  decision.topic?.title,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            )),
        };
      case "meetings": {
        const items = meetings.data?.pages.flatMap((page) => page.items) ?? [];
        return {
          loading: meetings.isPending,
          count: meetings.hasNextPage ? null : items.length,
          tab: "meetings" as const,
          rows: items
            .slice(0, MODULE_ROWS)
            .map((meeting) => (
              <ModuleRow
                key={meeting.id}
                to={pagePath(spaceKey, meeting.number, itemSlug(meeting.title))}
                lead={<CalendarDays aria-hidden="true" className="size-icon-md" />}
                title={meeting.startsAt ? format.weekdayDate(meeting.startsAt) : t("meetings.notScheduled")}
                meta={
                  meeting.state === "upcoming"
                    ? t("meetings.series.openTopics", { count: series.openTopics })
                    : meeting.state === "skipped"
                      ? t("meetings.state.skipped")
                      : t("meetings.series.attended", { count: meeting.present, total: meeting.attendees })
                }
                value={
                  <Badge
                    variant={meetingStateAccent(meeting, format.settings.timeZone) ? "accent" : "neutral"}
                  >
                    {meetingStateLabel(t, meeting, format.settings.timeZone)}
                  </Badge>
                }
              />
            )),
        };
      }
      case "attendance":
        return {
          loading: attendance.isPending,
          count: null,
          tab: null,
          rows: (attendance.data ?? [])
            .slice(0, MODULE_ROWS)
            .map((rate) => (
              <ModuleRow
                key={rate.id}
                lead={
                  <PersonAvatar
                    id={rate.id}
                    name={rate.name ?? "?"}
                    pictureRef={rate.pictureRef}
                    size="sm"
                    decorative
                  />
                }
                title={rate.name ?? t("meetings.unknownPerson")}
                meta={t("meetings.overview.lastMeetings", { count: rate.meetings })}
                value={
                  <span className="tabular-nums">
                    {rate.meetings > 0 ? format.percent(rate.present / rate.meetings) : "–"}
                  </span>
                }
              />
            )),
        };
      case "links":
        return {
          loading: false,
          count: series.overview.links.length,
          tab: null,
          rows: series.overview.links
            .slice(0, MODULE_ROWS)
            .map((link) => (
              <ModuleRow
                key={link.id}
                to={
                  contentHref({ kind: link.kind, number: link.number, title: link.title }, link.spaceKey) ??
                  undefined
                }
                lead={<Link2 aria-hidden="true" className="size-icon-md" />}
                title={link.title}
                meta={translateKey(t, `meetings.overview.kinds.${link.kind}`)}
              />
            )),
        };
      default:
        return { loading: false, count: null, tab: null, rows: [] };
    }
  }
}

function ModuleTask({ task }: { task: TaskEntry }) {
  const { t } = useTranslation();
  const format = useFormat();
  const setStatus = useSetTaskStatus(task.item.id);
  return (
    <ModuleRow
      lead={
        <Checkbox
          checked={task.done}
          aria-label={t("tasks.markDone", { task: task.text })}
          onCheckedChange={(checked) => setStatus.mutate({ taskId: task.id, done: checked })}
        />
      }
      title={task.text || t("tasks.untitled")}
      meta={task.item.title}
      value={
        <span className="inline-flex items-center gap-2">
          {task.assignee ? (
            <PersonAvatar id={task.assignee.id} name={task.assignee.name} size="sm" decorative />
          ) : null}
          {task.dueDate ? format.day(`${task.dueDate}T12:00:00Z`) : null}
        </span>
      }
    />
  );
}

function ModuleCard({
  id,
  series,
  spaceKey,
  onOpenTab,
  controls,
  dragging,
  handle,
  setNodeRef,
}: {
  id: string;
  series: Series;
  spaceKey: string;
  onOpenTab: (tab: SeriesTab) => void;
  controls?: ReactNode;
  dragging?: boolean;
  handle?: ReactNode;
  setNodeRef?: (element: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const module = useModule(id, series, spaceKey);
  const title = translateKey(t, `meetings.overview.modules.${id}`);
  return (
    <section
      ref={setNodeRef}
      aria-label={title}
      className={classNames(
        "group flex flex-col",
        controls ? "rounded-md border border-dashed border-border p-3" : null,
        dragging && "opacity-40",
      )}
    >
      <div className="flex min-h-row items-center gap-2">
        {handle}
        <h3 className="font-semibold">{title}</h3>
        {module.count !== null ? <span className="text-sm text-text-muted">{module.count}</span> : null}
        <span className="ml-auto flex items-center gap-1">
          {controls ??
            (module.tab ? (
              <Button size="sm" variant="ghost" onClick={() => module.tab && onOpenTab(module.tab)}>
                {t("meetings.overview.all")}
              </Button>
            ) : null)}
        </span>
      </div>
      {module.failure ? (
        <LoadError what={title} error={module.failure.error} onRetry={module.failure.retry} />
      ) : module.loading ? (
        <Skeleton className="h-field w-full" />
      ) : module.rows.length === 0 ? (
        <p className="border-t border-border py-3 text-sm text-text-muted">
          {translateKey(t, `meetings.overview.empty.${id}`)}
        </p>
      ) : (
        <ul className="flex flex-col">{module.rows}</ul>
      )}
    </section>
  );
}

function Column({ index, children }: { index: 0 | 1; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: COLUMN_IDS[index] });
  return (
    <div ref={setNodeRef} className="flex min-h-field min-w-0 flex-col gap-6">
      {children}
    </div>
  );
}

function SortableModule({
  id,
  column,
  row,
  columns,
  series,
  spaceKey,
  onMove,
  onHide,
  indicator,
}: {
  id: string;
  column: 0 | 1;
  row: number;
  columns: [string[], string[]];
  series: Series;
  spaceKey: string;
  onMove: (direction: "up" | "down" | "left" | "right") => void;
  onHide: () => void;
  indicator: { before: boolean; after: boolean };
}) {
  const { t } = useTranslation();
  const sortable = useSortableItem(id, false);
  const title = translateKey(t, `meetings.overview.modules.${id}`);
  const size = columns[column].length;
  return (
    <>
      <DropLine show={indicator.before} />
      <ModuleCard
        id={id}
        series={series}
        spaceKey={spaceKey}
        onOpenTab={() => {}}
        dragging={sortable.dragging}
        setNodeRef={sortable.setNodeRef}
        handle={sortable.handle(t("meetings.overview.drag", { name: title }))}
        controls={
          <>
            {column === 1 ? (
              <IconButton
                size="sm"
                variant="ghost"
                icon={ArrowLeft}
                label={t("meetings.overview.left", { name: title })}
                onClick={() => onMove("left")}
              />
            ) : (
              <IconButton
                size="sm"
                variant="ghost"
                icon={ArrowRight}
                label={t("meetings.overview.right", { name: title })}
                onClick={() => onMove("right")}
              />
            )}
            {row > 0 ? (
              <IconButton
                size="sm"
                variant="ghost"
                icon={ArrowUp}
                label={t("meetings.overview.up", { name: title })}
                onClick={() => onMove("up")}
              />
            ) : null}
            {row < size - 1 ? (
              <IconButton
                size="sm"
                variant="ghost"
                icon={ArrowDown}
                label={t("meetings.overview.down", { name: title })}
                onClick={() => onMove("down")}
              />
            ) : null}
            <IconButton
              size="sm"
              variant="ghost"
              icon={EyeOff}
              label={t("meetings.overview.hide", { name: title })}
              onClick={onHide}
            />
          </>
        }
      />
      <DropLine show={indicator.after} />
    </>
  );
}

function linkLoader(spaceId: string) {
  return async (query: string) => {
    const items = await request(() =>
      api.GET("/api/v1/items", { params: { query: { q: query, spaceId, limit: 20 } } }),
    );
    return {
      items: items.map((item) => ({ value: item.id, label: item.title, description: item.spaceName })),
      nextCursor: null,
    };
  };
}

export function SeriesOverview({
  series,
  spaceKey,
  customizing,
  onOpenTab,
}: {
  series: Series;
  spaceKey: string;
  customizing: boolean;
  onOpenTab: (tab: SeriesTab) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const sensors = useSortableSensors();
  const drop = useDropIndicator();
  const [dragging, setDragging] = useState<string | null>(null);
  const nameOf = (id: UniqueIdentifier) =>
    COLUMN_IDS.includes(id as (typeof COLUMN_IDS)[number])
      ? t("meetings.overview.column", { number: COLUMN_IDS.indexOf(id as (typeof COLUMN_IDS)[number]) + 1 })
      : translateKey(t, `meetings.overview.modules.${String(id)}`);
  const accessibility = useSortableAccessibility(nameOf);
  const layout: Layout = {
    columns: [[...(series.overview.columns[0] ?? [])], [...(series.overview.columns[1] ?? [])]],
    hidden: [...series.overview.hidden],
    links: series.overview.links.map((link) => link.id),
  };

  const save = async (next: Layout) => {
    const key = meetingKeys.series(series.id);
    queryClient.setQueryData<Series>(key, (current) =>
      current
        ? {
            ...current,
            overview: {
              columns: next.columns,
              hidden: next.hidden as Series["overview"]["hidden"],
              links: next.links.flatMap((id) => current.overview.links.filter((link) => link.id === id)),
            },
          }
        : current,
    );
    try {
      await request(() =>
        api.PUT("/api/v1/meeting-series/{seriesId}/overview", {
          params: { path: { seriesId: series.id } },
          body: next,
        }),
      );
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.overview.saveFailed"),
        description: problemMessage(t, failure),
      });
    } finally {
      await queryClient.invalidateQueries({ queryKey: key });
    }
  };
  const place = (id: string, column: 0 | 1, index: number) => {
    const columns: [string[], string[]] = [
      layout.columns[0].filter((entry) => entry !== id),
      layout.columns[1].filter((entry) => entry !== id),
    ];
    columns[column].splice(Math.max(0, Math.min(index, columns[column].length)), 0, id);
    void save({ ...layout, columns });
  };
  const moveBy = (id: string, column: 0 | 1, row: number, direction: "up" | "down" | "left" | "right") => {
    if (direction === "up") place(id, column, row - 1);
    else if (direction === "down") place(id, column, row + 1);
    else place(id, direction === "left" ? 0 : 1, layout.columns[direction === "left" ? 0 : 1].length);
  };
  const hide = (id: string) =>
    void save({
      ...layout,
      columns: [
        layout.columns[0].filter((entry) => entry !== id),
        layout.columns[1].filter((entry) => entry !== id),
      ],
      hidden: [...layout.hidden, id],
    });
  const show = (id: string) => {
    const target = layout.columns[0].length <= layout.columns[1].length ? 0 : 1;
    const columns: [string[], string[]] = [[...layout.columns[0]], [...layout.columns[1]]];
    columns[target].push(id);
    void save({ ...layout, columns, hidden: layout.hidden.filter((entry) => entry !== id) });
  };

  if (!customizing) {
    return (
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
        {layout.columns.map((ids, column) => (
          <div key={COLUMN_IDS[column]} className="flex min-w-0 flex-col gap-8">
            {ids.map((id) => (
              <ModuleCard key={id} id={id} series={series} spaceKey={spaceKey} onOpenTab={onOpenTab} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={accessibility}
        onDragStart={(event) => setDragging(String(event.active.id))}
        onDragOver={drop.onDragOver}
        onDragCancel={() => {
          setDragging(null);
          drop.clear();
        }}
        onDragEnd={(event) => {
          setDragging(null);
          const target = drop.finish(event);
          if (!target) return;
          const id = String(event.active.id);
          const overId = String(target.overId);
          const columnIndex = COLUMN_IDS.indexOf(overId as (typeof COLUMN_IDS)[number]);
          if (columnIndex >= 0) {
            place(id, columnIndex as 0 | 1, layout.columns[columnIndex as 0 | 1].length);
            return;
          }
          const column = layout.columns[0].includes(overId) ? 0 : 1;
          const without = layout.columns[column].filter((entry) => entry !== id);
          place(id, column, without.indexOf(overId) + (target.after ? 1 : 0));
        }}
      >
        <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
          {layout.columns.map((ids, column) => (
            <SortableContext key={COLUMN_IDS[column]} items={ids} strategy={verticalListSortingStrategy}>
              <Column index={column as 0 | 1}>
                {ids.map((id, row) => (
                  <SortableModule
                    key={id}
                    id={id}
                    column={column as 0 | 1}
                    row={row}
                    columns={layout.columns}
                    series={series}
                    spaceKey={spaceKey}
                    onMove={(direction) => moveBy(id, column as 0 | 1, row, direction)}
                    onHide={() => hide(id)}
                    indicator={{
                      before: drop.indicator?.overId === id && !drop.indicator.after,
                      after: drop.indicator?.overId === id && drop.indicator.after,
                    }}
                  />
                ))}
                <DropLine show={drop.indicator?.overId === COLUMN_IDS[column]} />
                {ids.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border p-4 text-sm text-text-muted">
                    {t("meetings.overview.emptyColumn")}
                  </p>
                ) : null}
              </Column>
            </SortableContext>
          ))}
        </div>
        <DragOverlay>
          {dragging ? (
            <div className="rounded-md border border-border bg-surface px-3 py-2 font-semibold shadow-popover">
              {nameOf(dragging)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <span className="font-semibold">{t("meetings.overview.addModules")}</span>
        {layout.hidden.length === 0 ? (
          <span className="text-sm text-text-muted">{t("meetings.overview.allShown")}</span>
        ) : (
          layout.hidden.map((id) => (
            <Button key={id} size="sm" variant="secondary" icon={Plus} onClick={() => show(id)}>
              {translateKey(t, `meetings.overview.modules.${id}`)}
            </Button>
          ))
        )}
        <span className="ml-auto text-sm text-text-muted">{t("meetings.overview.sharedHint")}</span>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">{t("meetings.overview.pinned")}</h3>
        <ul className="flex flex-col">
          {series.overview.links.map((link) => (
            <li key={link.id} className="flex min-h-hit items-center gap-2 border-t border-border">
              <Link2 aria-hidden="true" className="size-icon-md text-text-muted" />
              <span className="min-w-0 flex-1 truncate" title={link.title}>
                {link.title}
              </span>
              <IconButton
                size="sm"
                variant="ghost"
                icon={X}
                label={t("meetings.overview.unpin", { title: link.title })}
                onClick={() => void save({ ...layout, links: layout.links.filter((id) => id !== link.id) })}
              />
            </li>
          ))}
        </ul>
        <div className="w-field max-w-full">
          <Combobox
            load={linkLoader(series.spaceId)}
            value={null}
            placeholder={t("meetings.overview.pinPlaceholder")}
            aria-label={t("meetings.overview.pin")}
            onValueChange={(value) => {
              if (value && !layout.links.includes(value))
                void save({ ...layout, links: [...layout.links, value] });
            }}
          />
        </div>
      </div>
    </div>
  );
}
