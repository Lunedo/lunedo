import {
  Avatar,
  Checkbox,
  EmptyState,
  FilterMenu,
  PageHeader,
  SegmentedControl,
  Table,
  type TableColumn,
  type TableGroup,
  Tooltip,
} from "@lunedo/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { ListChecks } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDebounced } from "../components/table-state.js";
import { LoadError } from "../errors/failure.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { peopleQuery, spacesQuery } from "../search/search-api.js";
import { useOrganizationState } from "../shell/shell-context.js";
import { itemHref } from "../spaces/item-paths.js";
import { type TaskEntry, type TaskQuery, tasksQuery } from "./queries.js";
import { useSetTaskStatus } from "./task-actions.js";

const route = getRouteApi("/app/tasks");

export const taskViews = ["open", "done", "created"] as const;
export type TaskView = (typeof taskViews)[number];
export const taskDueFilters = ["any", "overdue", "next7Days", "next30Days", "none"] as const;
export const taskGroupings = ["due", "space", "none"] as const;
export type TaskGrouping = (typeof taskGroupings)[number];
export const taskSortKeys = ["due", "text", "item", "assignedBy"] as const;
type TaskSortKey = (typeof taskSortKeys)[number];

const PAGE_SIZE = 50;
const dueGroups = ["overdue", "thisWeek", "later", "none"] as const;
type DueGroup = (typeof dueGroups)[number];

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function endOfWeek(now: Date, firstDay: "monday" | "sunday" | "saturday"): string {
  const start = { sunday: 0, monday: 1, saturday: 6 }[firstDay];
  const last = (start + 6) % 7;
  const end = new Date(now);
  end.setDate(now.getDate() + ((last - now.getDay() + 7) % 7));
  return isoDay(end);
}

function dueGroupOf(task: TaskEntry, weekEnd: string): DueGroup {
  if (!task.dueDate) return "none";
  if (task.overdue) return "overdue";
  return task.dueDate <= weekEnd ? "thisWeek" : "later";
}

function TaskCheck({ task }: { task: TaskEntry }) {
  const { t } = useTranslation();
  const setStatus = useSetTaskStatus(task.item.id);
  return (
    <Checkbox
      checked={task.done}
      aria-label={
        task.done ? t("tasks.markOpen", { task: task.text }) : t("tasks.markDone", { task: task.text })
      }
      onCheckedChange={(checked) => setStatus.mutate({ taskId: task.id, done: checked })}
    />
  );
}

function Person({ person }: { person: { name: string } | null }) {
  const { t } = useTranslation();
  if (!person) return <span className="text-text-muted">{t("tasks.nobody")}</span>;
  return (
    <Tooltip content={person.name}>
      <span className="inline-flex">
        <Avatar name={person.name} size="sm" />
      </span>
    </Tooltip>
  );
}

type MyTasksSearch = ReturnType<typeof route.useSearch>;

export function myTasksQuery(search: MyTasksSearch, cursor: string | null): TaskQuery {
  const view: TaskView = search.view ?? "open";
  return {
    ...(view === "created" ? { assignedBy: "me" as const } : { assignee: "me" as const }),
    ...(search.by && view !== "created" ? { assignedBy: search.by } : {}),
    ...(search.space ? { spaceId: search.space } : {}),
    status: view === "done" ? "done" : "open",
    due: search.due ?? "any",
    sort: search.sort ?? "due",
    direction: search.dir ?? "asc",
    limit: PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
  };
}

