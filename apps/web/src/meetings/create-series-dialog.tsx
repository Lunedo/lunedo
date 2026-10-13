import { Button, Combobox, type ComboboxItem, Dialog, Field, Input, Select, useToast } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { peopleLoader } from "../collaboration/people.js";
import { problemMessage } from "../errors/problem-message.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useSession } from "../shell/shell-context.js";
import { spaceDisplayName } from "../spaces/space-badge.js";
import type { SpaceWithRole } from "../spaces/space-queries.js";
import { meetingKeys, seriesPath } from "./queries.js";
import { choiceOf, type Rhythm } from "./rhythm.js";
import {
  defaultSchedule,
  type ScheduleErrors,
  ScheduleFields,
  type ScheduleValue,
  scheduleBody,
  validateSchedule,
} from "./schedule-fields.js";

const NAME_MAX = 200;

export function CreateSeriesDialog({
  space,
  open,
  onOpenChange,
  initialTemplateId,
}: {
  space: SpaceWithRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTemplateId?: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const format = useFormat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  const self = session.account;
  const [name, setName] = useState("");
  const [members, setMembers] = useState<ComboboxItem[]>([]);
  const [templateId, setTemplateId] = useState(initialTemplateId ?? "builtin:team-meeting");
  const [schedule, setSchedule] = useState<ScheduleValue>(() => defaultSchedule(format.settings.timeZone));
  const [errors, setErrors] = useState<ScheduleErrors & { name?: string }>({});
  const [busy, setBusy] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const templates = useQuery({
    queryKey: ["templates", "gallery", space.id],
    enabled: open,
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/template-gallery", { params: { path: { spaceId: space.id } } }),
      ),
  });
  const seriesTemplates = (templates.data ?? []).filter((template) => template.series !== null);

  useEffect(() => {
    if (open && self && members.length === 0) {
      setMembers([{ value: self.id, label: self.name }]);
    }
  }, [open, self, members.length]);

  const chooseTemplate = (id: string) => {
    setTemplateId(id);
    const defaults = seriesTemplates.find((template) => template.id === id)?.series;
    if (defaults) {
      setSchedule((current) => ({
        ...current,
        choice: choiceOf(defaults.rhythm as Rhythm),
        durationMinutes: String(defaults.durationMinutes),
      }));
    }
  };

  const create = async () => {
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
      const created = await request(() =>
        api.POST("/api/v1/spaces/{spaceId}/meeting-series", {
          params: { path: { spaceId: space.id } },
          body: {
            name: name.trim(),
            parentId: null,
            members: members.map((member) => member.value),
            templateId,
            ...scheduleBody(schedule),
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: meetingKeys.all });
      await queryClient.invalidateQueries({ queryKey: ["spaces", space.id, "children"] });
      toast({ variant: "success", title: t("meetings.create.created", { name: created.title }) });
      onOpenChange(false);
      setName("");
      await navigate({ to: seriesPath(space.key, created.id) });
    } catch (error) {
      toast({ variant: "error", title: t("meetings.create.failed"), description: problemMessage(t, error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t("meetings.create.title", { space: spaceDisplayName(t, space) })}
      description={t("meetings.create.description")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void create()}>
            {t("meetings.create.submit")}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Field label={t("meetings.create.name")} error={errors.name} required>
          <Input
            ref={nameInput}
            value={name}
            placeholder={t("meetings.create.nameExample")}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label={t("meetings.create.template")} hint={t("meetings.create.templateHint")}>
          <Select
            value={templateId}
            onValueChange={chooseTemplate}
            options={
              seriesTemplates.length > 0
                ? seriesTemplates.map((template) => ({ value: template.id, label: template.name }))
                : [{ value: templateId, label: t("meetings.create.templateLoading") }]
            }
          />
        </Field>
        <Field label={t("meetings.create.members")} hint={t("meetings.create.membersHint")}>
          <Combobox
            multiple
            load={peopleLoader}
            value={members.map((member) => member.value)}
            selectedItems={members}
            placeholder={t("meetings.create.membersPlaceholder")}
            onValueChange={(_values, items) => setMembers(items)}
          />
        </Field>
        <ScheduleFields value={schedule} onChange={setSchedule} errors={errors} />
      </form>
    </Dialog>
  );
}
