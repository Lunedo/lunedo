import { closestCenter, DndContext, DragOverlay, type UniqueIdentifier } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  type ComboboxItem,
  classNames,
  FilterMenu,
  IconButton,
  Input,
  type SaveState,
  SaveStatus,
  Skeleton,
  Textarea,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Flag, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { peopleLoader } from "../collaboration/people.js";
import { useSetTaskStatus } from "../collaboration/task-actions.js";
import { AppDatePicker } from "../components/date-fields.js";
import { PersonAvatar } from "../components/person-avatar.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { localDateInZone } from "../format/zoned.js";
import { useFormat } from "../preferences/preferences-provider.js";
import {
  type Agenda,
  type AgendaTask,
  type AgendaTopic,
  agendaQuery,
  meetingKeys,
  meetingQuery,
} from "./queries.js";
import {
  DropLine,
  useDropIndicator,
  useSortableAccessibility,
  useSortableItem,
  useSortableSensors,
} from "./sortable.js";
import { TopicDialog } from "./topic-form.js";

const SAVE_DELAY_MS = 800;
const LABEL = "text-xs font-semibold tracking-label text-text-muted uppercase";

interface TopicDay {
  today: string;
  label: string;
  heading: string;
}

function moved(ids: string[], id: string, afterId: string | null): string[] {
  const rest = ids.filter((entry) => entry !== id);
  rest.splice(afterId === null ? 0 : rest.indexOf(afterId) + 1, 0, id);
  return rest;
}

