import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  FilterMenu,
  Table,
  type TableColumn,
  Tooltip,
} from "@lunedo/ui";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { CalendarDays, Flag, ListChecks, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type TaskEntry, type TaskQuery, tasksQuery } from "../collaboration/queries.js";
import { useSetTaskStatus } from "../collaboration/task-actions.js";
import { PersonAvatar } from "../components/person-avatar.js";
import { usePaged, useSorted } from "../components/table-state.js";
import { LoadError } from "../errors/failure.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { itemSlug } from "../spaces/item-paths.js";
import { pagePath } from "../spaces/space-queries.js";
import {
  decisionsQuery,
  type MeetingSummary,
  type Series,
  type Topic,
  topicPath,
  topicsQuery,
} from "./queries.js";
import { seriesMeetingsQuery } from "./series-overview.js";
import { TopicForm } from "./topic-form.js";

const PAGE = 25;
const TOPIC_PAGE = 10;
type TopicStatus = "open" | "closed" | "all";

function Person({ id, name }: { id: string; name: string | null }) {
  const { t } = useTranslation();
  const label = name ?? t("meetings.unknownPerson");
  return (
    <Tooltip content={label}>
      <span className="inline-flex">
        <PersonAvatar id={id} name={label} size="sm" />
      </span>
    </Tooltip>
  );
}

