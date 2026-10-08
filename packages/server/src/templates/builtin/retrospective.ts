import { bulletList, doc, field, heading, placeholder, propertyTable, taskList } from "./nodes.js";
import type { BuiltInTemplate, BuiltInTemplateText } from "./types.js";

const en = {
  name: "Retrospective",
  description: "Look back on a sprint or period and agree on concrete improvements.",
  title: "Retrospective {period}",
  periodLabel: "Sprint or period",
  dateLabel: "Date",
  participants: "Participants",
  participantsHint: "Mention the participants with @name.",
  previousActions: "Actions from last time",
  previousActionsHint: "Copy the open action items from the last retrospective and check off what is done.",
  wentWell: "What went well",
  wentWellHint: "What helped the team and should continue?",
  couldBeBetter: "What could be better",
  couldBeBetterHint: "What slowed the team down or caused frustration?",
  ideas: "Ideas to try",
  ideasHint: "What would the team like to try next time?",
  actionItems: "Action items",
  actionItemsHint: "Describe a concrete action, mention one owner with @name and set a due date.",
};

const de: typeof en = {
  name: "Retrospektive",
  description: "Rückblick auf einen Sprint oder Zeitraum mit konkreten Verbesserungen.",
  title: "Retrospektive {period}",
  periodLabel: "Sprint oder Zeitraum",
  dateLabel: "Datum",
  participants: "Teilnehmende",
  participantsHint: "Erwähne die Teilnehmenden mit @Name.",
  previousActions: "Maßnahmen vom letzten Mal",
  previousActionsHint:
    "Übernimm die offenen Maßnahmen der letzten Retrospektive und hake ab, was erledigt ist.",
  wentWell: "Was gut lief",
  wentWellHint: "Was hat dem Team geholfen und soll bleiben?",
  couldBeBetter: "Was besser laufen könnte",
  couldBeBetterHint: "Was hat das Team ausgebremst oder für Frust gesorgt?",
  ideas: "Ideen zum Ausprobieren",
  ideasHint: "Was möchte das Team beim nächsten Mal ausprobieren?",
  actionItems: "Maßnahmen",
  actionItemsHint:
    "Beschreibe eine konkrete Maßnahme, erwähne eine verantwortliche Person mit @Name und setze ein Fälligkeitsdatum.",
};

function text(t: typeof en): BuiltInTemplateText {
  return {
    name: t.name,
    description: t.description,
    title: t.title,
    fields: [
      { key: "period", label: t.periodLabel, type: "text", required: true },
      { key: "date", label: t.dateLabel, type: "date", required: true },
    ],
    document: doc(
      propertyTable(
        [t.periodLabel, field("period")],
        [t.dateLabel, field("date")],
        [t.participants, placeholder(t.participantsHint)],
      ),
      heading(2, t.previousActions),
      taskList(placeholder(t.previousActionsHint)),
      heading(2, t.wentWell),
      bulletList(placeholder(t.wentWellHint)),
      heading(2, t.couldBeBetter),
      bulletList(placeholder(t.couldBeBetterHint)),
      heading(2, t.ideas),
      bulletList(placeholder(t.ideasHint)),
      heading(2, t.actionItems),
      taskList(placeholder(t.actionItemsHint)),
    ),
  };
}

export const retrospective: BuiltInTemplate = {
  key: "retrospective",
  category: "teams",
  text: { en: text(en), de: text(de) },
};
