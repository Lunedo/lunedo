import { doc, heading, hint } from "./nodes.js";
import type { BuiltInTemplate, BuiltInTemplateText } from "./types.js";

const en = {
  name: "One-on-one",
  description: "Regular conversation between two people with topics, feedback, goals and tasks.",
  feedback: "Feedback",
  feedbackHint: "What went well and what could be better, in both directions.",
  goals: "Goals",
  goalsHint: "Progress on agreed goals and anything that blocks them.",
};

const de: typeof en = {
  name: "1:1",
  description: "Regelmäßiges Gespräch zu zweit mit Themen, Feedback, Zielen und Aufgaben.",
  feedback: "Feedback",
  feedbackHint: "Was gut lief und was besser ginge, in beide Richtungen.",
  goals: "Ziele",
  goalsHint: "Fortschritt bei den vereinbarten Zielen und was ihn bremst.",
};

function text(t: typeof en): BuiltInTemplateText {
  return {
    name: t.name,
    description: t.description,
    title: t.name,
    fields: [],
    document: doc(heading(3, t.feedback), hint(t.feedbackHint), heading(3, t.goals), hint(t.goalsHint)),
  };
}

export const oneOnOne: BuiltInTemplate = {
  key: "one-on-one",
  category: "meetings",
  text: { en: text(en), de: text(de) },
  series: { rhythm: { frequency: "weekly", interval: 2, weekdays: ["TH"] }, durationMinutes: 30 },
};
