import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Clock, Flag, ListChecks, ListTodo } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { tasksQuery } from "../collaboration/queries.js";
import { localDateInZone } from "../format/zoned.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { TaskLine } from "./agenda.js";
import { type Agenda, agendaQuery, meetingQuery } from "./queries.js";

export function discussedTopics(agenda: Agenda): { discussed: number; total: number } {
  const spoken = agenda.topics.filter(
    (topic) => (topic.update?.text.trim() ?? "") !== "" || (!agenda.current && topic.status !== "open"),
  ).length;
  return agenda.current
    ? { discussed: spoken + agenda.closedTopics, total: agenda.topics.length + agenda.closedTopics }
    : { discussed: spoken, total: agenda.topics.length };
}

function Card({
  id,
  icon: IconComponent,
  title,
  count,
  children,
}: {
  id: string;
  icon: typeof Flag;
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <h2 id={id} className="flex items-center gap-2 text-sm font-semibold">
        <IconComponent aria-hidden="true" className="size-icon-sm text-text-muted" />
        {title}
        {count !== undefined ? <span className="font-normal text-text-muted">{count}</span> : null}
      </h2>
      {children}
    </section>
  );
}

export function MeetingRail({ meetingId, spaceKey }: { meetingId: string; spaceKey: string }) {
  const { t } = useTranslation();
  const format = useFormat();
  const agenda = useQuery({ ...agendaQuery(meetingId), throwOnError: false });
  const meeting = useQuery({ ...meetingQuery(meetingId), throwOnError: false });
  const seriesId = agenda.data?.seriesId ?? "";
  const open = useQuery({
    ...tasksQuery({ seriesId, status: "open", limit: 1 }),
    enabled: seriesId !== "",
    throwOnError: false,
  });
  if (!agenda.data) return null;
  const { decisions, tasks } = agenda.data;
  const progress = discussedTopics(agenda.data);
  const today = localDateInZone(new Date(), meeting.data?.timeZone ?? format.settings.timeZone);
  const share = progress.total === 0 ? 0 : Math.round((progress.discussed / progress.total) * 100);
  return (
    <aside
      aria-label={t("meetings.rail.label")}
      className="flex flex-col gap-3 xl:sticky xl:top-4 xl:col-start-2 xl:row-span-3 xl:row-start-1 xl:self-start"
    >
      <Card id="meeting-progress" icon={ListChecks} title={t("meetings.rail.progress")}>
        <p className="text-sm text-text-muted">
          {t("meetings.rail.discussed", { count: progress.discussed, total: progress.total })}
        </p>
        <div
          role="progressbar"
          aria-label={t("meetings.rail.progress")}
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.discussed}
          className="h-2 overflow-hidden rounded-full bg-control"
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${share}%` }} />
        </div>
      </Card>
      <Card
        id="meeting-decisions"
        icon={Flag}
        title={t("meetings.outcomes.decisions")}
        count={decisions.length}
      >
        {decisions.length === 0 ? (
          <p className="text-sm text-text-muted">{t("meetings.outcomes.noDecisions")}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {decisions.map((decision) => (
              <li key={decision.id} className="flex flex-col">
                <span className="break-words">{decision.text || t("meetings.decisions.noStatement")}</span>
                {decision.topicTitle ? <span className="text-text-muted">{decision.topicTitle}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card id="meeting-tasks" icon={ListTodo} title={t("meetings.outcomes.tasks")} count={tasks.length}>
        {tasks.length === 0 ? (
          <p className="text-sm text-text-muted">{t("meetings.outcomes.noTasks")}</p>
        ) : (
          <ul className="flex flex-col text-sm">
            {tasks.map((task) => (
              <TaskLine key={task.id} task={task} today={today} />
            ))}
          </ul>
        )}
      </Card>
      {open.data ? (
        <Card
          id="meeting-series-tasks"
          icon={Clock}
          title={t("meetings.rail.openInSeries")}
          count={open.data.counts.open}
        >
          <p className="text-sm text-text-muted">
            {open.data.counts.overdue > 0 ? (
              <span className="text-danger">
                {t("meetings.rail.overdue", { count: open.data.counts.overdue })}
              </span>
            ) : (
              t("meetings.rail.noneOverdue")
            )}
          </p>
          <Link
            to="/spaces/$spaceKey/meetings/$number/{-$slug}"
            params={{ spaceKey, number: agenda.data?.seriesNumber ?? 0 }}
            search={{ tab: "tasks" }}
            className="self-start text-sm text-accent hover:underline focus-visible:focus-ring"
          >
            {t("meetings.rail.allTasks")}
          </Link>
        </Card>
      ) : null}
    </aside>
  );
}
