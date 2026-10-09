import { Button, Combobox, type ComboboxItem, Dialog, Field, Notice, Select, useToast } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { peopleLoader } from "../collaboration/people.js";
import { problemMessage } from "../errors/problem-message.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { meetingKeys } from "./queries.js";
import {
  defaultSchedule,
  type ScheduleErrors,
  ScheduleFields,
  type ScheduleValue,
  scheduleBody,
  validateSchedule,
} from "./schedule-fields.js";

export function OneOnOneDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const format = useFormat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [person, setPerson] = useState<ComboboxItem | null>(null);
  const [organizationId, setOrganizationId] = useState<string | undefined>(undefined);
  const [schedule, setSchedule] = useState<ScheduleValue>(() => ({
    ...defaultSchedule(format.settings.timeZone, "everyNWeeks"),
    durationMinutes: "30",
  }));
  const [errors, setErrors] = useState<ScheduleErrors & { person?: string; organization?: string }>({});
  const [busy, setBusy] = useState(false);
  const personRef = useRef<HTMLDivElement>(null);
  const organizations = useQuery({
    queryKey: ["meetings", "oneOnOneOrganizations", person?.value ?? ""],
    enabled: open && person !== null,
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/one-on-ones/organizations", {
          params: { query: { personId: person?.value ?? "" } },
        }),
      ),
  });
  const choices = organizations.data ?? [];
  const chosen =
    organizationId && choices.some((entry) => entry.id === organizationId) ? organizationId : choices[0]?.id;

  const create = async () => {
    const next: ScheduleErrors & { person?: string; organization?: string } = validateSchedule(t, schedule);
    if (!person) next.person = t("meetings.oneOnOne.personRequired");
    else if (!chosen) next.organization = t("meetings.oneOnOne.noOrganization");
    setErrors(next);
    if (Object.keys(next).length > 0) {
      if (next.person) personRef.current?.querySelector<HTMLElement>("input,button")?.focus();
      return;
    }
    setBusy(true);
    try {
      const created = await request(() =>
        api.POST("/api/v1/one-on-ones", {
          body: { otherId: person?.value ?? "", organizationId: chosen ?? "", ...scheduleBody(schedule) },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: meetingKeys.all });
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
      toast({ variant: "success", title: t("meetings.oneOnOne.created", { name: person?.label ?? "" }) });
      onOpenChange(false);
      setPerson(null);
      const space = await request(() =>
        api.GET("/api/v1/spaces/{spaceId}", { params: { path: { spaceId: created.spaceId } } }),
      );
      if (created.seriesId) await navigate({ to: `/spaces/${space.key}/meetings/${created.seriesId}` });
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.oneOnOne.failed"),
        description: problemMessage(t, failure),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t("meetings.oneOnOne.newTitle")}
      description={t("meetings.oneOnOne.newDescription")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void create()}>
            {t("meetings.oneOnOne.create")}
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
        <div ref={personRef}>
          <Field
            label={t("meetings.oneOnOne.person")}
            hint={t("meetings.oneOnOne.personHint")}
            error={errors.person}
            required
          >
            <Combobox
              load={peopleLoader}
              value={person?.value ?? null}
              selectedItem={person}
              placeholder={t("meetings.oneOnOne.personPlaceholder")}
              onValueChange={(_value, item) => {
                setPerson(item);
                setOrganizationId(undefined);
              }}
            />
          </Field>
        </div>
        {person && organizations.data && choices.length === 0 ? (
          <Notice variant="warning" title={t("meetings.oneOnOne.noOrganizationTitle")}>
            {t("meetings.oneOnOne.noOrganizationDescription", { name: person.label })}
          </Notice>
        ) : null}
        {choices.length > 1 ? (
          <Field
            label={t("meetings.oneOnOne.organization")}
            hint={t("meetings.oneOnOne.organizationHint")}
            error={errors.organization}
          >
            <Select
              value={chosen}
              onValueChange={setOrganizationId}
              options={choices.map((entry) => ({ value: entry.id, label: entry.name }))}
            />
          </Field>
        ) : null}
        {errors.organization && choices.length <= 1 ? (
          <p className="text-sm text-danger">{errors.organization}</p>
        ) : null}
        <ScheduleFields value={schedule} onChange={setSchedule} errors={errors} />
        <Notice variant="info" title={t("meetings.oneOnOne.privacyTitle")}>
          {t("meetings.oneOnOne.privacyDescription")}
        </Notice>
      </form>
    </Dialog>
  );
}