export function TopicsTab({
  series,
  spaceKey,
  status,
  writable,
}: {
  series: Series;
  spaceKey: string;
  status: TopicStatus;
  writable: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const [owner, setOwner] = useState("");
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const topics = useQuery({
    ...topicsQuery(series.id, {
      status,
      ...(owner ? { ownerId: owner } : {}),
      ...(label ? { label } : {}),
    }),
    placeholderData: keepPreviousData,
  });
  const all = useQuery(topicsQuery(series.id, { status: "all" }));
  const labels = [...new Set((all.data ?? []).flatMap((topic) => topic.labels))].sort();
  const owners = new Map(
    [
      ...series.members.map((member) => [member.id, member.name] as const),
      ...(all.data ?? []).flatMap((topic) =>
        topic.owner ? [[topic.owner.id, topic.owner.name] as const] : [],
      ),
    ].map(([id, name]) => [id, name ?? t("meetings.unknownPerson")]),
  );
  const value = useMemo(
    () =>
      (topic: Topic, key: string): string | number => {
        if (key === "title") return topic.title.toLowerCase();
        if (key === "owner") return (topic.owner?.name ?? "").toLowerCase();
        if (key === "since") return topic.createdAt;
        if (key === "updates") return topic.updates;
        return topic.openTasks;
      },
    [],
  );
  const sorted = useSorted(topics.data ?? [], { key: "since", direction: "asc" }, value);
  const paged = usePaged(sorted.rows, TOPIC_PAGE);
  const setStatus = (next: string) =>
    void navigate({
      to: ".",
      search: (current) => ({ ...current, tab: "topics", status: next as TopicStatus }),
    });
  const columns: TableColumn<Topic>[] = [
    {
      key: "title",
      header: t("meetings.tabs.columns.topic"),
      sortable: true,
      grow: true,
      cell: (topic) => (
        <span className="flex min-w-0 flex-col">
          <Link
            to={topicPath(spaceKey, topic.id)}
            className="truncate font-medium text-text hover:underline focus-visible:focus-ring"
          >
            {topic.title}
          </Link>
          {topic.labels.length > 0 ? (
            <span className="truncate text-xs text-text-muted">
              {topic.labels.map((entry) => `#${entry}`).join(" ")}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "owner",
      header: t("meetings.topics.owner"),
      sortable: true,
      cell: (topic) =>
        topic.owner ? (
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <PersonAvatar id={topic.owner.id} name={topic.owner.name ?? "?"} size="sm" decorative />
            {topic.owner.name ?? t("meetings.unknownPerson")}
          </span>
        ) : (
          <span className="text-text-muted">{t("meetings.topics.noOwner")}</span>
        ),
    },
    {
      key: "since",
      header: t("meetings.tabs.columns.since"),
      sortable: true,
      cell: (topic) => (
        <time dateTime={topic.createdAt} title={format.date(topic.createdAt)} className="whitespace-nowrap">
          {format.calendarDate(topic.createdAt)}
        </time>
      ),
    },
    {
      key: "updates",
      header: t("meetings.tabs.columns.updates"),
      sortable: true,
      align: "end",
      cell: (topic) => topic.updates,
    },
    {
      key: "tasks",
      header: t("meetings.tabs.columns.tasks"),
      sortable: true,
      align: "end",
      cell: (topic) => topic.openTasks,
    },
    {
      key: "status",
      header: t("meetings.topics.status"),
      cell: (topic) => (
        <Badge
          variant={topic.status === "open" ? "accent" : topic.outcome === "decided" ? "success" : "neutral"}
        >
          {topic.status === "open"
            ? t("meetings.topic.open")
            : translateKey(t, `meetings.topics.outcome.${topic.outcome ?? "resolved"}`)}
        </Badge>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterMenu
          label={t("meetings.topics.status")}
          value={status}
          defaultValue="open"
          options={[
            { value: "open", label: t("meetings.topics.statusFilter.open") },
            { value: "closed", label: t("meetings.tabs.archive") },
            { value: "all", label: t("meetings.topics.statusFilter.all") },
          ]}
          onValueChange={setStatus}
        />
        <FilterMenu
          label={t("meetings.topics.owner")}
          value={owner}
          options={[
            { value: "", label: t("meetings.agenda.everyone") },
            ...[...owners].map(([id, name]) => ({ value: id, label: name })),
          ]}
          onValueChange={setOwner}
        />
        {labels.length > 0 ? (
          <FilterMenu
            label={t("meetings.topics.label")}
            value={label}
            options={[
              { value: "", label: t("meetings.tabs.allLabels") },
              ...labels.map((entry) => ({ value: entry, label: entry })),
            ]}
            onValueChange={setLabel}
          />
        ) : null}
        {writable ? (
          <span className="ml-auto">
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAdding(true)}>
              {t("meetings.agenda.topic")}
            </Button>
          </span>
        ) : null}
      </div>
      {adding ? <TopicForm seriesId={series.id} onDone={() => setAdding(false)} /> : null}
      {topics.isError ? (
        <LoadError
          what={t("meetings.topics.loadFailed")}
          error={topics.error}
          onRetry={() => topics.refetch()}
        />
      ) : (
        <Table
          caption={t("meetings.tabs.topics")}
          columns={columns}
          rows={paged.rows}
          rowKey={(topic) => topic.id}
          loading={topics.isPending}
          sort={sorted.sort}
          onSortChange={(next) => {
            sorted.setSort(next);
            paged.reset();
          }}
          {...(paged.pagination ? { pagination: paged.pagination } : {})}
          empty={status === "closed" ? t("meetings.tabs.noClosedTopics") : t("meetings.topics.noMatch")}
        />
      )}
    </div>
  );
}

function TaskRow({ task }: { task: TaskEntry }) {
  const { t } = useTranslation();
  const format = useFormat();
  const setStatus = useSetTaskStatus(task.item.id);
  return (
    <li className="flex min-h-hit items-center gap-3 border-t border-border py-2">
      <Checkbox
        checked={task.done}
        aria-label={
          task.done ? t("tasks.markOpen", { task: task.text }) : t("tasks.markDone", { task: task.text })
        }
        onCheckedChange={(checked) => setStatus.mutate({ taskId: task.id, done: checked })}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={task.done ? "truncate text-text-muted line-through" : "truncate"}>
          {task.text || t("tasks.untitled")}
        </span>
        <span className="truncate text-sm text-text-muted">{task.item.title}</span>
      </span>
      <span className="inline-flex items-center gap-2 text-sm text-text-muted">
        {task.assignee ? <Person id={task.assignee.id} name={task.assignee.name} /> : null}
        {task.dueDate ? (
          <time dateTime={task.dueDate} className={task.overdue ? "text-danger" : undefined}>
            {format.day(`${task.dueDate}T12:00:00Z`)}
          </time>
        ) : null}
      </span>
    </li>
  );
}

export function TasksTab({ series }: { series: Series }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"open" | "done">("open");
  const [person, setPerson] = useState("");
  const [sort, setSort] = useState<"due" | "assignee" | "text">("due");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const reset = () => setCursors([null]);
  const query: TaskQuery = {
    seriesId: series.id,
    status,
    due: "any",
    sort,
    limit: PAGE,
    ...(person ? { assignee: person } : {}),
    ...(cursors.at(-1) ? { cursor: cursors.at(-1) as string } : {}),
  };
  const tasks = useQuery({ ...tasksQuery(query), placeholderData: keepPreviousData });
  const next = tasks.data?.nextCursor ?? null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterMenu
          label={t("meetings.topics.status")}
          value={status}
          defaultValue="open"
          options={[
            { value: "open", label: t("tasks.status.open") },
            { value: "done", label: t("tasks.status.done") },
          ]}
          onValueChange={(value) => {
            setStatus(value as "open" | "done");
            reset();
          }}
        />
        <FilterMenu
          label={t("meetings.tabs.person")}
          value={person}
          options={[
            { value: "", label: t("meetings.agenda.everyone") },
            ...series.members.map((member) => ({
              value: member.id,
              label: member.name ?? t("meetings.unknownPerson"),
            })),
          ]}
          onValueChange={(value) => {
            setPerson(value);
            reset();
          }}
        />
        <FilterMenu
          label={t("meetings.tabs.sort")}
          value={sort}
          defaultValue="due"
          options={[
            { value: "due", label: t("meetings.tabs.byDue") },
            { value: "assignee", label: t("meetings.tabs.byPerson") },
            { value: "text", label: t("meetings.tabs.byText") },
          ]}
          onValueChange={(value) => {
            setSort(value as "due" | "assignee" | "text");
            reset();
          }}
        />
      </div>
      {tasks.isError ? (
        <LoadError what={t("tasks.loadFailed")} error={tasks.error} onRetry={() => tasks.refetch()} />
      ) : tasks.data && tasks.data.items.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={t("meetings.series.noTasksTitle")}
          description={t("meetings.series.noTasksDescription")}
        />
      ) : (
        <ul aria-label={t("meetings.tabs.tasks")} className="flex flex-col">
          {(tasks.data?.items ?? []).map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      )}
      <Pager
        hasPrevious={cursors.length > 1}
        hasNext={next !== null}
        onPrevious={() => setCursors((current) => current.slice(0, -1))}
        onNext={() => next && setCursors((current) => [...current, next])}
      />
    </div>
  );
}

function Pager({
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: {
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  if (!hasPrevious && !hasNext) return null;
  return (
    <nav aria-label={t("meetings.tabs.pages")} className="flex justify-end gap-2">
      {hasPrevious ? (
        <Button size="sm" variant="secondary" onClick={onPrevious}>
          {t("meetings.tabs.previous")}
        </Button>
      ) : null}
      {hasNext ? (
        <Button size="sm" variant="secondary" onClick={onNext}>
          {t("meetings.tabs.next")}
        </Button>
      ) : null}
    </nav>
  );
}

const PERIODS = ["any", "30", "90", "365"] as const;

export function DecisionsTab({ series, spaceKey }: { series: Series; spaceKey: string }) {
  const { t } = useTranslation();
  const format = useFormat();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("any");
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const [page, setPage] = useState(0);
  const from =
    period === "any" ? undefined : new Date(Date.now() - Number(period) * 86_400_000).toISOString();
  const decisions = useQuery({
    ...decisionsQuery(series.id, { limit: 500, ...(from ? { from } : {}) }),
    placeholderData: keepPreviousData,
  });
  const rows = order === "newest" ? (decisions.data ?? []) : [...(decisions.data ?? [])].reverse();
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  if (decisions.isError) {
    return (
      <LoadError
        what={t("meetings.decisions.loadFailed")}
        error={decisions.error}
        onRetry={() => decisions.refetch()}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterMenu
          label={t("meetings.tabs.period")}
          value={period}
          defaultValue="any"
          options={PERIODS.map((value) => ({ value, label: t(`meetings.tabs.periods.${value}`) }))}
          onValueChange={(value) => {
            setPeriod(value as (typeof PERIODS)[number]);
            setPage(0);
          }}
        />
        <FilterMenu
          label={t("meetings.tabs.sort")}
          value={order}
          defaultValue="newest"
          options={[
            { value: "newest", label: t("meetings.tabs.newest") },
            { value: "oldest", label: t("meetings.tabs.oldest") },
          ]}
          onValueChange={(value) => setOrder(value as "newest" | "oldest")}
        />
      </div>
      {decisions.data && rows.length === 0 ? (
        <p className="border-t border-border py-3 text-sm text-text-muted">{t("meetings.decisions.empty")}</p>
      ) : (
        <ul aria-label={t("meetings.tabs.decisions")} className="flex flex-col">
          {shown.map((decision) => (
            <li key={decision.id} className="flex gap-3 border-t border-border py-2">
              <Flag aria-hidden="true" className="mt-1 size-icon-md shrink-0 text-success" />
              <span className="flex min-w-0 flex-col">
                <span className="break-words">{decision.text || t("meetings.decisions.noStatement")}</span>
                <span className="text-sm text-text-muted">
                  <Link
                    to={pagePath(spaceKey, decision.meeting.id, itemSlug(decision.meeting.title))}
                    className="hover:underline focus-visible:focus-ring"
                  >
                    {decision.meeting.startsAt
                      ? format.calendarDate(decision.meeting.startsAt)
                      : decision.meeting.title}
                  </Link>
                  {decision.topic ? ` · ${decision.topic.title}` : null}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Pager
        hasPrevious={page > 0}
        hasNext={(page + 1) * PAGE < rows.length}
        onPrevious={() => setPage(page - 1)}
        onNext={() => setPage(page + 1)}
      />
    </div>
  );
}

const MEETING_STATES = ["all", "held", "skipped"] as const;

export function MeetingsTab({ series, spaceKey }: { series: Series; spaceKey: string }) {
  const { t } = useTranslation();
  const format = useFormat();
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const [state, setState] = useState<(typeof MEETING_STATES)[number]>("all");
  const meetings = useInfiniteQuery(seriesMeetingsQuery(series.id));
  if (meetings.isError) {
    return (
      <LoadError
        what={t("meetings.series.meetingsFailed")}
        error={meetings.error}
        onRetry={() => meetings.refetch()}
      />
    );
  }
  const loaded = meetings.data?.pages.flatMap((page) => page.items) ?? [];
  const matching = loaded.filter(
    (meeting: MeetingSummary) =>
      state === "all" ||
      (state === "skipped"
        ? meeting.state === "skipped"
        : meeting.state === "closed" || meeting.state === "reopened"),
  );
  const rows = order === "newest" ? matching : [...matching].reverse();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterMenu
          label={t("meetings.tabs.sort")}
          value={order}
          defaultValue="newest"
          options={[
            { value: "newest", label: t("meetings.tabs.newest") },
            { value: "oldest", label: t("meetings.tabs.oldest") },
          ]}
          onValueChange={(value) => setOrder(value as "newest" | "oldest")}
        />
        <FilterMenu
          label={t("meetings.topics.status")}
          value={state}
          defaultValue="all"
          options={MEETING_STATES.map((value) => ({
            value,
            label: t(`meetings.tabs.meetingStates.${value}`),
          }))}
          onValueChange={(value) => setState(value as (typeof MEETING_STATES)[number])}
        />
      </div>
      <ul aria-label={t("meetings.tabs.meetings")} className="flex flex-col">
        {rows.map((meeting) => (
          <li key={meeting.id} className="flex min-h-hit items-center gap-3 border-t border-border py-2">
            <CalendarDays aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
            <span className="flex min-w-0 flex-1 flex-col">
              <Link
                to={pagePath(spaceKey, meeting.id, itemSlug(meeting.title))}
                className="truncate hover:underline focus-visible:focus-ring"
                title={meeting.title}
              >
                {meeting.startsAt ? format.dateTime(meeting.startsAt) : t("meetings.notScheduled")}
              </Link>
              <span className="truncate text-sm text-text-muted">
                {meeting.state === "upcoming"
                  ? t("meetings.series.openTopics", { count: series.openTopics })
                  : meeting.state === "skipped"
                    ? t("meetings.tabs.skippedMoved")
                    : t("meetings.series.attended", { count: meeting.present, total: meeting.attendees })}
              </span>
            </span>
            {meeting.extra ? <Badge variant="neutral">{t("meetings.meeting.extra")}</Badge> : null}
            <Badge variant={meeting.state === "upcoming" ? "accent" : "neutral"}>
              {translateKey(t, `meetings.state.${meeting.state}`)}
            </Badge>
          </li>
        ))}
      </ul>
      {meetings.hasNextPage ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={meetings.isFetchingNextPage}
          onClick={() => void meetings.fetchNextPage()}
        >
          {t("meetings.series.loadOlder")}
        </Button>
      ) : null}
    </div>
  );
}
