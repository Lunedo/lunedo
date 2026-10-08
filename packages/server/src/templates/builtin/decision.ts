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
  name: "Decision",
  description: "Record a decision with its context, the options considered and the consequences.",
  title: "Decision: {topic}",
  topicLabel: "Topic",
  ownerLabel: "Owner",
  statusLabel: "Status",
  statusOptions: ["Proposed", "Accepted", "Rejected", "Superseded"],
  dateLabel: "Decision date",
  stakeholders: "Stakeholders",
  stakeholdersHint: "Mention everyone who must be consulted or informed.",
  context: "Context",
  contextHint: "Describe the problem and why a decision is needed now.",
  criteria: "Decision criteria",
  criteriaHint: "List what a good solution must achieve, for example cost, effort, risk or time.",
  options: "Options considered",
  optionsHeaders: ["Option", "Pros", "Cons", "Effort"],
  optionHint: "Name the option and describe it in one sentence.",
  prosHint: "Advantages",
  consHint: "Disadvantages",
  effortHint: "Low, medium or high",
  decision: "Decision",
  decisionHint: "State the chosen option and the main reason for choosing it.",
  consequences: "Consequences",
  consequencesHint: "List what changes as a result, what becomes easier and what becomes harder.",
  actionItems: "Action items",
  actionItemsHint: "Describe what must be done to implement the decision and mention the owner with @name.",
};

const de: typeof en = {
  name: "Entscheidung",
  description: "Eine Entscheidung mit Kontext, geprüften Optionen und Folgen festhalten.",
  title: "Entscheidung: {topic}",
  topicLabel: "Thema",
  ownerLabel: "Verantwortlich",
  statusLabel: "Status",
  statusOptions: ["Vorgeschlagen", "Angenommen", "Abgelehnt", "Ersetzt"],
  dateLabel: "Entscheidungsdatum",
  stakeholders: "Beteiligte",
  stakeholdersHint: "Erwähne alle, die gefragt oder informiert werden müssen.",
  context: "Kontext",
  contextHint: "Beschreibe das Problem und warum jetzt eine Entscheidung nötig ist.",
  criteria: "Entscheidungskriterien",
  criteriaHint: "Liste auf, was eine gute Lösung leisten muss, etwa bei Kosten, Aufwand, Risiko oder Zeit.",
  options: "Geprüfte Optionen",
  optionsHeaders: ["Option", "Vorteile", "Nachteile", "Aufwand"],
  optionHint: "Benenne die Option und beschreibe sie in einem Satz.",
  prosHint: "Vorteile",
  consHint: "Nachteile",
  effortHint: "Gering, mittel oder hoch",
  decision: "Entscheidung",
  decisionHint: "Nenne die gewählte Option und den wichtigsten Grund dafür.",
  consequences: "Folgen",
  consequencesHint: "Liste auf, was sich dadurch ändert, was einfacher und was schwieriger wird.",
  actionItems: "Aufgaben",
  actionItemsHint:
    "Beschreibe, was für die Umsetzung zu tun ist, und erwähne die verantwortliche Person mit @Name.",
};

function text(t: typeof en): BuiltInTemplateText {
  const optionRow = () => [
    placeholder(t.optionHint),
    placeholder(t.prosHint),
    placeholder(t.consHint),
    placeholder(t.effortHint),
  ];
  return {
    name: t.name,
    description: t.description,
    title: t.title,
    fields: [
      { key: "topic", label: t.topicLabel, type: "text", required: true },
      { key: "owner", label: t.ownerLabel, type: "person", required: true },
      { key: "status", label: t.statusLabel, type: "choice", required: true, options: t.statusOptions },
      { key: "date", label: t.dateLabel, type: "date", required: false },
    ],
    document: doc(
      propertyTable(
        [t.topicLabel, field("topic")],
        [t.statusLabel, field("status")],
        [t.ownerLabel, field("owner")],
        [t.dateLabel, field("date")],
        [t.stakeholders, placeholder(t.stakeholdersHint)],
      ),
      heading(2, t.context),
      hint(t.contextHint),
      heading(2, t.criteria),
      bulletList(placeholder(t.criteriaHint)),
      heading(2, t.options),
      table(t.optionsHeaders, optionRow(), optionRow()),
      heading(2, t.decision),
      hint(t.decisionHint),
      heading(2, t.consequences),
      bulletList(placeholder(t.consequencesHint)),
      heading(2, t.actionItems),
      taskList(placeholder(t.actionItemsHint)),
    ),
  };
}

export const decision: BuiltInTemplate = {
  key: "decision",
  category: "decisions",
  text: { en: text(en), de: text(de) },
};
