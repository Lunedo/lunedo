import {
  bulletList,
  doc,
  field,
  heading,
  hint,
  placeholder,
  propertyTable,
  table,
  taskList,
} from "./nodes.js";
import type { BuiltInTemplate, BuiltInTemplateText } from "./types.js";

const en = {
  name: "Meeting notes",
  description: "Agenda, notes, decisions and action items of a meeting.",
  title: "Meeting notes {date}",
  dateLabel: "Date",
  facilitatorLabel: "Facilitator",
  goal: "Goal",
  goalHint: "State in one sentence what this meeting should achieve.",
  attendees: "Attendees",
  attendeesHint: "Mention each attendee with @name.",
  agenda: "Agenda",
  agendaHeaders: ["Time", "Topic", "Presenter"],
  agendaTimeHint: "10 min",
  agendaTopicHint: "Add one row per topic.",
  agendaPresenterHint: "@name",
  notes: "Notes",
  notesHint: "Write down the key points of the discussion for each topic.",
  decisions: "Decisions",
  decisionsHint: "Record each decision together with its reason.",
  actionItems: "Action items",
  actionItemsHint: "Describe the task, mention the owner with @name and set a due date.",
};

const de: typeof en = {
  name: "Besprechungsnotizen",
  description: "Agenda, Notizen, Entscheidungen und Aufgaben einer Besprechung.",
  title: "Besprechungsnotizen {date}",
  dateLabel: "Datum",
  facilitatorLabel: "Moderation",
  goal: "Ziel",
  goalHint: "Beschreibe in einem Satz, was die Besprechung erreichen soll.",
  attendees: "Teilnehmende",
  attendeesHint: "Erwähne alle Teilnehmenden mit @Name.",
  agenda: "Agenda",
  agendaHeaders: ["Zeit", "Thema", "Vortragende Person"],
  agendaTimeHint: "10 Min.",
  agendaTopicHint: "Lege für jedes Thema eine Zeile an.",
  agendaPresenterHint: "@Name",
  notes: "Notizen",
  notesHint: "Halte zu jedem Thema die wichtigsten Punkte der Diskussion fest.",
  decisions: "Entscheidungen",
  decisionsHint: "Notiere jede Entscheidung mit ihrer Begründung.",
  actionItems: "Aufgaben",
  actionItemsHint:
    "Beschreibe die Aufgabe, erwähne die verantwortliche Person mit @Name und setze ein Fälligkeitsdatum.",
};

function text(t: typeof en): BuiltInTemplateText {
  return {
    name: t.name,
    description: t.description,
    title: t.title,
    fields: [
      { key: "date", label: t.dateLabel, type: "date", required: true },
      { key: "facilitator", label: t.facilitatorLabel, type: "person", required: false },
    ],
    document: doc(
      propertyTable([t.dateLabel, field("date")], [t.facilitatorLabel, field("facilitator")]),
      heading(2, t.goal),
      hint(t.goalHint),
      heading(2, t.attendees),
      bulletList(placeholder(t.attendeesHint)),
      heading(2, t.agenda),
      table(t.agendaHeaders, [
        placeholder(t.agendaTimeHint),
        placeholder(t.agendaTopicHint),
        placeholder(t.agendaPresenterHint),
      ]),
      heading(2, t.notes),
      hint(t.notesHint),
      heading(2, t.decisions),
      bulletList(placeholder(t.decisionsHint)),
      heading(2, t.actionItems),
      taskList(placeholder(t.actionItemsHint)),
    ),
  };
}

export const meetingNotes: BuiltInTemplate = {
  key: "meeting-notes",
  category: "meetings",
  text: { en: text(en), de: text(de) },
};
