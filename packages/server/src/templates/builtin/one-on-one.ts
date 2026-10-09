import { bulletList, doc, field, hint, openTaskReport, paragraph, placeholder, section } from "./nodes.js";
import type { BuiltInTemplate, BuiltInTemplateText } from "./types.js";

const en = {
  name: "One-on-one",
  description: "Regular conversation between two people with topics from each, feedback, goals and tasks.",
  title: "{date}",
  dateLabel: "Date",
  topics: "Topics",
  topicsHint: "Each of you adds what you want to talk about. Mention who brought it with @name.",
  runningTopics: "Running topics",
  runningTopicsHint: "Topics you keep coming back to. Write what is new below each one.",
  feedback: "Feedback",
  feedbackHint: "What went well and what could be better, in both directions.",
  goals: "Goals",
  goalsHint: "Progress on agreed goals and anything that blocks them.",
  openTasks: "Open tasks",
  newTasks: "New tasks",
  newTasksHint: "Add each task with /task, mention the owner with @name and set a due date.",
};

const de: typeof en = {
  name: "1:1",
  description: "Regelmäßiges Gespräch zu zweit mit Themen beider Seiten, Feedback, Zielen und Aufgaben.",
  title: "{date}",
  dateLabel: "Datum",
  topics: "Themen",
  topicsHint: "Ihr tragt beide ein, worüber ihr sprechen wollt. Erwähne mit @Name, von wem das Thema kommt.",
  runningTopics: "Laufende Themen",
  runningTopicsHint: "Themen, auf die ihr immer wieder zurückkommt. Schreib unter jedes Thema, was neu ist.",
  feedback: "Feedback",
  feedbackHint: "Was gut lief und was besser ginge, in beide Richtungen.",
  goals: "Ziele",
  goalsHint: "Fortschritt bei den vereinbarten Zielen und was ihn bremst.",
  openTasks: "Offene Aufgaben",
  newTasks: "Neue Aufgaben",
  newTasksHint:
    "Lege jede Aufgabe mit /Aufgabe an, erwähne die verantwortliche Person mit @Name und setze ein Fälligkeitsdatum.",
};

function text(t: typeof en): BuiltInTemplateText {
  return {
    name: t.name,
    description: t.description,
    title: t.title,
    fields: [{ key: "date", label: t.dateLabel, type: "date", required: true }],
    document: doc(
      paragraph(field("date")),
      section("topics", t.topics, bulletList(placeholder(t.topicsHint))),
      section("runningTopics", t.runningTopics, hint(t.runningTopicsHint)),
      section("feedback", t.feedback, hint(t.feedbackHint)),
      section("goals", t.goals, hint(t.goalsHint)),
      section("openTasks", t.openTasks, openTaskReport()),
      section("newTasks", t.newTasks, hint(t.newTasksHint)),
    ),
  };
}

export const oneOnOne: BuiltInTemplate = {
  key: "one-on-one",
  category: "meetings",
  text: { en: text(en), de: text(de) },
  series: { rhythm: { frequency: "weekly", interval: 2, weekdays: ["TH"] }, durationMinutes: 30 },
};
