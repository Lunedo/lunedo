import { Button, Checkbox, Combobox, type ComboboxItem, Input, useToast } from "@lunedo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { peopleLoader } from "../collaboration/people.js";
import { problemMessage } from "../errors/problem-message.js";
import { meetingKeys } from "./queries.js";

export function TopicForm({
  seriesId,
  meetingId,
  onDone,
}: {
  seriesId: string;
  meetingId?: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const titleId = useId();
  const titleInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState<ComboboxItem | null>(null);
  const [running, setRunning] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!title.trim()) {
      setProblem(t("meetings.agenda.titleRequired"));
      titleInput.current?.focus();
      return;
    }
    setSaving(true);
    try {
      await request(() =>
        api.POST("/api/v1/meeting-series/{seriesId}/topics", {
          params: { path: { seriesId } },
          body: {
            title: title.trim(),
            ...(owner ? { ownerId: owner.value } : {}),
            ...(meetingId ? { meetingId, oneOff: !running } : {}),
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: meetingKeys.all });
      toast({
        variant: "success",
        title: running ? t("meetings.agenda.topicAdded") : t("meetings.agenda.oneOffAdded"),
      });
      onDone();
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.topics.addFailed"),
        description: problemMessage(t, failure),
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      aria-label={t("meetings.topics.addTitle")}
      className="flex flex-wrap items-center gap-2 rounded-md bg-surface-sunken p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDone();
      }}
    >
      <div className="flex min-w-0 flex-1 basis-field flex-col gap-1">
        <Input
          ref={titleInput}
          id={titleId}
          autoFocus
          value={title}
          aria-label={t("meetings.topics.titleLabel")}
          placeholder={t("meetings.agenda.titlePlaceholder")}
          invalid={problem !== null}
          onChange={(event) => {
            setTitle(event.target.value);
            setProblem(null);
          }}
        />
        {problem ? <span className="text-sm text-danger">{problem}</span> : null}
      </div>
      <div className="w-field max-w-full">
        <Combobox
          load={peopleLoader}
          value={owner?.value ?? null}
          selectedItem={owner}
          placeholder={t("meetings.agenda.ownerPlaceholder")}
          aria-label={t("meetings.topics.owner")}
          onValueChange={(_value, item) => setOwner(item)}
        />
      </div>
      {meetingId ? (
        <Checkbox
          checked={running}
          onCheckedChange={setRunning}
          label={t("meetings.agenda.running")}
          description={t("meetings.agenda.runningHint")}
        />
      ) : null}
      <Button type="submit" variant="primary" size="sm" loading={saving}>
        {t("meetings.agenda.add")}
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={onDone}>
        {t("common.cancel")}
      </Button>
    </form>
  );
}
