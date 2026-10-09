import { z } from "zod";
import { attrOf, defineModule, optional } from "../module.js";
import { element } from "../text.js";
import { uuidValue } from "../values.js";

export const taskReportDueWindows = ["any", "overdue", "next7Days", "next30Days", "none"] as const;
export type TaskReportDue = (typeof taskReportDueWindows)[number];

export const taskReportStatuses = ["open", "done", "all"] as const;
export type TaskReportStatus = (typeof taskReportStatuses)[number];

export const taskReportModule = defineModule({
  name: "taskReport",
  nodes: [
    {
      name: "taskReport",
      spec: { group: "block", atom: true, selectable: true, draggable: true },
      attrs: {
        spaceId: optional(uuidValue.nullable(), null),
        seriesId: optional(uuidValue.nullable(), null),
        assignee: optional(uuidValue.nullable(), null),
        assignedToViewer: optional(z.boolean(), false),
        due: optional(z.enum(taskReportDueWindows), "any"),
        status: optional(z.enum(taskReportStatuses), "open"),
      },
      validate: (node) =>
        attrOf<string | null>(node, "assignee") !== null && attrOf<boolean>(node, "assignedToViewer")
          ? "A task report filters by one assignee or by the viewer, not both"
          : null,
      html: (node, renderer) =>
        element(
          "div",
          {
            class: "ph-task-report",
            "data-space-id": attrOf<string | null>(node, "spaceId"),
            "data-series-id": attrOf<string | null>(node, "seriesId"),
            "data-assignee": attrOf<string | null>(node, "assignee"),
            "data-assigned-to-viewer": attrOf<boolean>(node, "assignedToViewer") ? "true" : null,
            "data-due": attrOf<string>(node, "due"),
            "data-status": attrOf<string>(node, "status"),
          },
          element("p", {}, renderer.escape(renderer.label("taskReport"))),
        ),
      markdown: (_node, renderer) => `*${renderer.escape(renderer.label("taskReport"))}*`,
      text: () => "",
    },
  ],
});
