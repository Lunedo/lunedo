import {
  Button,
  DangerAction,
  DangerZone,
  Field,
  focusFirstInvalidSoon,
  Input,
  Notice,
  RadioGroup,
  Section,
  Skeleton,
  Textarea,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { Eye, Megaphone, Save, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { instantToZoned, zonedToInstant } from "../../format/zoned.js";
import { completeWebAddress, isWebAddress } from "../../forms/addresses.js";
import { serverFieldErrors } from "../../forms/use-schema-form.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { AnnouncementBanner, announcementKeys } from "../../shell/announcement-banners.js";

export const TEXT_MAX = 300;
export const LINK_LABEL_MAX = 60;
const DAY = 86_400_000;

type Severity = "information" | "warning";

interface Saved {
  severity: Severity;
  text: string;
  link: { url: string; label: string } | null;
  startsAt: string;
  endsAt: string;
  updatedAt: string;
  updatedBy: { id: string; name: string | null } | null;
}

interface Draft {
  severity: Severity;
  text: string;
  linkUrl: string;
  linkLabel: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

type Errors = Partial<Record<"text" | "linkUrl" | "linkLabel" | "start" | "end", string>>;

const SERVER_FIELDS: Record<string, keyof Errors> = {
  text: "text",
  "link.url": "linkUrl",
  "link.label": "linkLabel",
  startsAt: "start",
  endsAt: "end",
};

function draftOf(saved: Saved | null, timeZone: string): Draft {
  if (!saved) {
    const end = instantToZoned(new Date(Date.now() + 7 * DAY), timeZone);
    return {
      severity: "information",
      text: "",
      linkUrl: "",
      linkLabel: "",
      startDate: "",
      startTime: "",
      endDate: end.date,
      endTime: "18:00",
    };
  }
  const start = instantToZoned(saved.startsAt, timeZone);
  const end = instantToZoned(saved.endsAt, timeZone);
  return {
    severity: saved.severity,
    text: saved.text,
    linkUrl: saved.link?.url ?? "",
    linkLabel: saved.link?.label ?? "",
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
  };
}

export function validateAnnouncement(
  draft: Draft,
  timeZone: string,
  now: number,
  t: TFunction,
): { errors: Errors; startsAt: Date | null; endsAt: Date | null } {
  const errors: Errors = {};
  const text = draft.text.replace(/\s+/g, " ").trim();
  if (text.length === 0) errors.text = t("announcements.textRequired");
  else if (text.length > TEXT_MAX) errors.text = t("announcements.textTooLong", { max: TEXT_MAX });
  const url = completeWebAddress(draft.linkUrl);
  const label = draft.linkLabel.trim();
  if (url && !isWebAddress(url)) errors.linkUrl = t("announcements.linkInvalid");
  if (label && !url) errors.linkUrl = t("announcements.linkMissing");
  if (url && !label) errors.linkLabel = t("announcements.linkLabelMissing");
  if (label.length > LINK_LABEL_MAX)
    errors.linkLabel = t("announcements.linkLabelTooLong", { max: LINK_LABEL_MAX });
  const startsAt =
    draft.startDate || draft.startTime
      ? zonedToInstant(draft.startDate, draft.startTime || "00:00", timeZone)
      : null;
  if ((draft.startDate || draft.startTime) && !startsAt) errors.start = t("announcements.dateInvalid");
  const endsAt = zonedToInstant(draft.endDate, draft.endTime, timeZone);
  if (!endsAt) errors.end = t("announcements.endRequired");
  else if (endsAt.getTime() <= now) errors.end = t("announcements.endInPast");
  else if (startsAt && endsAt.getTime() <= startsAt.getTime()) errors.end = t("announcements.endBeforeStart");
  return { errors, startsAt, endsAt };
}

export function AnnouncementSettings({
  level,
  organizationId,
  organizationName,
  editable,
}: {
  level: "instance" | "organization";
  organizationId?: string | undefined;
  organizationName?: string | undefined;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const timeZone = format.settings.timeZone;
  const queryKey = ["announcement", level, organizationId ?? null] as const;
  const current = useQuery({
    queryKey,
    throwOnError: false,
    queryFn: async () => {
      const result =
        level === "organization" && organizationId
          ? await request(() =>
              api.GET("/api/v1/organizations/{organizationId}/announcement", {
                params: { path: { organizationId } },
              }),
            )
          : await request(() => api.GET("/api/v1/instance/announcement"));
      return result.announcement;
    },
  });
  if (current.isPending) return <Skeleton className="h-field w-full" />;
  if (current.isError) {
    return (
      <LoadError
        what={t("announcements.loadFailed")}
        error={current.error}
        onRetry={() => current.refetch()}
      />
    );
  }
  return (
    <AnnouncementForm
      key={current.data?.updatedAt ?? "none"}
      level={level}
      organizationId={organizationId}
      source={level === "instance" ? t("announcements.fromInstance") : (organizationName ?? "")}
      saved={current.data}
      queryKey={queryKey}
      editable={editable}
      timeZone={timeZone}
    />
  );
}

function AnnouncementForm({
  level,
  organizationId,
  source,
  saved,
  queryKey,
  editable,
  timeZone,
}: {
  level: "instance" | "organization";
  organizationId?: string | undefined;
  source: string;
  saved: Saved | null;
  queryKey: readonly unknown[];
  editable: boolean;
  timeZone: string;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved, timeZone));
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  const update = (changes: Partial<Draft>) => {
    const next = { ...draft, ...changes };
    setDraft(next);
    if (Object.keys(errors).length > 0) {
      const checked = validateAnnouncement(next, timeZone, Date.now(), t).errors;
      setErrors(Object.fromEntries(Object.entries(checked).filter(([key]) => key in errors)) as Errors);
    }
    setFailure(null);
  };

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.invalidateQueries({ queryKey: announcementKeys.shown });
  };

  const put = (body: {
    severity: Severity;
    text: string;
    link: { url: string; label: string } | null;
    startsAt: string | null;
    endsAt: string;
  }) =>
    level === "organization" && organizationId
      ? request(() =>
          api.PUT("/api/v1/organizations/{organizationId}/announcement", {
            params: { path: { organizationId } },
            body,
          }),
        )
      : request(() => api.PUT("/api/v1/instance/announcement", { body }));

  const save = async () => {
    const checked = validateAnnouncement(draft, timeZone, Date.now(), t);
    setErrors(checked.errors);
    if (Object.keys(checked.errors).length > 0 || !checked.endsAt) {
      focusFirstInvalidSoon(form.current ?? undefined);
      return;
    }
    setBusy(true);
    try {
      await put({
        severity: draft.severity,
        text: draft.text.trim(),
        link: draft.linkUrl.trim()
          ? { url: completeWebAddress(draft.linkUrl), label: draft.linkLabel.trim() }
          : null,
        startsAt: checked.startsAt?.toISOString() ?? null,
        endsAt: checked.endsAt.toISOString(),
      });
      toast({ variant: "success", title: t("announcements.saved") });
      await refresh();
    } catch (error) {
      const fields = Object.entries(serverFieldErrors(t, error)).flatMap(([path, message]) => {
        const field = SERVER_FIELDS[path];
        return field ? [[field, message] as const] : [];
      });
      if (fields.length > 0) {
        setErrors(Object.fromEntries(fields));
        focusFirstInvalidSoon(form.current ?? undefined);
      } else {
        setFailure(problemMessage(t, error));
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!saved) return;
    setBusy(true);
    try {
      if (level === "organization" && organizationId) {
        await request(() =>
          api.DELETE("/api/v1/organizations/{organizationId}/announcement", {
            params: { path: { organizationId } },
          }),
        );
      } else {
        await request(() => api.DELETE("/api/v1/instance/announcement"));
      }
      await refresh();
      const restorable = Date.parse(saved.endsAt) > Date.now();
      toast({
        title: t("announcements.removed"),
        ...(restorable
          ? {
              undo: {
                onUndo: () => {
                  void put({
                    severity: saved.severity,
                    text: saved.text,
                    link: saved.link,
                    startsAt: saved.startsAt,
                    endsAt: saved.endsAt,
                  })
                    .catch((error: unknown) =>
                      toast({
                        variant: "error",
                        title: t("announcements.restoreFailed"),
                        description: problemMessage(t, error),
                      }),
                    )
                    .finally(() => void refresh());
                },
              },
            }
          : {}),
      });
    } catch (error) {
      toast({
        variant: "error",
        title: t("announcements.removeFailed"),
        description: problemMessage(t, error),
      });
    } finally {
      setBusy(false);
    }
  };

  const now = Date.now();
  const status = !saved
    ? t("announcements.statusNone")
    : Date.parse(saved.endsAt) <= now
      ? t("announcements.statusEnded", { date: format.dateTime(saved.endsAt) })
      : Date.parse(saved.startsAt) > now
        ? t("announcements.statusScheduled", {
            start: format.dateTime(saved.startsAt),
            end: format.dateTime(saved.endsAt),
          })
        : t("announcements.statusShown", { date: format.dateTime(saved.endsAt) });

  const previewText = draft.text.replace(/\s+/g, " ").trim();
  const previewLink =
    draft.linkUrl.trim() && draft.linkLabel.trim()
      ? { url: draft.linkUrl.trim(), label: draft.linkLabel.trim() }
      : null;

  return (
    <>
      <Notice variant={saved && Date.parse(saved.endsAt) > now ? "success" : "info"} title={status}>
        {saved?.updatedBy
          ? t("announcements.changedBy", {
              name: saved.updatedBy.name ?? t("common.unknown"),
              date: format.dateTime(saved.updatedAt),
            })
          : t("announcements.order")}
      </Notice>
      <Section title={t("announcements.banner")} icon={Megaphone}>
        <form
          ref={form}
          noValidate
          className="flex flex-col gap-5 px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (editable) void save();
          }}
        >
          <fieldset className="flex flex-col gap-2" disabled={!editable}>
            <legend className="mb-2 font-medium">{t("announcements.severity")}</legend>
            <RadioGroup
              label={t("announcements.severity")}
              value={draft.severity}
              onValueChange={(value) => update({ severity: value as Severity })}
              options={[
                {
                  value: "information",
                  label: t("announcements.information"),
                  description: t("announcements.informationHint"),
                },
                {
                  value: "warning",
                  label: t("announcements.warning"),
                  description: t("announcements.warningHint"),
                },
              ]}
            />
          </fieldset>
          <Field
            label={t("announcements.text")}
            hint={t("announcements.textHint", { count: previewText.length, max: TEXT_MAX })}
            error={errors.text}
            required
          >
            <Textarea
              rows={3}
              value={draft.text}
              readOnly={!editable}
              placeholder={t("announcements.textExample")}
              onChange={(event) => update({ text: event.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("announcements.linkUrl")}
              hint={t("announcements.linkUrlHint")}
              error={errors.linkUrl}
            >
              <Input
                type="url"
                inputMode="url"
                value={draft.linkUrl}
                readOnly={!editable}
                onChange={(event) => update({ linkUrl: event.target.value })}
                onBlur={() => {
                  if (editable) update({ linkUrl: completeWebAddress(draft.linkUrl) });
                }}
              />
            </Field>
            <Field label={t("announcements.linkLabel")} error={errors.linkLabel}>
              <Input
                value={draft.linkLabel}
                readOnly={!editable}
                placeholder={t("announcements.linkLabelExample")}
                onChange={(event) => update({ linkLabel: event.target.value })}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("announcements.start")}
              hint={t("announcements.startHint", { timeZone })}
              error={errors.start}
            >
              <div className="flex flex-wrap gap-2">
                <Input
                  type="date"
                  aria-label={t("announcements.startDate")}
                  value={draft.startDate}
                  readOnly={!editable}
                  onChange={(event) => update({ startDate: event.target.value })}
                />
                <Input
                  type="time"
                  aria-label={t("announcements.startTime")}
                  value={draft.startTime}
                  readOnly={!editable}
                  onChange={(event) => update({ startTime: event.target.value })}
                />
              </div>
            </Field>
            <Field
              label={t("announcements.end")}
              hint={t("announcements.endHint", { timeZone })}
              error={errors.end}
              required
            >
              <div className="flex flex-wrap gap-2">
                <Input
                  type="date"
                  aria-label={t("announcements.endDate")}
                  value={draft.endDate}
                  readOnly={!editable}
                  onChange={(event) => update({ endDate: event.target.value })}
                />
                <Input
                  type="time"
                  aria-label={t("announcements.endTime")}
                  value={draft.endTime}
                  readOnly={!editable}
                  onChange={(event) => update({ endTime: event.target.value })}
                />
              </div>
            </Field>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 font-medium">
              <Eye aria-hidden className="size-icon text-text-muted" />
              {t("announcements.preview")}
            </h3>
            <div className="overflow-hidden rounded-md border border-border">
              <AnnouncementBanner
                announcement={{
                  scope: level,
                  severity: draft.severity,
                  text: previewText || t("announcements.textExample"),
                  link: previewLink,
                }}
                source={source}
              />
            </div>
            <p className="text-sm text-text-muted">
              {draft.severity === "warning"
                ? t("announcements.previewWarning")
                : t("announcements.previewInformation")}
            </p>
          </div>
          {failure ? (
            <Notice variant="danger" title={t("announcements.saveFailed")}>
              {failure}
            </Notice>
          ) : null}
          {editable ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setDraft(draftOf(saved, timeZone));
                  setErrors({});
                  setFailure(null);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary" icon={Save} loading={busy}>
                {saved ? t("announcements.saveChanges") : t("announcements.publish")}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-text-muted">{t("announcements.readOnly")}</p>
          )}
        </form>
      </Section>
      {editable && saved ? (
        <DangerZone title={t("common.dangerZone")}>
          <DangerAction
            title={t("announcements.removeTitle")}
            description={t("announcements.removeDescription")}
            action={
              <Button variant="danger" icon={Trash2} loading={busy} onClick={() => void remove()}>
                {t("announcements.remove")}
              </Button>
            }
          />
        </DangerZone>
      ) : null}
    </>
  );
}