export function MyTasksScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const search = route.useSearch();
  const organization = useOrganizationState();
  const organizationId = organization.organizationId ?? "";
  const view: TaskView = search.view ?? "open";
  const due = search.due ?? "any";
  const grouping: TaskGrouping = search.group ?? "due";
  const sortKey: TaskSortKey = search.sort ?? "due";
  const direction = search.dir ?? "asc";
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [spaceSearch, setSpaceSearch] = useState("");
  const [personSearch, setPersonSearch] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const spaceTerm = useDebounced(spaceSearch.trim());
  const personTerm = useDebounced(personSearch.trim());
  useDocumentTitle(t("tasks.myTitle"));

  const change = (next: Partial<typeof search>) => {
    setCursors([null]);
    void navigate({ to: "/tasks", search: { ...search, ...next }, replace: true });
  };

  const query = myTasksQuery(search, cursors.at(-1) ?? null);
  const tasks = useQuery({ ...tasksQuery(query), placeholderData: keepPreviousData });
  const spaces = useQuery({
    ...spacesQuery(organizationId, spaceTerm, 20),
    enabled: organizationId !== "",
    throwOnError: false,
  });
  const people = useQuery({
    ...peopleQuery(personTerm, 10),
    enabled: personTerm.length > 0,
    throwOnError: false,
  });

  const weekEnd = endOfWeek(new Date(), format.firstDayOfWeek);
  const rows = tasks.data?.items ?? [];
  const groupOf = useMemo(() => {
    if (grouping === "none") return undefined;
    const keyOf = (task: TaskEntry) => (grouping === "due" ? dueGroupOf(task, weekEnd) : task.item.spaceId);
    const counts = new Map<string, number>();
    for (const task of rows) counts.set(keyOf(task), (counts.get(keyOf(task)) ?? 0) + 1);
    return (task: TaskEntry): TableGroup => {
      const key = keyOf(task);
      return {
        key,
        label: grouping === "due" ? t(`tasks.groups.${key as DueGroup}`) : task.item.spaceName,
        count: counts.get(key) ?? 0,
      };
    };
  }, [grouping, rows, weekEnd, t]);
  const ordered = useMemo(() => {
    if (grouping === "none") return rows;
    const rank =
      grouping === "due"
        ? (task: TaskEntry) => dueGroups.indexOf(dueGroupOf(task, weekEnd))
        : (task: TaskEntry) => rows.findIndex((other) => other.item.spaceId === task.item.spaceId);
    return rows
      .map((task, index) => ({ task, index }))
      .sort((left, right) => rank(left.task) - rank(right.task) || left.index - right.index)
      .map((entry) => entry.task);
  }, [rows, grouping, weekEnd]);

  const columns: TableColumn<TaskEntry>[] = [
    {
      key: "text",
      header: t("tasks.columns.task"),
      sortable: true,
      grow: true,
      cell: (task) => (
        <span className="flex items-center gap-3">
          <TaskCheck task={task} />
          <span
            className={task.done ? "truncate text-text-muted line-through" : "truncate"}
            title={task.text}
          >
            {task.text || t("tasks.untitled")}
          </span>
        </span>
      ),
    },
    {
      key: "item",
      header: t("tasks.columns.page"),
      sortable: true,
      cell: (task) => {
        const href = itemHref(
          { id: task.item.id, kind: task.item.kind, title: task.item.title, link: null },
          task.item.spaceKey,
        );
        return (
          <span className="flex max-w-card flex-col">
            {href ? (
              <Link
                to={href}
                className="truncate hover:underline focus-visible:focus-ring"
                title={task.item.title}
              >
                {task.item.title}
              </Link>
            ) : (
              <span className="truncate">{task.item.title}</span>
            )}
            <span className="truncate text-xs text-text-muted" title={task.item.spaceName}>
              {task.item.spaceName}
            </span>
          </span>
        );
      },
    },
    {
      key: "due",
      header: t("tasks.columns.due"),
      sortable: true,
      cell: (task) =>
        task.dueDate ? (
          <time
            dateTime={task.dueDate}
            title={format.date(`${task.dueDate}T12:00:00Z`)}
            className={task.overdue ? "whitespace-nowrap text-danger" : "whitespace-nowrap"}
          >
            {format.day(`${task.dueDate}T12:00:00Z`)}
          </time>
        ) : (
          <span className="text-text-muted">–</span>
        ),
    },
    {
      key: "assignedBy",
      header: view === "created" ? t("tasks.columns.assignee") : t("tasks.columns.assignedBy"),
      sortable: view !== "created",
      cell: (task) => <Person person={view === "created" ? task.assignee : task.assignedBy} />,
    },
  ];

  const spaceOptions = [
    { value: "", label: t("tasks.filters.all") },
    ...(spaces.data?.items ?? []).map((space) => ({ value: space.id, label: space.name })),
  ];
  const spaceName =
    search.space &&
    (names[search.space] ??
      rows.find((task) => task.item.spaceId === search.space)?.item.spaceName ??
      spaces.data?.items.find((space) => space.id === search.space)?.name);
  const personOptions = [
    { value: "", label: t("tasks.filters.anyone") },
    ...(people.data?.items ?? []).map((person) => ({
      value: person.id,
      label: person.name,
      ...(person.email ? { description: person.email } : {}),
    })),
  ];
  const personName =
    search.by &&
    (names[search.by] ?? rows.find((task) => task.assignedBy?.id === search.by)?.assignedBy?.name);
  const remember = (id: string, options: { value: string; label: string }[]) => {
    const label = options.find((option) => option.value === id)?.label;
    if (id && label) setNames((current) => ({ ...current, [id]: label }));
  };

  return (
    <main
      id="main"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the content area scrolls and must be reachable by keyboard
      tabIndex={0}
      className="min-w-0 flex-1 overflow-y-auto outline-none focus-visible:focus-ring"
    >
      <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
        <PageHeader title={t("tasks.myTitle")} description={t("tasks.myDescription")} />
        <div data-filter-row="" className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
          <span className="shrink-0">
            <SegmentedControl
              label={t("tasks.filter")}
              value={view}
              onValueChange={(value) => change({ view: value as TaskView })}
              options={taskViews.map((value) => ({ value, label: t(`tasks.views.${value}`) }))}
            />
          </span>
          <span className="flex shrink-0 gap-2">
            <FilterMenu
              label={t("tasks.filters.space")}
              value={search.space ?? ""}
              valueLabel={search.space ? (spaceName ?? t("tasks.filters.chosen")) : t("tasks.filters.all")}
              options={spaceOptions}
              search={{
                value: spaceSearch,
                onChange: setSpaceSearch,
                placeholder: t("tasks.filters.searchSpace"),
              }}
              onValueChange={(value) => {
                remember(value, spaceOptions);
                change({ space: value || undefined });
              }}
            />
            <FilterMenu
              label={t("tasks.filters.due")}
              value={due}
              defaultValue="any"
              options={taskDueFilters.map((value) => ({
                value,
                label: value === "any" ? t("tasks.filters.all") : t(`tasks.due.${value}`),
              }))}
              onValueChange={(value) => change({ due: value as (typeof taskDueFilters)[number] })}
            />
          </span>
          {view === "created" ? null : (
            <FilterMenu
              label={t("tasks.filters.assignedBy")}
              value={search.by ?? ""}
              {...(search.by ? { valueLabel: personName ?? t("tasks.filters.chosen") } : {})}
              options={personOptions}
              search={{
                value: personSearch,
                onChange: setPersonSearch,
                placeholder: t("tasks.searchPerson"),
              }}
              emptyText={personTerm ? t("tasks.filters.nobodyFound") : t("tasks.filters.typeName")}
              onValueChange={(value) => {
                remember(value, personOptions);
                change({ by: value || undefined });
              }}
            />
          )}
          <span className="ml-auto shrink-0">
            <FilterMenu
              label={t("tasks.group.label")}
              value={grouping}
              defaultValue="due"
              options={taskGroupings.map((value) => ({ value, label: t(`tasks.group.${value}`) }))}
              onValueChange={(value) => change({ group: value as TaskGrouping })}
            />
          </span>
        </div>
        {tasks.isError ? (
          <LoadError what={t("tasks.loadFailed")} error={tasks.error} onRetry={() => tasks.refetch()} />
        ) : (
          <Table
            caption={t("tasks.listLabel")}
            columns={columns}
            rows={ordered}
            rowKey={(task) => task.id}
            loading={tasks.isPending}
            {...(groupOf ? { groupOf } : {})}
            sort={{ key: sortKey, direction }}
            onSortChange={(next) => change({ sort: next.key as TaskSortKey, dir: next.direction })}
            empty={
              <EmptyState
                icon={ListChecks}
                title={t(`tasks.empty.${view}.title`)}
                description={t(`tasks.empty.${view}.description`)}
              />
            }
            pagination={{
              hasPrevious: cursors.length > 1,
              hasNext: Boolean(tasks.data?.nextCursor),
              onPrevious: () => setCursors((current) => current.slice(0, -1)),
              onNext: () => {
                const next = tasks.data?.nextCursor;
                if (next) setCursors((current) => [...current, next]);
              },
            }}
          />
        )}
      </div>
    </main>
  );
}
