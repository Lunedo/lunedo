import {
  Avatar,
  Button,
  Combobox,
  type ComboboxItem,
  Menu,
  Notice,
  Popover,
  Skeleton,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CalendarClock,
  CalendarX,
  Check,
  ChevronDown,
  MoreHorizontal,
  Repeat,
  RotateCcw,
  UserPlus,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { peopleLoader } from "../collaboration/people.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import {
  MeetingDateDialog,
  type MeetingTarget,
  useCloseMeeting,
  useReopenMeeting,
} from "./meeting-actions.js";
import { type Attendee, type Meeting, meetingKeys, meetingQuery, seriesPath } from "./queries.js";

const ATTENDANCE = ["present", "excused", "absent"] as const;

function targetOf(meeting: Meeting, fallbackTimeZone: string): MeetingTarget {
  return {
    id: meeting.id,
    title: meeting.title,
    timeZone: meeting.timeZone ?? fallbackTimeZone,
    rhythm: meeting.rhythm ?? false,
    startsAt: meeting.startsAt,
  };
}

export function MeetingHeader({
  meetingId,
  spaceKey,
  writable,
  onShare,
}: {
  meetingId: string;
  spaceKey: string;
  writable: boolean;
  onShare?: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const meeting = useQuery(meetingQuery(meetingId));
  const close = useCloseMeeting();
  const reopen = useReopenMeeting();
  const [dialog, setDialog] = useState<"close" | "skip" | "move" | null>(null);
  if (meeting.isPending) return <Skeleton className="h-field w-full" />;
  if (meeting.isError) {
    return (
      <LoadError
        what={t("meetings.meeting.loadFailed")}
        error={meeting.error}
        onRetry={() => meeting.refetch()}
      />
    );
  }
  const data = meeting.data;
  const target = targetOf(data, format.settings.timeZone);
  const end = data.startsAt
    ? new Date(new Date(data.startsAt).getTime() + data.durationMinutes * 60_000)
    : null;
  const closable = writable && data.current;
  const missingAccess = data.attendees.filter((attendee) => !attendee.canRead);
  return (
    <section
      aria-label={t("meetings.meeting.label")}
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 basis-field flex-col gap-1">
          {data.seriesId && data.seriesTitle ? (
            <Link
              to={seriesPath(spaceKey, data.seriesId)}
              className="inline-flex items-center gap-1 text-sm text-accent hover:underline focus-visible:focus-ring"
            >
              <Repeat aria-hidden className="size-icon" />
              {data.seriesTitle}
            </Link>
          ) : null}
          <p className="flex items-center gap-2 font-medium">
            <CalendarClock aria-hidden className="size-icon text-text-muted" />
            {data.startsAt && end
              ? t("meetings.meeting.when", { start: format.dateTime(data.startsAt), end: format.time(end) })
              : t("meetings.notScheduled")}
          </p>
          <p className="text-sm text-text-muted">{translateKey(t, `meetings.meeting.state.${data.state}`)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {writable && data.state === "upcoming" ? (
            <Menu
              trigger={
                <Button variant="secondary" icon={MoreHorizontal}>
                  {t("meetings.series.nextActions")}
                </Button>
              }
              items={[
                { label: t("meetings.move.action"), icon: CalendarClock, onSelect: () => setDialog("move") },
                { label: t("meetings.skip.action"), icon: CalendarX, onSelect: () => setDialog("skip") },
              ]}
            />
          ) : null}
          {writable && data.state === "closed" ? (
            <Button variant="secondary" icon={RotateCcw} onClick={() => void reopen(target)}>
              {t("meetings.reopen.action")}
            </Button>
          ) : null}
          {closable ? (
            <Button
              variant="primary"
              icon={Check}
              onClick={() =>
                data.rhythm || data.state === "reopened" ? void close(target) : setDialog("close")
              }
            >
              {t("meetings.close.action")}
            </Button>
          ) : null}
        </div>
      </div>
      <Attendees meeting={data} writable={writable} />
      {missingAccess.length > 0 && writable ? (
        <Notice
          variant="warning"
          title={t("meetings.meeting.noAccessTitle", { count: missingAccess.length })}
          action={
            onShare ? (
              <Button size="sm" variant="secondary" onClick={onShare}>
                {t("meetings.meeting.share")}
              </Button>
            ) : undefined
          }
        >
          {t("meetings.meeting.noAccess", {
            names: missingAccess.map((attendee) => attendee.name ?? t("meetings.unknownPerson")).join(", "),
          })}
        </Notice>
      ) : null}
      {dialog ? (
        <MeetingDateDialog
          meeting={target}
          purpose={dialog}
          open
          onOpenChange={(open) => !open && setDialog(null)}
        />
      ) : null}
    </section>
  );
}

function Attendees({ meeting, writable }: { meeting: Meeting; writable: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [guest, setGuest] = useState<ComboboxItem | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: meetingKeys.meeting(meeting.id) });
  const setAttendance = async (attendee: Attendee, attendance: (typeof ATTENDANCE)[number] | null) => {
    queryClient.setQueryData(meetingKeys.meeting(meeting.id), {
      ...meeting,
      attendees: meeting.attendees.map((entry) =>
        entry.id === attendee.id ? { ...entry, attendance } : entry,
      ),
    });
    try {
      await request(() =>
        api.PUT("/api/v1/meetings/{meetingId}/attendees/{accountId}", {
          params: { path: { meetingId: meeting.id, accountId: attendee.id } },
          body: { attendance },
        }),
      );
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.attendance.failed"),
        description: problemMessage(t, failure),
      });
    } finally {
      await refresh();
    }
  };
  const addGuest = async () => {
    if (!guest) return;
    try {
      await request(() =>
        api.POST("/api/v1/meetings/{meetingId}/attendees", {
          params: { path: { meetingId: meeting.id } },
          body: { accountId: guest.value },
        }),
      );
      setGuest(null);
      setAdding(false);
      await refresh();
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.attendance.addFailed"),
        description: problemMessage(t, failure),
      });
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-label text-text-muted uppercase">
        {t("meetings.attendance.title")}
      </h3>
      <ul className="flex flex-wrap gap-2">
        {meeting.attendees.map((attendee) => {
          const name = attendee.name ?? t("meetings.unknownPerson");
          const state = attendee.attendance
            ? translateKey(t, `meetings.attendance.${attendee.attendance}`)
            : t("meetings.attendance.unset");
          return (
            <li
              key={attendee.id}
              className="flex items-center gap-2 rounded-full border border-border py-1 pr-1 pl-1 text-sm"
            >
              <Avatar name={name} size="sm" decorative />
              <span className="max-w-card truncate" title={name}>
                {name}
              </span>
              {writable ? (
                <Menu
                  trigger={
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={t("meetings.attendance.change", { name, state })}
                    >
                      {state}
                      <ChevronDown aria-hidden className="size-icon" />
                    </Button>
                  }
                  items={[
                    ...ATTENDANCE.map((value) => ({
                      label: translateKey(t, `meetings.attendance.${value}`),
                      onSelect: () => void setAttendance(attendee, value),
                    })),
                    { type: "separator" as const },
                    {
                      label: t("meetings.attendance.clear"),
                      onSelect: () => void setAttendance(attendee, null),
                    },
                  ]}
                />
              ) : (
                <span className="pr-2 text-text-muted">{state}</span>
              )}
            </li>
          );
        })}
        {writable ? (
          <li>
            <Popover
              open={adding}
              onOpenChange={setAdding}
              label={t("meetings.attendance.add")}
              trigger={
                <Button size="sm" variant="secondary" icon={UserPlus}>
                  {t("meetings.attendance.add")}
                </Button>
              }
            >
              <form
                className="flex w-card max-w-full flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addGuest();
                }}
              >
                <Combobox
                  load={peopleLoader}
                  value={guest?.value ?? null}
                  selectedItem={guest}
                  aria-label={t("meetings.attendance.person")}
                  onValueChange={(_value, item) => setGuest(item)}
                />
                <Button type="submit" variant="primary">
                  {t("meetings.attendance.addConfirm")}
                </Button>
              </form>
            </Popover>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
