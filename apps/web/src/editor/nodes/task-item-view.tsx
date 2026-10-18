import { Avatar, Button, Combobox, Field, Input, Popover, useToast } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { NodeViewContent, type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { CalendarDays, UserRound, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { checkMentionAccess, peopleLoader } from "../../collaboration/people.js";
import { taskStatusesQuery } from "../../collaboration/queries.js";
import { useSetTaskStatus } from "../../collaboration/task-actions.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useEditable, usePageContext } from "../context.js";
import { takeTaskStatus } from "../extensions/pasted-tasks.js";
import { rememberReferences, usePersonName } from "../references.js";

export function TaskItemView({ node, editor, updateAttributes }: NodeViewProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const page = usePageContext();
  const id = (node.attrs.id as string | null) ?? null;
  const assignee = (node.attrs.assignee as string | null) ?? null;
  const dueDate = (node.attrs.dueDate as string | null) ?? null;
  const assigneeName = usePersonName(assignee ?? "");
  const statuses = useQuery({
    ...taskStatusesQuery(page?.pageId ?? ""),
    enabled: page !== null,
    throwOnError: false,
  });
  const editable = useEditable(editor);
  const setStatus = useSetTaskStatus(page?.pageId ?? null, { onPage: editable });
  const hintId = useId();
  const status = id ? statuses.data?.find((entry) => entry.id === id) : undefined;
  const done = status?.done ?? false;
  const [assigning, setAssigning] = useState(false);
  const [dating, setDating] = useState(false);
  const text = node.textContent.trim() || t("tasks.untitled");
  const known = status !== undefined;
  const { mutate } = setStatus;

  useEffect(() => {
    if (!id || !page || !editable) return;
    const pasted = takeTaskStatus(id);
    if (pasted !== undefined) mutate({ taskId: id, done: pasted });
  }, [id, page, editable, mutate]);

  const toggle = () => {
    if (!id || (!editable && !known)) {
      toast({
        title: t("tasks.notSavedYet"),
        description: t("tasks.notSavedYetDescription"),
      });
      return;
    }
    setStatus.mutate({ taskId: id, done: !done });
  };

  const assign = async (accountId: string | null, label: string | null) => {
    setAssigning(false);
    if (accountId && label) rememberReferences({ people: { [accountId]: label } });
    updateAttributes({ assignee: accountId });
    if (!accountId || !page) return;
    const access = await checkMentionAccess(page.pageId, [accountId]);
    if (access.some((entry) => !entry.hasAccess)) {
      toast({
        variant: "warning",
        title: t("mentions.noAccess", { name: label ?? t("editor.mention.unknown") }),
        description: t("tasks.assigneeNoAccessDescription"),
      });
    }
  };

  return (
    <NodeViewWrapper
      className="ph-task-item-view flex items-start gap-2"
      data-checked={done ? "true" : "false"}
    >
      <label contentEditable={false} suppressContentEditableWarning>
        <input
          type="checkbox"
          checked={done}
          disabled={!page}
          aria-describedby={page ? undefined : hintId}
          aria-label={done ? t("tasks.markOpen", { task: text }) : t("tasks.markDone", { task: text })}
          onChange={toggle}
        />
      </label>
      <div className={`min-w-0 flex-1${done ? " ph-task-done" : ""}`}>
        <NodeViewContent as="div" />
        {!page ? (
          <p id={hintId} contentEditable={false} suppressContentEditableWarning className="ph-task-hint">
            {t("tasks.checkOnPages")}
          </p>
        ) : null}
        {assignee || dueDate || editable ? (
          <div
            contentEditable={false}
            suppressContentEditableWarning
            className="ph-task-meta flex flex-wrap gap-1"
          >
            {editable ? (
              <Popover
                open={assigning}
                onOpenChange={setAssigning}
                label={t("tasks.assignee")}
                trigger={
                  <button type="button" className="ph-inline-button">
                    {assignee ? (
                      <Avatar name={assigneeName ?? "?"} size="sm" decorative />
                    ) : (
                      <UserRound aria-hidden="true" className="size-icon-sm" />
                    )}
                    {assignee ? (assigneeName ?? t("editor.mention.unknown")) : t("tasks.assign")}
                  </button>
                }
              >
                <div className="flex w-field max-w-full flex-col gap-2 p-1">
                  <Combobox
                    aria-label={t("tasks.assignee")}
                    placeholder={t("tasks.searchPerson")}
                    value={assignee}
                    load={peopleLoader}
                    onValueChange={(value, item) => void assign(value, item?.label ?? null)}
                  />
                  {assignee ? (
                    <Button variant="secondary" size="sm" icon={X} onClick={() => void assign(null, null)}>
                      {t("tasks.removeAssignee")}
                    </Button>
                  ) : null}
                </div>
              </Popover>
            ) : assignee ? (
              <span className="ph-task-assignee">@{assigneeName ?? t("editor.mention.unknown")}</span>
            ) : null}
            {editable ? (
              <Popover
                open={dating}
                onOpenChange={setDating}
                label={t("tasks.dueDate")}
                trigger={
                  <button type="button" className="ph-inline-button">
                    <CalendarDays aria-hidden="true" className="size-icon-sm" />
                    {dueDate
                      ? t("tasks.dueOn", { date: format.date(`${dueDate}T12:00:00Z`) })
                      : t("tasks.setDueDate")}
                  </button>
                }
              >
                <div className="flex w-field max-w-full flex-col gap-2 p-1">
                  <Field label={t("tasks.dueDate")}>
                    <Input
                      type="date"
                      value={dueDate ?? ""}
                      onChange={(event) => updateAttributes({ dueDate: event.target.value || null })}
                    />
                  </Field>
                  {dueDate ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={X}
                      onClick={() => {
                        updateAttributes({ dueDate: null });
                        setDating(false);
                      }}
                    >
                      {t("tasks.removeDueDate")}
                    </Button>
                  ) : null}
                </div>
              </Popover>
            ) : dueDate ? (
              <time className="ph-task-due" dateTime={dueDate}>
                {t("tasks.dueOn", { date: format.date(`${dueDate}T12:00:00Z`) })}
              </time>
            ) : null}
          </div>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}