export function AgendaSection({
  meetingId,
  spaceKey,
  writable,
}: {
  meetingId: string;
  spaceKey: string;
  writable: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const agenda = useQuery(agendaQuery(meetingId));
  const meeting = useQuery({ ...meetingQuery(meetingId), throwOnError: false });
  const format = useFormat();
  const [owner, setOwner] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSortableSensors();
  const drop = useDropIndicator();
  const titleOf = (id: UniqueIdentifier) =>
    agenda.data?.topics.find((topic) => topic.id === id)?.title ?? String(id);
  const accessibility = useSortableAccessibility(titleOf);
  if (agenda.isPending) return <Skeleton className="h-field w-full" />;
  if (agenda.isError) {
    return (
      <LoadError
        what={t("meetings.agenda.loadFailed")}
        error={agenda.error}
        onRetry={() => agenda.refetch()}
      />
    );
  }
  const data = agenda.data;
  const editable = writable && data.current;
  const shown = data.topics.filter((topic) => !owner || topic.owner?.id === owner);
  const owners = new Map(
    data.topics.flatMap((topic) => (topic.owner ? [[topic.owner.id, topic.owner.name ?? ""] as const] : [])),
  );
  const reorderable = editable && owner === "";
  const allOpen = shown.length > 0 && shown.every((topic) => open.has(topic.id));
  const timeZone = meeting.data?.timeZone ?? format.settings.timeZone;
  const today = localDateInZone(new Date(), timeZone);
  const startsAt = meeting.data?.startsAt ?? null;
  const isToday = !startsAt || localDateInZone(new Date(startsAt), timeZone) === today;
  const day: TopicDay = {
    today,
    label: isToday || !startsAt ? t("meetings.agenda.today") : format.calendarDate(startsAt),
    heading: !startsAt
      ? t("meetings.agenda.entry")
      : isToday
        ? t("meetings.agenda.todayOn", { date: format.calendarDate(startsAt) })
        : t("meetings.agenda.entryOn", { date: format.calendarDate(startsAt) }),
  };

  const move = async (id: string, afterId: string | null, undoable = true) => {
    const key = meetingKeys.agenda(meetingId);
    const before = data.topics.map((topic) => topic.id);
    const previous = before[before.indexOf(id) - 1] ?? null;
    const order = moved(before, id, afterId);
    queryClient.setQueryData<Agenda>(key, (current) =>
      current
        ? {
            ...current,
            topics: order.flatMap((entry) => current.topics.filter((topic) => topic.id === entry)),
          }
        : current,
    );
    try {
      await request(() =>
        api.PUT("/api/v1/meeting-series/{seriesId}/topic-order", {
          params: { path: { seriesId: data.seriesId } },
          body: { topicId: id, afterId },
        }),
      );
      if (undoable) {
        toast({
          title: t("meetings.agenda.moved", { title: titleOf(id) }),
          undo: { onUndo: () => void move(id, previous, false) },
        });
      }
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.agenda.moveFailed"),
        description: problemMessage(t, failure),
      });
    } finally {
      await queryClient.invalidateQueries({ queryKey: meetingKeys.all });
    }
  };
  const step = (topic: AgendaTopic, direction: -1 | 1) => {
    const ids = data.topics.map((entry) => entry.id);
    const index = ids.indexOf(topic.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    const without = ids.filter((entry) => entry !== topic.id);
    void move(topic.id, target === 0 ? null : (without[target - 1] ?? null));
  };

  return (
    <section aria-labelledby="agenda-title" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="agenda-title" className="flex items-baseline gap-2 text-lg font-semibold">
          {data.current ? t("meetings.agenda.title") : t("meetings.agenda.discussed")}
          <span className="text-sm font-normal text-text-muted">{data.topics.length}</span>
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {owners.size > 0 ? (
            <FilterMenu
              label={t("meetings.agenda.person")}
              value={owner}
              options={[
                { value: "", label: t("meetings.agenda.everyone") },
                ...[...owners].map(([id, name]) => ({
                  value: id,
                  label: name || t("meetings.unknownPerson"),
                })),
              ]}
              onValueChange={setOwner}
              size="button"
            />
          ) : null}
          {shown.length > 0 ? (
            <Button
              variant="secondary"
              onClick={() => setOpen(allOpen ? new Set() : new Set(shown.map((topic) => topic.id)))}
            >
              {allOpen ? t("meetings.agenda.collapseAll") : t("meetings.agenda.expandAll")}
            </Button>
          ) : null}
          {editable ? (
            <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
              {t("meetings.agenda.topic")}
            </Button>
          ) : null}
        </div>
      </div>
      {editable ? (
        <TopicDialog
          seriesId={data.seriesId}
          seriesTitle={meeting.data?.seriesTitle ?? null}
          meetingId={meetingId}
          open={adding}
          onOpenChange={setAdding}
        />
      ) : null}
      {shown.length === 0 ? (
        <p className="border-t border-border py-3 text-sm text-text-muted">
          {owner ? t("meetings.agenda.noneForPerson") : t("meetings.agenda.empty")}
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          accessibility={accessibility}
          onDragStart={(event) => setDragging(String(event.active.id))}
          onDragOver={drop.onDragOver}
          onDragCancel={() => {
            setDragging(null);
            drop.clear();
          }}
          onDragEnd={(event) => {
            setDragging(null);
            const place = drop.finish(event);
            if (!place) return;
            const ids = data.topics.map((topic) => topic.id).filter((id) => id !== event.active.id);
            const index = ids.indexOf(String(place.overId));
            const afterId = place.after ? (ids[index] ?? null) : index > 0 ? (ids[index - 1] ?? null) : null;
            void move(String(event.active.id), afterId);
          }}
        >
          <SortableContext items={shown.map((topic) => topic.id)} strategy={verticalListSortingStrategy}>
            <ol aria-labelledby="agenda-title" className="flex flex-col border-t border-border">
              {shown.map((topic, index) => (
                <li key={topic.id} className="flex flex-col">
                  <DropLine show={drop.indicator?.overId === topic.id && !drop.indicator.after} />
                  <TopicRow
                    topic={topic}
                    day={day}
                    number={data.topics.indexOf(topic) + 1}
                    meetingId={meetingId}
                    editable={editable}
                    reorderable={reorderable}
                    first={index === 0}
                    last={index === shown.length - 1}
                    expanded={open.has(topic.id)}
                    onToggle={() => {
                      const next = new Set(open);
                      if (next.has(topic.id)) next.delete(topic.id);
                      else next.add(topic.id);
                      setOpen(next);
                    }}
                    onStep={(direction) => step(topic, direction)}
                  />
                  <DropLine show={drop.indicator?.overId === topic.id && drop.indicator.after} />
                </li>
              ))}
            </ol>
          </SortableContext>
          <DragOverlay>
            {dragging ? (
              <div className="rounded-md border border-border bg-surface px-3 py-2 font-medium shadow-popover">
                {titleOf(dragging)}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
      <p className="border-t border-border py-2 text-sm text-text-muted">
        {t("meetings.agenda.archiveBefore")}{" "}
        <Link
          to="/spaces/$spaceKey/meetings/$seriesId"
          params={{ spaceKey, seriesId: data.seriesId }}
          search={{ tab: "topics", status: "closed" }}
          className="text-accent hover:underline focus-visible:focus-ring"
        >
          {t("meetings.agenda.archiveLink")}
        </Link>
      </p>
    </section>
  );
}

function TopicRow({
  topic,
  day,
  number,
  meetingId,
  editable,
  reorderable,
  first,
  last,
  expanded,
  onToggle,
  onStep,
}: {
  topic: AgendaTopic;
  day: TopicDay;
  number: number;
  meetingId: string;
  editable: boolean;
  reorderable: boolean;
  first: boolean;
  last: boolean;
  expanded: boolean;
  onToggle: () => void;
  onStep: (direction: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const sortable = useSortableItem(topic.id, !reorderable);
  const openTasks = topic.tasks.filter((task) => !task.done).length;
  const overdue = topic.tasks.filter((task) => isOverdue(task, day.today)).length;
  const owner = topic.owner?.name ?? t("meetings.topics.noOwner");
  const bodyId = `topic-body-${topic.id}`;
  const own = topic.update?.text.trim() ? topic.update.text : null;
  const latest = [...topic.history].reverse().find((entry) => entry.text.trim().length > 0);
  const writtenCount = topic.history.filter((entry) => entry.text.trim().length > 0).length;
  const meta = topic.oneOff
    ? [t("meetings.agenda.forThisMeeting")]
    : [
        t("meetings.agenda.runningSince", { date: format.calendarDate(topic.createdAt) }),
        t("meetings.agenda.meetings", { count: topic.meetings }),
        ...(openTasks > 0 ? [t("meetings.agenda.openTasks", { count: openTasks })] : []),
      ];
  return (
    <div
      ref={sortable.setNodeRef}
      className={classNames(
        "group flex flex-col border-b border-border py-3",
        sortable.dragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2">
        {reorderable ? sortable.handle(t("meetings.agenda.dragTopic", { title: topic.title })) : null}
        <span className="w-6 shrink-0 pt-1 text-right text-sm text-text-muted tabular-nums">{number}</span>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={onToggle}
          className="flex min-w-0 flex-1 flex-col items-start gap-1 rounded-sm text-left focus-visible:focus-ring"
        >
          <span className="flex max-w-full items-center gap-2 font-semibold">
            <span className="truncate" title={topic.title}>
              {topic.title}
            </span>
            {topic.oneOff ? <Badge variant="neutral">{t("meetings.agenda.onlyThisMeeting")}</Badge> : null}
          </span>
          <span className="flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
            <span className="min-w-0 truncate">{meta.join(" · ")}</span>
            {overdue > 0 ? (
              <Badge variant="danger">{t("meetings.agenda.overdue", { count: overdue })}</Badge>
            ) : null}
          </span>
        </button>
        <span title={owner} className="inline-flex pt-1">
          {topic.owner ? (
            <PersonAvatar id={topic.owner.id} name={owner} size="sm" />
          ) : (
            <span className="sr-only">{owner}</span>
          )}
        </span>
        {reorderable ? (
          <span className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            {first ? null : (
              <IconButton
                size="sm"
                variant="ghost"
                icon={ArrowUp}
                label={t("meetings.agenda.moveUp", { title: topic.title })}
                onClick={() => onStep(-1)}
              />
            )}
            {last ? null : (
              <IconButton
                size="sm"
                variant="ghost"
                icon={ArrowDown}
                label={t("meetings.agenda.moveDown", { title: topic.title })}
                onClick={() => onStep(1)}
              />
            )}
          </span>
        ) : null}
        <IconButton
          size="sm"
          variant="ghost"
          icon={expanded ? ChevronDown : ChevronRight}
          label={
            expanded
              ? t("meetings.agenda.collapse", { title: topic.title })
              : t("meetings.agenda.expand", { title: topic.title })
          }
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={onToggle}
        />
      </div>
      {expanded ? (
        <div id={bodyId} className="flex flex-col gap-3 pt-3 pl-8">
          <TopicBody topic={topic} day={day} meetingId={meetingId} editable={editable} />
        </div>
      ) : (
        <p
          className={classNames(
            "mt-2 ml-8 border-l-2 px-3 py-2 text-sm",
            own ? "rounded-r-md border-accent bg-accent-soft" : "border-border",
          )}
        >
          {own ? (
            <>
              <span className="mr-2 font-semibold text-text-muted">{day.label}</span>
              <span className="whitespace-pre-line">{own}</span>
            </>
          ) : latest ? (
            <>
              <span className="mr-2 font-semibold text-text-muted">
                {latest.startsAt ? format.calendarDate(latest.startsAt) : latest.meetingTitle}
              </span>
              <span className="whitespace-pre-line">{latest.text}</span>
            </>
          ) : (
            <span className="text-text-muted">{t("meetings.agenda.noEntry")}</span>
          )}
          {writtenCount > 1 ? (
            <>
              {" · "}
              <button
                type="button"
                aria-controls={bodyId}
                aria-expanded={false}
                onClick={onToggle}
                className="text-accent hover:underline focus-visible:focus-ring"
              >
                {t("meetings.agenda.historyCount", { count: writtenCount })}
              </button>
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}

function TopicBody({
  topic,
  day,
  meetingId,
  editable,
}: {
  topic: AgendaTopic;
  day: TopicDay;
  meetingId: string;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const format = useFormat();
  const queryClient = useQueryClient();
  const [text, setText] = useState(topic.update?.text ?? "");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [problem, setProblem] = useState<string | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void>>(Promise.resolve());
  const formatted = topic.update?.formatted ?? false;
  const refresh = () => queryClient.invalidateQueries({ queryKey: meetingKeys.all });

  const save = (value: string) => {
    pending.current = null;
    inflight.current = inflight.current.then(() => store(value));
    return inflight.current;
  };
  const store = async (value: string) => {
    setSaveState("saving");
    try {
      await request(() =>
        api.PUT("/api/v1/meetings/{meetingId}/topics/{topicId}/update", {
          params: { path: { meetingId, topicId: topic.id } },
          body: { text: value },
        }),
      );
      setSaveState("saved");
      void queryClient.invalidateQueries({ queryKey: meetingKeys.agenda(meetingId) });
    } catch (failure) {
      setSaveState("error");
      toast({
        variant: "error",
        title: t("meetings.agenda.saveFailed"),
        description: problemMessage(t, failure),
      });
    }
  };
  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current !== null) await save(pending.current);
    await inflight.current;
  };
  const saveLater = useRef(save);
  saveLater.current = save;
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current !== null) void saveLater.current(pending.current);
    },
    [],
  );
  const change = (value: string) => {
    setText(value);
    setProblem(null);
    pending.current = value;
    setSaveState("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  const close = async (outcome: "decided" | "resolved" | "dropped") => {
    if (outcome === "decided" && !text.trim()) {
      setProblem(t("meetings.agenda.decisionNeedsText"));
      field.current?.focus();
      return;
    }
    await flush();
    try {
      if (outcome === "decided") {
        await request(() =>
          api.POST("/api/v1/topics/{topicId}/decision", {
            params: { path: { topicId: topic.id } },
            body: { statement: text.trim(), meetingId },
          }),
        );
        await request(() =>
          api.PUT("/api/v1/meetings/{meetingId}/topics/{topicId}/update", {
            params: { path: { meetingId, topicId: topic.id } },
            body: { text: "" },
          }),
        );
      } else {
        await request(() =>
          api.POST("/api/v1/topics/{topicId}/close", {
            params: { path: { topicId: topic.id } },
            body: { outcome, meetingId },
          }),
        );
      }
      await refresh();
      toast({
        variant: "success",
        title: t(`meetings.agenda.closed.${outcome}`, { title: topic.title }),
        ...(outcome === "decided"
          ? {}
          : {
              undo: {
                onUndo: () =>
                  void request(() =>
                    api.POST("/api/v1/topics/{topicId}/reopen", { params: { path: { topicId: topic.id } } }),
                  )
                    .then(refresh)
                    .catch((failure: unknown) =>
                      toast({
                        variant: "error",
                        title: t("meetings.topic.reopenFailed"),
                        description: problemMessage(t, failure),
                      }),
                    ),
              },
            }),
      });
    } catch (failure) {
      toast({
        variant: "error",
        title: outcome === "decided" ? t("meetings.topic.decideFailed") : t("meetings.topic.closeFailed"),
        description: problemMessage(t, failure),
      });
    }
  };

  const written = topic.history.filter((entry) => entry.text.trim() !== "");
  return (
    <>
      {written.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className={LABEL}>{t("meetings.agenda.history")}</h3>
          <ol
            aria-label={t("meetings.agenda.historyOf", { title: topic.title })}
            className="flex flex-col text-sm"
          >
            {written.map((entry, index) => (
              <li key={entry.meetingId} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-3 py-1">
                <span className="text-text-muted">
                  {entry.startsAt ? format.calendarDate(entry.startsAt) : entry.meetingTitle}
                  {index === 0 ? ` · ${t("meetings.agenda.start")}` : ""}
                </span>
                <span className="break-words whitespace-pre-line">{entry.text}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {editable && !formatted ? (
        <div className="flex flex-col gap-1">
          <h3 className={LABEL}>{day.heading}</h3>
          <Textarea
            ref={field}
            value={text}
            rows={3}
            aria-label={t("meetings.agenda.updateLabel", { title: topic.title })}
            placeholder={t("meetings.agenda.updatePlaceholder")}
            invalid={problem !== null}
            onChange={(event) => change(event.target.value)}
            onBlur={() => void flush()}
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {problem ? <span className="text-danger">{problem}</span> : null}
            <span className="ml-auto">
              <SaveStatus state={saveState} />
            </span>
          </div>
        </div>
      ) : topic.update?.text ? (
        <div className="flex flex-col gap-1">
          <h3 className={LABEL}>{day.heading}</h3>
          <p className="text-sm whitespace-pre-line">{topic.update.text}</p>
        </div>
      ) : null}
      {editable && formatted ? (
        <p className="text-sm text-text-muted">{t("meetings.agenda.formatted")}</p>
      ) : null}
      <div className="flex flex-col gap-1">
        <h3 className={LABEL}>{t("meetings.agenda.topicTasks")}</h3>
        {topic.tasks.length === 0 && !editable ? (
          <p className="text-sm text-text-muted">{t("meetings.agenda.noTasks")}</p>
        ) : null}
        <ul className="flex flex-col">
          {topic.tasks.map((task) => (
            <TaskLine key={task.id} task={task} today={day.today} />
          ))}
        </ul>
        {editable ? (
          addingTask ? (
            <TaskForm meetingId={meetingId} topicId={topic.id} onDone={() => setAddingTask(false)} />
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon={Plus}
              className="self-start"
              onClick={() => setAddingTask(true)}
            >
              {t("meetings.agenda.addTask")}
            </Button>
          )
        ) : null}
      </div>
      {editable ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-border pt-3">
          <Button size="sm" variant="secondary" icon={Flag} onClick={() => void close("decided")}>
            {t("meetings.agenda.decide")}
          </Button>
          <Button size="sm" variant="secondary" icon={Check} onClick={() => void close("resolved")}>
            {t("meetings.agenda.resolve")}
          </Button>
          <Button size="sm" variant="ghost" icon={X} onClick={() => void close("dropped")}>
            {t("meetings.agenda.drop")}
          </Button>
          <span className="ml-auto text-sm text-text-muted">{t("meetings.agenda.autosave")}</span>
        </div>
      ) : null}
    </>
  );
}

export function isOverdue(task: AgendaTask, today: string): boolean {
  return !task.done && task.dueDate !== null && task.dueDate < today;
}

export function TaskLine({ task, today }: { task: AgendaTask; today?: string }) {
  const { t } = useTranslation();
  const format = useFormat();
  const setStatus = useSetTaskStatus(task.meetingId);
  const queryClient = useQueryClient();
  return (
    <li className="flex min-h-row items-center gap-2 py-1">
      <Checkbox
        checked={task.done}
        aria-label={
          task.done ? t("tasks.markOpen", { task: task.text }) : t("tasks.markDone", { task: task.text })
        }
        onCheckedChange={(checked) =>
          setStatus.mutate(
            { taskId: task.id, done: checked },
            { onSettled: () => void queryClient.invalidateQueries({ queryKey: meetingKeys.all }) },
          )
        }
      />
      <span
        className={classNames("min-w-0 flex-1 truncate", task.done && "text-text-muted line-through")}
        title={task.text}
      >
        {task.text || t("tasks.untitled")}
      </span>
      <span className="inline-flex items-center gap-2 text-sm text-text-muted">
        {task.assignee ? (
          <span title={task.assignee.name ?? t("meetings.unknownPerson")} className="inline-flex">
            <PersonAvatar id={task.assignee.id} name={task.assignee.name ?? "?"} size="sm" />
          </span>
        ) : null}
        {task.dueDate ? (
          <time
            dateTime={task.dueDate}
            title={format.date(`${task.dueDate}T12:00:00Z`)}
            className={today && isOverdue(task, today) ? "text-danger" : undefined}
          >
            {format.day(`${task.dueDate}T12:00:00Z`)}
          </time>
        ) : null}
      </span>
    </li>
  );
}

function TaskForm({
  meetingId,
  topicId,
  onDone,
}: {
  meetingId: string;
  topicId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const textInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [person, setPerson] = useState<ComboboxItem | null>(null);
  const [due, setDue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!text.trim()) {
      setProblem(t("meetings.agenda.taskRequired"));
      textInput.current?.focus();
      return;
    }
    setSaving(true);
    try {
      await request(() =>
        api.POST("/api/v1/meetings/{meetingId}/topics/{topicId}/tasks", {
          params: { path: { meetingId, topicId } },
          body: { text: text.trim(), assigneeId: person?.value ?? null, dueDate: due || null },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: meetingKeys.all });
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast({ variant: "success", title: t("meetings.agenda.taskAdded") });
      onDone();
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.agenda.taskFailed"),
        description: problemMessage(t, failure),
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      aria-label={t("meetings.agenda.addTask")}
      className="flex flex-wrap items-start gap-2"
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
          ref={textInput}
          autoFocus
          value={text}
          aria-label={t("meetings.agenda.taskText")}
          placeholder={t("meetings.agenda.taskPlaceholder")}
          invalid={problem !== null}
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
          }}
        />
        {problem ? <span className="text-sm text-danger">{problem}</span> : null}
      </div>
      <div className="w-field max-w-full">
        <Combobox
          load={peopleLoader}
          value={person?.value ?? null}
          selectedItem={person}
          placeholder={t("meetings.agenda.taskPerson")}
          aria-label={t("meetings.agenda.taskPerson")}
          onValueChange={(_value, item) => setPerson(item)}
        />
      </div>
      <AppDatePicker
        value={due}
        clearable
        className="w-auto"
        aria-label={t("meetings.agenda.taskDue")}
        onValueChange={setDue}
      />
      <Button type="submit" size="sm" variant="primary" loading={saving}>
        {t("meetings.agenda.createTask")}
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={onDone}>
        {t("common.cancel")}
      </Button>
    </form>
  );
}
