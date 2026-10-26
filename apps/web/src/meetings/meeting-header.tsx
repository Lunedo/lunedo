import {
  Badge,
  Button,
  Combobox,
  type ComboboxItem,
  IconButton,
  Input,
  Menu,
  Notice,
  SegmentedControl,
  Select,
  Skeleton,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { CalendarClock, CalendarPlus, CalendarX, Check, ChevronDown, Plus, RotateCcw, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { peopleLoader } from "../collaboration/people.js";
import { AppDatePicker, AppTimePicker } from "../components/date-fields.js";
import { PersonAvatar } from "../components/person-avatar.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { instantInZone, localDateInZone, localTimeInZone } from "../format/zoned.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { itemSlug } from "../spaces/item-paths.js";
import { pagePath } from "../spaces/space-queries.js";
import { peopleWithoutAccess } from "./access.js";
import {
  MeetingDateDialog,
  type MeetingTarget,
  useCloseMeeting,
  useMeetingRefresh,
  useReopenMeeting,
} from "./meeting-actions.js";
import { type Meeting, meetingKeys, meetingQuery, meetingStateAccent, meetingStateLabel } from "./queries.js";

const ATTENDANCE = ["unset", "present", "excused", "absent"] as const;
type AttendanceChoice = (typeof ATTENDANCE)[number];

function targetOf(meeting: Meeting, fallbackTimeZone: string): MeetingTarget {
  return {
    id: meeting.id,
    title: meeting.title,
    timeZone: meeting.timeZone ?? fallbackTimeZone,
    rhythm: meeting.rhythm ?? false,
    startsAt: meeting.startsAt,
  };
}

const STATE_BADGE = {
  upcoming: "accent",
  reopened: "warning",
  closed: "neutral",
  skipped: "neutral",
} as const;

export function MeetingTitle({ meetingId, fallback }: { meetingId: string; fallback: string }) {
  const format = useFormat();
  const meeting = useQuery({ ...meetingQuery(meetingId), throwOnError: false });
  const data = meeting.data;
  if (!data?.seriesTitle || !data.startsAt) return <>{fallback}</>;
  return <>{`${data.seriesTitle} · ${format.weekdayDate(data.startsAt)}`}</>;
}

function AdjacentLink({
  meeting,
  spaceKey,
  label,
}: {
  meeting: NonNullable<Meeting["previousMeeting"]>;
  spaceKey: string;
  label: string;
}) {
  const format = useFormat();
  return (
    <span>
      {label}{" "}
      <Link
        to={pagePath(spaceKey, meeting.id, itemSlug(meeting.title))}
        className="text-accent underline focus-visible:focus-ring"
      >
        {meeting.startsAt ? format.calendarDate(meeting.startsAt) : meeting.title}
      </Link>
    </span>
  );
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
  const [dialog, setDialog] = useState<"close" | "skip" | null>(null);
  const [form, setForm] = useState<"move" | "extra" | null>(null);
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
  const missingAccess = peopleWithoutAccess(data.attendees);
  const notYet =
    data.startsAt !== null &&
    localDateInZone(new Date(data.startsAt), target.timeZone) > localDateInZone(new Date(), target.timeZone);
  const planning = writable && data.state === "upcoming";
  return (
    <section aria-label={t("meetings.meeting.label")} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge
          variant={
            data.state === "upcoming"
              ? meetingStateAccent(data, target.timeZone)
                ? "accent"
                : "neutral"
              : (STATE_BADGE[data.state as keyof typeof STATE_BADGE] ?? "neutral")
          }
        >
          {meetingStateLabel(t, data, target.timeZone)}
        </Badge>
        {data.extra ? <Badge variant="neutral">{t("meetings.meeting.extra")}</Badge> : null}
        <span className="text-text-muted">
          {data.startsAt && end
            ? t("meetings.meeting.when", {
                start: format.time(data.startsAt),
                end: format.time(end),
              })
            : t("meetings.notScheduled")}
        </span>
        {planning ? (
          <Menu
            align="start"
            trigger={
              <Button variant="secondary" icon={CalendarClock}>
                {t("meetings.meeting.date")}
                <ChevronDown aria-hidden="true" className="size-icon-sm" />
              </Button>
            }
            items={[
              { label: t("meetings.move.action"), icon: CalendarClock, onSelect: () => setForm("move") },
              ...(data.extra
                ? []
                : [{ label: t("meetings.skip.action"), icon: CalendarX, onSelect: () => setDialog("skip") }]),
              ...(data.seriesId
                ? [
                    {
                      label: t("meetings.extra.action"),
                      icon: CalendarPlus,
                      onSelect: () => setForm("extra"),
                    },
                  ]
                : []),
            ]}
          />
        ) : null}
        {data.previousMeeting || data.followingMeeting ? (
          <span className="flex flex-wrap gap-x-2 text-text-muted">
            {data.previousMeeting ? (
              <AdjacentLink
                meeting={data.previousMeeting}
                spaceKey={spaceKey}
                label={t("meetings.meeting.previous")}
              />
            ) : null}
            {data.previousMeeting && data.followingMeeting ? <span aria-hidden="true">·</span> : null}
            {data.followingMeeting ? (
              <AdjacentLink
                meeting={data.followingMeeting}
                spaceKey={spaceKey}
                label={t("meetings.meeting.following")}
              />
            ) : null}
          </span>
        ) : null}
        <span className="ml-auto flex flex-wrap gap-2">
          {writable && data.state === "closed" ? (
            <Button variant="secondary" icon={RotateCcw} onClick={() => void reopen(target)}>
              {t("meetings.reopen.action")}
            </Button>
          ) : null}
          {writable && data.current && notYet && data.startsAt ? (
            <span className="flex min-h-control-md items-center text-sm text-text-muted">
              {t("meetings.close.fromDay", { date: format.weekdayDate(data.startsAt) })}
            </span>
          ) : null}
          {writable && data.current ? (
            <Button
              disabled={notYet}
              variant="secondary"
              icon={Check}
              onClick={() =>
                data.rhythm || data.extra || data.state === "reopened"
                  ? void close(target)
                  : setDialog("close")
              }
            >
              {t("meetings.close.action")}
            </Button>
          ) : null}
        </span>
      </div>
      {form === "move" ? <MoveForm meeting={data} target={target} onDone={() => setForm(null)} /> : null}
      {form === "extra" && data.seriesId ? (
        <ExtraMeetingForm
          seriesId={data.seriesId}
          timeZone={target.timeZone}
          spaceKey={spaceKey}
          onDone={() => setForm(null)}
        />
      ) : null}
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

function DateTimeFields({
  date,
  time,
  onDate,
  onTime,
  dateInput,
}: {
  date: string;
  time: string;
  onDate: (value: string) => void;
  onTime: (value: string) => void;
  dateInput: React.RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation();
  return (
    <>
      <AppDatePicker
        ref={dateInput}
        value={date}
        className="w-auto"
        aria-label={t("meetings.schedule.date")}
        onValueChange={onDate}
      />
      <AppTimePicker value={time} aria-label={t("meetings.schedule.time")} onValueChange={onTime} />
    </>
  );
}

function MoveForm({
  meeting,
  target,
  onDone,
}: {
  meeting: Meeting;
  target: MeetingTarget;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const refresh = useMeetingRefresh();
  const start = meeting.startsAt ? new Date(meeting.startsAt) : new Date();
  const [date, setDate] = useState(localDateInZone(start, target.timeZone));
  const [time, setTime] = useState(localTimeInZone(start, target.timeZone));
  const [problem, setProblem] = useState<string | null>(null);
  const dateInput = useRef<HTMLButtonElement>(null);
  const submit = async () => {
    if (!date || !time) {
      setProblem(t("meetings.move.missing"));
      dateInput.current?.focus();
      return;
    }
    try {
      await request(() =>
        api.PUT("/api/v1/meetings/{meetingId}/start", {
          params: { path: { meetingId: meeting.id } },
          body: { startsAt: instantInZone(date, time, target.timeZone).toISOString() },
        }),
      );
      await refresh(meeting.id);
      toast({ variant: "success", title: t("meetings.move.done") });
      onDone();
    } catch (failure) {
      toast({ variant: "error", title: t("meetings.move.failed"), description: problemMessage(t, failure) });
    }
  };
  return (
    <form
      aria-label={t("meetings.move.title")}
      className="flex flex-wrap items-center gap-2 rounded-md bg-surface-sunken p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <span className="font-medium">{t("meetings.move.to")}</span>
      <DateTimeFields date={date} time={time} onDate={setDate} onTime={setTime} dateInput={dateInput} />
      <span className="text-sm text-text-muted">
        {problem ??
          (target.rhythm
            ? t("meetings.move.rhythmStays")
            : t("meetings.move.zone", { timeZone: target.timeZone }))}
      </span>
      <span className="ml-auto flex gap-2">
        <Button type="submit" size="sm" variant="primary">
          {t("meetings.move.confirm")}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </span>
    </form>
  );
}

export function ExtraMeetingForm({
  seriesId,
  timeZone,
  spaceKey,
  onDone,
}: {
  seriesId: string;
  timeZone: string;
  spaceKey: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const refresh = useMeetingRefresh();
  const tomorrow = new Date(Date.now() + 86_400_000);
  const [date, setDate] = useState(localDateInZone(tomorrow, timeZone));
  const [time, setTime] = useState("09:00");
  const [problem, setProblem] = useState<string | null>(null);
  const dateInput = useRef<HTMLButtonElement>(null);
  const submit = async () => {
    if (!date || !time) {
      setProblem(t("meetings.move.missing"));
      dateInput.current?.focus();
      return;
    }
    try {
      const created = await request(() =>
        api.POST("/api/v1/meeting-series/{seriesId}/meetings", {
          params: { path: { seriesId } },
          body: { startsAt: instantInZone(date, time, timeZone).toISOString() },
        }),
      );
      await refresh();
      toast({ variant: "success", title: t("meetings.extra.done") });
      onDone();
      await navigate({ to: pagePath(spaceKey, created.id, itemSlug(created.title)) });
    } catch (failure) {
      toast({ variant: "error", title: t("meetings.extra.failed"), description: problemMessage(t, failure) });
    }
  };
  return (
    <form
      aria-label={t("meetings.extra.action")}
      className="flex flex-wrap items-center gap-2 rounded-md bg-surface-sunken p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <span className="font-medium">{t("meetings.extra.on")}</span>
      <DateTimeFields date={date} time={time} onDate={setDate} onTime={setTime} dateInput={dateInput} />
      <span className="text-sm text-text-muted">{problem ?? t("meetings.extra.hint")}</span>
      <span className="ml-auto flex gap-2">
        <Button type="submit" size="sm" variant="primary">
          {t("meetings.extra.confirm")}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </span>
    </form>
  );
}

function AttendanceSelect({
  name,
  value,
  writable,
  onChange,
}: {
  name: string;
  value: string | null;
  writable: boolean;
  onChange: (value: string | null) => void;
}) {
  const { t } = useTranslation();
  const current: AttendanceChoice = (value as AttendanceChoice | null) ?? "unset";
  const label = translateKey(t, `meetings.attendance.${current}`);
  if (!writable) return <span className="pr-2 text-sm text-text-muted">{label}</span>;
  return (
    <Select
      value={current}
      className="h-control-sm w-auto text-sm"
      aria-label={t("meetings.attendance.of", { name })}
      onValueChange={(next) => onChange(next === "unset" ? null : next)}
      options={ATTENDANCE.map((choice) => ({
        value: choice,
        label: translateKey(t, `meetings.attendance.${choice}`),
      }))}
    />
  );
}

function Attendees({ meeting, writable }: { meeting: Meeting; writable: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: meetingKeys.meeting(meeting.id) });
  const update = async (path: "attendee" | "guest", id: string, attendance: string | null) => {
    const value = attendance as Meeting["attendees"][number]["attendance"];
    const input = attendance as "present" | "excused" | "absent" | null;
    queryClient.setQueryData<Meeting>(meetingKeys.meeting(meeting.id), (current) =>
      current
        ? {
            ...current,
            attendees: current.attendees.map((entry) =>
              entry.id === id ? { ...entry, attendance: value } : entry,
            ),
            guests: current.guests.map((entry) =>
              entry.id === id ? { ...entry, attendance: value } : entry,
            ),
          }
        : current,
    );
    try {
      await request(() =>
        path === "attendee"
          ? api.PUT("/api/v1/meetings/{meetingId}/attendees/{accountId}", {
              params: { path: { meetingId: meeting.id, accountId: id } },
              body: { attendance: input },
            })
          : api.PUT("/api/v1/meetings/{meetingId}/guests/{guestId}", {
              params: { path: { meetingId: meeting.id, guestId: id } },
              body: { attendance: input },
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
  const removeGuest = async (guestId: string, name: string) => {
    try {
      await request(() =>
        api.DELETE("/api/v1/meetings/{meetingId}/guests/{guestId}", {
          params: { path: { meetingId: meeting.id, guestId } },
        }),
      );
      toast({ variant: "success", title: t("meetings.guests.removed", { name }) });
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.guests.removeFailed"),
        description: problemMessage(t, failure),
      });
    } finally {
      await refresh();
    }
  };
  const chip =
    "flex min-h-control-md items-center gap-2 rounded-full border border-border py-1 pr-1 pl-1 text-sm";
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label={t("meetings.attendance.title")} className="flex flex-wrap items-center gap-2">
        {meeting.attendees.map((attendee) => {
          const name = attendee.name ?? t("meetings.unknownPerson");
          return (
            <li key={attendee.id} className={chip}>
              <PersonAvatar
                id={attendee.id}
                name={name}
                pictureRef={attendee.pictureRef}
                size="sm"
                decorative
              />
              <span className="max-w-field shrink-0 truncate whitespace-nowrap" title={name}>
                {name.split(" ")[0] || name}
              </span>
              {attendee.active ? null : <Badge variant="neutral">{t("meetings.inactive")}</Badge>}
              <AttendanceSelect
                name={name}
                value={attendee.attendance}
                writable={writable}
                onChange={(value) => void update("attendee", attendee.id, value)}
              />
            </li>
          );
        })}
        {meeting.guests.map((guest) => (
          <li key={guest.id} className={chip} title={guest.note ?? undefined}>
            <PersonAvatar id={guest.id} name={guest.name} size="sm" decorative />
            <span className="shrink-0 whitespace-nowrap">{guest.name}</span>
            <Badge variant="neutral">{t("meetings.guests.badge")}</Badge>
            <AttendanceSelect
              name={guest.name}
              value={guest.attendance}
              writable={writable}
              onChange={(value) => void update("guest", guest.id, value)}
            />
            {writable ? (
              <IconButton
                variant="ghost"
                icon={X}
                label={t("meetings.guests.remove", { name: guest.name })}
                onClick={() => void removeGuest(guest.id, guest.name)}
              />
            ) : null}
          </li>
        ))}
        {writable && !adding ? (
          <li>
            <Button variant="ghost" size="sm" icon={Plus} onClick={() => setAdding(true)}>
              {t("meetings.attendance.person")}
            </Button>
          </li>
        ) : null}
      </ul>
      {adding ? <AddPerson meetingId={meeting.id} onDone={() => setAdding(false)} /> : null}
    </div>
  );
}

function AddPerson({ meetingId, onDone }: { meetingId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<"account" | "guest">("account");
  const [person, setPerson] = useState<ComboboxItem | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const submit = async () => {
    if (kind === "account" && !person) {
      setProblem(t("meetings.attendance.personRequired"));
      return;
    }
    if (kind === "guest" && !name.trim()) {
      setProblem(t("meetings.guests.nameRequired"));
      nameInput.current?.focus();
      return;
    }
    try {
      if (kind === "account" && person) {
        await request(() =>
          api.POST("/api/v1/meetings/{meetingId}/attendees", {
            params: { path: { meetingId } },
            body: { accountId: person.value },
          }),
        );
      } else {
        await request(() =>
          api.POST("/api/v1/meetings/{meetingId}/guests", {
            params: { path: { meetingId } },
            body: { name: name.trim(), note: note.trim() || null },
          }),
        );
      }
      await queryClient.invalidateQueries({ queryKey: meetingKeys.meeting(meetingId) });
      toast({
        variant: "success",
        title: t("meetings.attendance.added", {
          name: kind === "account" ? (person?.label ?? "") : name.trim(),
        }),
      });
      onDone();
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.attendance.addFailed"),
        description: problemMessage(t, failure),
      });
    }
  };
  return (
    <form
      aria-label={t("meetings.attendance.add")}
      className="flex flex-col gap-2 rounded-md bg-surface-sunken p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDone();
      }}
    >
      <SegmentedControl
        label={t("meetings.attendance.kind")}
        value={kind}
        onValueChange={(value) => {
          setKind(value as "account" | "guest");
          setProblem(null);
        }}
        options={[
          { value: "account", label: t("meetings.attendance.withAccount") },
          { value: "guest", label: t("meetings.guests.withoutAccount") },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        {kind === "account" ? (
          <div className="w-field max-w-full">
            <Combobox
              load={peopleLoader}
              value={person?.value ?? null}
              selectedItem={person}
              invalid={problem !== null}
              placeholder={t("meetings.create.membersPlaceholder")}
              aria-label={t("meetings.attendance.person")}
              onValueChange={(_value, item) => {
                setPerson(item);
                setProblem(null);
              }}
            />
          </div>
        ) : (
          <>
            <Input
              ref={nameInput}
              autoFocus
              value={name}
              className="w-field max-w-full"
              invalid={problem !== null}
              aria-label={t("meetings.guests.name")}
              placeholder={t("meetings.guests.namePlaceholder")}
              onChange={(event) => {
                setName(event.target.value);
                setProblem(null);
              }}
            />
            <Input
              value={note}
              className="w-field max-w-full"
              aria-label={t("meetings.guests.note")}
              placeholder={t("meetings.guests.notePlaceholder")}
              onChange={(event) => setNote(event.target.value)}
            />
          </>
        )}
        <Button type="submit" size="sm" variant="primary">
          {t("meetings.attendance.addConfirm")}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </div>
      <p className="text-sm text-text-muted">
        {problem ? (
          <span className="text-danger">{problem}</span>
        ) : kind === "guest" ? (
          t("meetings.guests.hint")
        ) : null}
      </p>
    </form>
  );
}
