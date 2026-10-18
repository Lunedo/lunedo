import { PageHeader, SegmentedControl } from "@pagehall/ui";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { TaskTable } from "./task-table.js";

const route = getRouteApi("/app/tasks");

export const taskFilters = ["open", "overdue", "done"] as const;
export type TaskFilter = (typeof taskFilters)[number];

export function MyTasksScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const filter = route.useSearch().filter ?? "open";
  useDocumentTitle(t("tasks.myTitle"));
  const query =
    filter === "overdue"
      ? { assignee: "me" as const, status: "open" as const, due: "overdue" as const, limit: 200 }
      : { assignee: "me" as const, status: filter, due: "any" as const, limit: 200 };
  return (
    <main
      id="main"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the content area scrolls and must be reachable by keyboard
      tabIndex={0}
      className="min-w-0 flex-1 overflow-y-auto outline-none focus-visible:focus-ring"
    >
      <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
        <PageHeader title={t("tasks.myTitle")} description={t("tasks.myDescription")} icon={ListChecks} />
        <SegmentedControl
          label={t("tasks.filter")}
          value={filter}
          onValueChange={(value) =>
            void navigate({ to: "/tasks", search: { filter: value as TaskFilter }, replace: true })
          }
          options={taskFilters.map((value) => ({ value, label: t(`tasks.filters.${value}`) }))}
        />
        <TaskTable
          query={query}
          showAssignee={false}
          emptyTitle={t(`tasks.empty.${filter}.title`)}
          emptyDescription={t(`tasks.empty.${filter}.description`)}
        />
      </div>
    </main>
  );
}
