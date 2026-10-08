import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { reportFilters, TaskReport } from "../../collaboration/task-report.js";
import { usePageContext } from "../context.js";

export function TaskReportView({ node, editor, updateAttributes, selected }: NodeViewProps) {
  const page = usePageContext();
  return (
    <NodeViewWrapper
      className={`ph-task-report-block${selected ? " ph-node-selected" : ""}`}
      contentEditable={false}
      data-type="taskReport"
    >
      <TaskReport
        filters={reportFilters(node.attrs)}
        currentSpaceId={page?.spaceId ?? null}
        {...(editor.isEditable ? { onChange: (changes) => updateAttributes(changes) } : {})}
      />
    </NodeViewWrapper>
  );
}
