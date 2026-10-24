import { useQuery } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TaskLine } from "./agenda.js";
import { agendaQuery } from "./queries.js";

export function MeetingOutcomes({ meetingId }: { meetingId: string }) {
  const { t } = useTranslation();
  const agenda = useQuery({ ...agendaQuery(meetingId), throwOnError: false });
  if (!agenda.data) return null;
  const { decisions, tasks } = agenda.data;
  return (
    <>
      <section aria-labelledby="meeting-decisions" className="flex flex-col gap-2">
        <h2 id="meeting-decisions" className="flex items-baseline gap-2 text-lg font-semibold">
          {t("meetings.outcomes.decisions")}
          <span className="text-sm font-normal text-text-muted">{t("meetings.outcomes.fromTopics")}</span>
        </h2>
        {decisions.length === 0 ? (
          <p className="border-t border-border py-3 text-sm text-text-muted">
            {t("meetings.outcomes.noDecisions")}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border border-t border-border">
            {decisions.map((decision) => (
              <li key={decision.id} className="flex gap-3 py-2">
                <Flag aria-hidden="true" className="mt-1 size-icon-md shrink-0 text-success" />
                <span className="flex min-w-0 flex-col">
                  <span className="break-words">{decision.text || t("meetings.decisions.noStatement")}</span>
                  {decision.topicTitle ? (
                    <span className="text-sm text-text-muted">{decision.topicTitle}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="meeting-tasks" className="flex flex-col gap-2">
        <h2 id="meeting-tasks" className="flex items-baseline gap-2 text-lg font-semibold">
          {t("meetings.outcomes.tasks")}
          <span className="text-sm font-normal text-text-muted">{t("meetings.outcomes.fromTopics")}</span>
        </h2>
        {tasks.length === 0 ? (
          <p className="border-t border-border py-3 text-sm text-text-muted">
            {t("meetings.outcomes.noTasks")}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border border-t border-border">
            {tasks.map((task) => (
              <TaskLine key={task.id} task={task} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
