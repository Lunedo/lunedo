import {
  Button,
  Combobox,
  type ComboboxItem,
  Dialog,
  Field,
  Input,
  RadioGroup,
  Textarea,
  useToast,
} from "@lunedo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { peopleLoaderFor } from "../collaboration/people.js";
import { problemMessage } from "../errors/problem-message.js";
import { meetingKeys } from "./queries.js";

export function TopicDialog({
  seriesId,
  seriesTitle,
  meetingId,
  open,
  onOpenChange,
}: {
  seriesId: string;
  seriesTitle?: string | null;
  meetingId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const ownerLoader = useMemo(() => peopleLoaderFor({ seriesId }), [seriesId]);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const titleInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState<ComboboxItem | null>(null);
  const [duration, setDuration] = useState<"running" | "oneOff">("running");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState<"close" | "more" | null>(null);

  const reset = () => {
    setTitle("");
    setDescription("");
    setOwner(null);
    setDuration("running");
    setProblem(null);
  };

  const submit = async (more: boolean) => {
    if (saving) return;
    if (!title.trim()) {
      setProblem(t("meetings.agenda.titleRequired"));
      titleInput.current?.focus();
      return;
    }
    setSaving(more ? "more" : "close");
    try {
      await request(() =>
        api.POST("/api/v1/meeting-series/{seriesId}/topics", {
          params: { path: { seriesId } },
          body: {
            title: title.trim(),
            ...(description.trim() ? { description: description.trim() } : {}),
            ...(owner ? { ownerId: owner.value } : {}),
            ...(meetingId ? { meetingId, oneOff: duration === "oneOff" } : {}),
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: meetingKeys.all });
      toast({
        variant: "success",
        title:
          duration === "oneOff"
            ? t("meetings.agenda.oneOffAdded")
            : t("meetings.topicDialog.added", { title: title.trim() }),
      });
      reset();
      if (more) titleInput.current?.focus();
      else onOpenChange(false);
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.topics.addFailed"),
        description: problemMessage(t, failure),
      });
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={t("meetings.topicDialog.title")}
      description={
        seriesTitle
          ? t("meetings.topicDialog.description", { series: seriesTitle })
          : t("meetings.topics.addDescription")
      }
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="secondary" loading={saving === "more"} onClick={() => void submit(true)}>
            {t("meetings.topicDialog.addAnother")}
          </Button>
          <Button variant="primary" loading={saving === "close"} onClick={() => void submit(false)}>
            {t("meetings.agenda.add")}
          </Button>
        </>
      }
    >
      <form
        aria-label={t("meetings.topicDialog.title")}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(false);
        }}
      >
        <Field label={t("meetings.topics.titleLabel")} error={problem}>
          <Input
            ref={titleInput}
            autoFocus
            value={title}
            maxLength={255}
            placeholder={t("meetings.topicDialog.titlePlaceholder")}
            onChange={(event) => {
              setTitle(event.target.value);
              setProblem(null);
            }}
          />
        </Field>
        <Field label={t("meetings.topicDialog.about")} hint={t("meetings.topicDialog.aboutHint")}>
          <Textarea
            value={description}
            rows={3}
            placeholder={t("meetings.topicDialog.aboutPlaceholder")}
            onChange={(event) => setDescription(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submit(false);
              }
            }}
          />
        </Field>
        <Field label={t("meetings.topics.owner")} hint={t("meetings.topicDialog.ownerHint")}>
          <Combobox
            load={ownerLoader}
            value={owner?.value ?? null}
            selectedItem={owner}
            placeholder={t("meetings.topicDialog.ownerPlaceholder")}
            onValueChange={(_value, item) => setOwner(item)}
          />
        </Field>
        {meetingId ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-medium">{t("meetings.topicDialog.duration")}</legend>
            <RadioGroup
              label={t("meetings.topicDialog.duration")}
              variant="card"
              value={duration}
              onValueChange={(value) => setDuration(value as "running" | "oneOff")}
              options={[
                {
                  value: "running",
                  label: t("meetings.agenda.running"),
                  description: t("meetings.topicDialog.runningHint"),
                },
                {
                  value: "oneOff",
                  label: t("meetings.topicDialog.oneOff"),
                  description: t("meetings.topicDialog.oneOffHint"),
                },
              ]}
            />
          </fieldset>
        ) : null}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
