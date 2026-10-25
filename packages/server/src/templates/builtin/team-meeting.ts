import { doc, hint } from "./nodes.js";
import type { BuiltInTemplate, BuiltInTemplateText } from "./types.js";

const en = {
  name: "Team meeting",
  description: "Recurring team meeting with running topics, decisions, tasks and free notes.",
  notesHint:
    "Everything worth keeping from this meeting that is not a topic, a decision or a task. Topics, decisions and tasks have their own sections on the meeting page.",
};

const de: typeof en = {
  name: "Jour fixe",
  description: "Regelmäßige Teambesprechung mit laufenden Themen, Entscheidungen, Aufgaben und Notizen.",
  notesHint:
    "Alles, was aus dieser Besprechung bleiben soll und kein Thema, keine Entscheidung und keine Aufgabe ist. Dafür hat die Besprechungsseite eigene Abschnitte.",
};

function text(t: typeof en): BuiltInTemplateText {
  return {
    name: t.name,
    description: t.description,
    title: t.name,
    fields: [],
    document: doc(hint(t.notesHint)),
  };
}

export const teamMeeting: BuiltInTemplate = {
  key: "team-meeting",
  category: "meetings",
  text: { en: text(en), de: text(de) },
  series: { rhythm: { frequency: "weekly", interval: 1, weekdays: ["MO"] }, durationMinutes: 45 },
};
