import { bulletList, doc, field, hint, openTaskReport, paragraph, placeholder, section } from "./nodes.js";
import type { BuiltInTemplate, BuiltInTemplateText } from "./types.js";

const en = {
  name: "Team meeting",
  description: "Recurring team meeting with agenda, running topics, tasks, decisions and notes.",
  title: "{date}",
  dateLabel: "Date",
  agenda: "Agenda",
  agendaHint: "Add one item per topic that is new today.",
  runningTopics: "Running topics",
  runningTopicsHint:
    "Topics stay open across meetings until someone closes them. Write what is new below each one.",
  openTasks: "Open tasks",
  newTasks: "New tasks",
  newTasksHint: "Add each task with /task, mention the owner with @name and set a due date.",
  decisions: "Decisions",
  decisionsHint: "Record each decision with /decision.",
  notes: "Notes",
  notesHint: "Everything else worth keeping from this meeting.",
};

const de: typeof en = {
  name: "Jour fixe",
  description: "Regelmäßige Teambesprechung mit Agenda, Themen, Aufgaben, Entscheidungen und Notizen.",
  title: "{date}",
  dateLabel: "Datum",
  agenda: "Agenda",
  agendaHint: "Lege für jedes neue Thema einen Punkt an.",
  runningTopics: "Laufende Themen",
  runningTopicsHint:
    "Themen bleiben über mehrere Besprechungen offen, bis jemand sie schließt. Schreib unter jedes Thema, was neu ist.",
  openTasks: "Offene Aufgaben",
  newTasks: "Neue Aufgaben",
  newTasksHint:
    "Lege jede Aufgabe mit /Aufgabe an, erwähne die verantwortliche Person mit @Name und setze ein Fälligkeitsdatum.",
  decisions: "Entscheidungen",
  decisionsHint: "Halte jede Entscheidung mit /Entscheidung fest.",
  notes: "Notizen",
  notesHint: "Alles andere, was aus dieser Besprechung bleiben soll.",
};

function text(t: typeof en): BuiltInTemplateText {
  return {
    name: t.name,
    description: t.description,
    title: t.title,
    fields: [{ key: "date", label: t.dateLabel, type: "date", required: true }],
    document: doc(
      paragraph(field("date")),
      section("agenda", t.agenda, bulletList(placeholder(t.agendaHint))),
      section("runningTopics", t.runningTopics, hint(t.runningTopicsHint)),
      section("openTasks", t.openTasks, openTaskReport()),
      section("newTasks", t.newTasks, hint(t.newTasksHint)),
      section("decisions", t.decisions, hint(t.decisionsHint)),
      section("notes", t.notes, hint(t.notesHint)),
    ),
  };
}

export const teamMeeting: BuiltInTemplate = {
  key: "team-meeting",
  category: "meetings",
  text: { en: text(en), de: text(de) },
  series: { rhythm: { frequency: "weekly", interval: 1, weekdays: ["MO"] }, durationMinutes: 45 },
};
