import { Button, Checkbox, Dialog, Field, useToast } from "@lunedo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { AppDatePicker, AppTimePicker } from "../components/date-fields.js";
import { problemMessage } from "../errors/problem-message.js";
import { instantInZone, localDateInZone, localTimeInZone } from "../format/zoned.js";
import { translateKey } from "../i18n/translate.js";
import { meetingKeys } from "./queries.js";

export const CLOSE_UNDO_SECONDS = 5;

export interface MeetingTarget {
  id: string;
  title: string;
  timeZone: string;
  rhythm: boolean;
  startsAt: string | null;
}

export function useMeetingRefresh() {
  const queryClient = useQueryClient();
  return async (meetingId?: string) => {
    await queryClient.invalidateQueries({ queryKey: meetingKeys.all });
    await queryClient.invalidateQueries({ queryKey: ["spaces"] });
    if (meetingId) await queryClient.invalidateQueries({ queryKey: ["items", meetingId] });
  };
}

export function useCloseMeeting() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const refresh = useMeetingRefresh();
  return async (meeting: MeetingTarget, nextStartsAt?: string | null) => {
    try {
      await request(() =>
        api.POST("/api/v1/meetings/{meetingId}/close", {
          params: { path: { meetingId: meeting.id } },
          body: nextStartsAt === undefined ? {} : { nextStartsAt },
        }),
      );
      await refresh(meeting.id);
      toast({
        variant: "success",
        title: t("meetings.close.done", { title: meeting.title }),
        description: t("meetings.close.doneDescription"),
        undo: {
          seconds: CLOSE_UNDO_SECONDS,
          onUndo: () =>
            void request(() =>
              api.POST("/api/v1/meetings/{meetingId}/close/undo", {
                params: { path: { meetingId: meeting.id } },
              }),
            )
              .then(() => refresh(meeting.id))
              .catch((failure: unknown) =>
                toast({
                  variant: "error",
                  title: t("meetings.close.undoFailed"),
                  description: problemMessage(t, failure),
                }),
              ),
        },
      });
      return true;
    } catch (failure) {
      toast({ variant: "error", title: t("meetings.close.failed"), description: problemMessage(t, failure) });
      return false;
    }
  };
}

export function useReopenMeeting() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const refresh = useMeetingRefresh();
  return async (meeting: MeetingTarget) => {
    try {
      await request(() =>
        api.POST("/api/v1/meetings/{meetingId}/reopen", { params: { path: { meetingId: meeting.id } } }),
      );
      await refresh(meeting.id);
      toast({ variant: "success", title: t("meetings.reopen.done", { title: meeting.title }) });
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.reopen.failed"),
        description: problemMessage(t, failure),
      });
    }
  };
}

type DateDialogPurpose = "close" | "skip";

export function MeetingDateDialog({
  meeting,
  purpose,
  open,
  onOpenChange,
}: {
  meeting: MeetingTarget;
  purpose: DateDialogPurpose;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const refresh = useMeetingRefresh();
  const close = useCloseMeeting();
  const initial = meeting.startsAt ? new Date(meeting.startsAt) : new Date(Date.now() + 7 * 86_400_000);
  const [date, setDate] = useState(() => localDateInZone(initial, meeting.timeZone));
  const [time, setTime] = useState(() => localTimeInZone(initial, meeting.timeZone));
  const [unscheduled, setUnscheduled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dateInput = useRef<HTMLButtonElement>(null);
  const needsDate = !meeting.rhythm;
  const allowUnscheduled = !meeting.rhythm;

  const submit = async () => {
    let startsAt: string | null = null;
    if (needsDate && !(allowUnscheduled && unscheduled)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
        setError(t("meetings.schedule.dateRequired"));
        dateInput.current?.focus();
        return;
      }
      startsAt = instantInZone(date, time, meeting.timeZone).toISOString();
    }
    setBusy(true);
    try {
      if (purpose === "close") {
        if (await close(meeting, needsDate ? startsAt : undefined)) onOpenChange(false);
        return;
      }
      await request(() =>
        api.POST("/api/v1/meetings/{meetingId}/skip", {
          params: { path: { meetingId: meeting.id } },
          body: needsDate ? { nextStartsAt: startsAt } : {},
        }),
      );
      toast({ variant: "success", title: t("meetings.skip.done", { title: meeting.title }) });
      await refresh(meeting.id);
      onOpenChange(false);
    } catch (failure) {
      toast({
        variant: "error",
        title: translateKey(t, `meetings.${purpose}.failed`),
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
      title={translateKey(t, `meetings.${purpose}.title`)}
      description={translateKey(t, `meetings.${purpose}.description${needsDate ? "" : "WithRhythm"}`, {
        timeZone: meeting.timeZone,
      })}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {translateKey(t, `meetings.${purpose}.confirm`)}
          </Button>
        </>
      }
    >
      {needsDate ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("meetings.schedule.date")} error={error ?? undefined}>
              <AppDatePicker
                ref={dateInput}
                value={date}
                disabled={unscheduled}
                onValueChange={(next) => {
                  setDate(next);
                  setError(null);
                }}
              />
            </Field>
            <Field label={t("meetings.schedule.time")}>
              <AppTimePicker value={time} disabled={unscheduled} onValueChange={setTime} />
            </Field>
          </div>
          {allowUnscheduled ? (
            <Checkbox
              label={t("meetings.notScheduledChoice")}
              description={t("meetings.notScheduledHint")}
              checked={unscheduled}
              onCheckedChange={setUnscheduled}
            />
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
