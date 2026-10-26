import { Button, Combobox, type ComboboxItem, Dialog, Field, Input, Select, useToast } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { peopleLoaderFor } from "../collaboration/people.js";
import { problemMessage } from "../errors/problem-message.js";
import { meetingKeys, type Series } from "./queries.js";
import { choiceOf, type Rhythm } from "./rhythm.js";
import {
  type ScheduleErrors,
  ScheduleFields,
  type ScheduleValue,
  scheduleBody,
  validateSchedule,
} from "./schedule-fields.js";

const NAME_MAX = 200;
const REMINDERS = ["off", "oneDay", "twoDays", "oneWeek"] as const;
type Reminder = (typeof REMINDERS)[number];

function isReminder(value: string): value is Reminder {
  return (REMINDERS as readonly string[]).includes(value);
}

function scheduleOf(series: Series): ScheduleValue {
  return {
    choice: choiceOf(series.schedule.rhythm as Rhythm | null),
    startsOn: series.schedule.startsOn,
    startTime: series.schedule.startTime,
    timeZone: series.schedule.timeZone,
    durationMinutes: String(series.schedule.durationMinutes),
  };
}

export function SeriesSettingsDialog({
  series,
  open,
  onOpenChange,
}: {
  series: Series;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const membersLoader = useMemo(() => peopleLoaderFor({ spaceId: series.spaceId }), [series.spaceId]);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(series.title);
  const [members, setMembers] = useState<ComboboxItem[]>([]);
  const [templateId, setTemplateId] = useState(series.template.id);
  const [reminder, setReminder] = useState<Reminder>(
    isReminder(series.reminder) ? series.reminder : "oneDay",
  );
  const [schedule, setSchedule] = useState<ScheduleValue>(() => scheduleOf(series));
  const [errors, setErrors] = useState<ScheduleErrors & { name?: string }>({});
  const [busy, setBusy] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const templates = useQuery({
    queryKey: ["templates", "gallery", series.spaceId],
    enabled: open,
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/template-gallery", {
          params: { path: { spaceId: series.spaceId } },
        }),
      ),
  });

  useEffect(() => {
    if (!open) return;
    setName(series.title);
    setTemplateId(series.template.id);
    setReminder(isReminder(series.reminder) ? series.reminder : "oneDay");
    setSchedule(scheduleOf(series));
    setMembers(
      series.members.map((member) => ({
        value: member.id,
        label: member.name ?? t("meetings.unknownPerson"),
      })),
    );
    setErrors({});
  }, [open, series, t]);

  const save = async () => {
    const next: ScheduleErrors & { name?: string } = validateSchedule(t, schedule);
    if (name.trim().length === 0) next.name = t("meetings.create.nameRequired", { max: NAME_MAX });
    else if (name.trim().length > NAME_MAX) next.name = t("meetings.create.nameInvalid", { max: NAME_MAX });
    setErrors(next);
    if (Object.keys(next).length > 0) {
      if (next.name) nameInput.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const before = scheduleOf(series);
      const scheduleChanged = JSON.stringify(scheduleBody(before)) !== JSON.stringify(scheduleBody(schedule));
      await request(() =>
        api.PATCH("/api/v1/meeting-series/{seriesId}", {
          params: { path: { seriesId: series.id } },
          body: {
            name: name.trim(),
            members: members.map((member) => member.value),
            templateId,
            reminder,
            ...(scheduleChanged ? { schedule: scheduleBody(schedule) } : {}),
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: meetingKeys.all });
      toast({ variant: "success", title: t("meetings.settings.saved") });
      onOpenChange(false);
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.settings.failed"),
        description: problemMessage(t, failure),
      });
    } finally {
      setBusy(false);
    }
  };

  const seriesTemplates = (templates.data ?? []).filter((template) => template.series !== null);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t("meetings.settings.title", { name: series.title })}
      description={t("meetings.settings.description")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {t("meetings.settings.save")}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label={t("meetings.create.name")} error={errors.name} required>
          <Input ref={nameInput} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={t("meetings.create.members")} hint={t("meetings.create.membersHint")}>
          <Combobox
            multiple
            load={membersLoader}
            value={members.map((member) => member.value)}
            selectedItems={members}
            onValueChange={(_values, items) => setMembers(items)}
          />
        </Field>
        <Field label={t("meetings.create.template")} hint={t("meetings.settings.templateHint")}>
          <Select
            value={templateId}
            onValueChange={setTemplateId}
            options={
              seriesTemplates.some((template) => template.id === templateId)
                ? seriesTemplates.map((template) => ({ value: template.id, label: template.name }))
                : [
                    {
                      value: templateId,
                      label: series.template.name ?? t("meetings.settings.templateMissing"),
                    },
                    ...seriesTemplates.map((template) => ({ value: template.id, label: template.name })),
                  ]
            }
          />
        </Field>
        <Field label={t("meetings.reminder.label")} hint={t("meetings.reminder.hint")}>
          <Select
            value={reminder}
            onValueChange={(value) => {
              if (isReminder(value)) setReminder(value);
            }}
            options={REMINDERS.map((value) => ({ value, label: t(`meetings.reminder.${value}`) }))}
          />
        </Field>
        <ScheduleFields
          value={schedule}
          onChange={setSchedule}
          errors={errors}
          firstMeetingLabel={t("meetings.settings.fromDate")}
        />
        <p className="text-sm text-text-muted">{t("meetings.settings.scheduleNote")}</p>
      </form>
    </Dialog>
  );
}
