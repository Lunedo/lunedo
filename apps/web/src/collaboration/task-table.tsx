import { Badge, Checkbox, EmptyState, Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LoadError } from "../errors/failure.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { itemHref } from "../spaces/item-paths.js";
import { type TaskEntry, type TaskQuery, tasksQuery } from "./queries.js";
import { useSetTaskStatus } from "./task-actions.js";

export function TaskCounts({ counts }: { counts: { open: number; done: number; overdue: number } }) {
  const { t } = useTranslation();
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted" aria-live="polite">
      <span>{t("tasks.openCount", { count: counts.open })}</span>
      <span aria-hidden="true">·</span>
      <span>{t("tasks.doneCount", { count: counts.done })}</span>
      {counts.overdue > 0 ? (
        <>
          <span aria-hidden="true">·</span>
          <Badge variant="danger" icon={AlertTriangle}>
            {t("tasks.overdueCount", { count: counts.overdue })}
          </Badge>
        </>
      ) : null}
    </p>
  );
}

function TaskRow({ task, showAssignee }: { task: TaskEntry; showAssignee: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const setStatus = useSetTaskStatus(task.item.id);
  const href = itemHref(
    { id: task.item.id, kind: task.item.kind, title: task.item.title, link: null },
    task.item.spaceKey,
  );
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="pt-1">
        <Checkbox
          checked={task.done}
          aria-label={
            task.done ? t("tasks.markOpen", { task: task.text }) : t("tasks.markDone", { task: task.text })
          }
          onCheckedChange={(checked) => setStatus.mutate({ taskId: task.id, done: checked })}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={task.done ? "text-text-muted line-through" : ""}>
          {task.text || t("tasks.untitled")}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
          {href ? (
            <Link
              to={href}
              className="text-accent hover:underline focus-visible:focus-ring"
              title={task.item.title}
            >
              {task.item.title}
            </Link>
          ) : null}
          <span>· {task.item.spaceName}</span>
          {showAssignee && task.assignee ? <span>· {task.assignee.name}</span> : null}
        </span>
      </div>
      <div className="shrink-0 pt-1 text-sm">
        {task.dueDate ? (
          task.overdue ? (
            <Badge variant="danger" icon={AlertTriangle}>
              {t("tasks.overdueSince", { date: format.date(`${task.dueDate}T12:00:00Z`) })}
            </Badge>
          ) : (
            <time dateTime={task.dueDate} className="text-text-muted">
              {t("tasks.dueOn", { date: format.date(`${task.dueDate}T12:00:00Z`) })}
            </time>
          )
        ) : (
          <span className="text-text-muted">{t("tasks.noDueDate")}</span>
        )}
      </div>
    </li>
  );
}

export function TaskTable({
  query,
  showAssignee,
  emptyTitle,
  emptyDescription,
}: {
  query: TaskQuery;
  showAssignee: boolean;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const { t } = useTranslation();
  const tasks = useQuery(tasksQuery(query));
  if (tasks.isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-row w-48" />
        <Skeleton className="h-field w-full" />
      </div>
    );
  }
  if (tasks.isError) {
    return <LoadError what={t("tasks.loadFailed")} error={tasks.error} onRetry={() => tasks.refetch()} />;
  }
  return (
    <div className="flex flex-col gap-2">
      <TaskCounts counts={tasks.data.counts} />
      {tasks.data.items.length === 0 ? (
        <EmptyState icon={ListChecks} title={emptyTitle} description={emptyDescription} />
      ) : (
        <ul
          aria-label={t("tasks.listLabel")}
          className="flex flex-col divide-y divide-border rounded-md border border-border"
        >
          {tasks.data.items.map((task) => (
            <TaskRow key={task.id} task={task} showAssignee={showAssignee} />
          ))}
        </ul>
      )}
      {tasks.data.nextCursor ? <p className="text-sm text-text-muted">{t("tasks.moreNotShown")}</p> : null}
    </div>
  );
}
