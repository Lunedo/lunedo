import {
  bold,
  bulletList,
  callout,
  doc,
  field,
  heading,
  hint,
  orderedList,
  paragraph,
  placeholder,
  propertyTable,
} from "./nodes.js";
import type { BuiltInTemplate, BuiltInTemplateText } from "./types.js";

const en = {
  name: "How-to or runbook",
  description: "Step-by-step instructions for a recurring task, with checks and rollback.",
  title: "How to {subject}",
  subjectLabel: "Task",
  appliesTo: "Applies to",
  appliesToHint: "System, environment or version",
  owner: "Owner",
  ownerHint: "Mention who keeps this page up to date.",
  lastVerified: "Last verified",
  lastVerifiedHint: "Date of the last successful run",
  purpose: "Purpose",
  purposeHint: "Explain when and why someone needs these instructions.",
  prerequisites: "Prerequisites",
  prerequisitesHint: "List the required permissions, tools and information.",
  steps: "Steps",
  stepsHint: "Describe one action per step, with the exact command or menu path and the expected result.",
  caution: "Caution",
  cautionHint: "Point out steps that cannot be undone or cause downtime. Delete this box if there are none.",
  verification: "Verification",
  verificationHint: "Describe how to check that everything worked.",
  rollback: "Rollback",
  rollbackHint: "Describe how to undo the change if something goes wrong.",
  related: "Related pages",
  relatedHint: "Link related instructions, tickets or external documentation.",
};

const de: typeof en = {
  name: "Anleitung oder Runbook",
  description: "Schritt-für-Schritt-Anleitung für eine wiederkehrende Aufgabe, mit Prüfung und Rückweg.",
  title: "Anleitung: {subject}",
  subjectLabel: "Aufgabe",
  appliesTo: "Gilt für",
  appliesToHint: "System, Umgebung oder Version",
  owner: "Verantwortlich",
  ownerHint: "Erwähne, wer diese Seite aktuell hält.",
  lastVerified: "Zuletzt geprüft",
  lastVerifiedHint: "Datum der letzten erfolgreichen Durchführung",
  purpose: "Zweck",
  purposeHint: "Erkläre, wann und wofür man diese Anleitung braucht.",
  prerequisites: "Voraussetzungen",
  prerequisitesHint: "Liste die nötigen Berechtigungen, Werkzeuge und Informationen auf.",
  steps: "Schritte",
  stepsHint:
    "Beschreibe pro Schritt eine Handlung, mit genauem Befehl oder Menüpfad und dem erwarteten Ergebnis.",
  caution: "Achtung",
  cautionHint:
    "Weise auf Schritte hin, die sich nicht rückgängig machen lassen oder einen Ausfall verursachen. Lösche diesen Kasten, wenn es keine gibt.",
  verification: "Prüfung",
  verificationHint: "Beschreibe, wie man prüft, ob alles funktioniert hat.",
  rollback: "Rückgängig machen",
  rollbackHint: "Beschreibe, wie sich die Änderung zurücknehmen lässt, wenn etwas schiefgeht.",
  related: "Verwandte Seiten",
  relatedHint: "Verlinke verwandte Anleitungen, Tickets oder externe Dokumentation.",
};

function text(t: typeof en): BuiltInTemplateText {
  return {
    name: t.name,
    description: t.description,
    title: t.title,
    fields: [{ key: "subject", label: t.subjectLabel, type: "text", required: true }],
    document: doc(
      propertyTable(
        [t.subjectLabel, field("subject")],
        [t.appliesTo, placeholder(t.appliesToHint)],
        [t.owner, placeholder(t.ownerHint)],
        [t.lastVerified, placeholder(t.lastVerifiedHint)],
      ),
      heading(2, t.purpose),
      hint(t.purposeHint),
      heading(2, t.prerequisites),
      bulletList(placeholder(t.prerequisitesHint)),
      heading(2, t.steps),
      callout("warning", paragraph(bold(t.caution)), hint(t.cautionHint)),
      orderedList(placeholder(t.stepsHint)),
      heading(2, t.verification),
      hint(t.verificationHint),
      heading(2, t.rollback),
      hint(t.rollbackHint),
      heading(2, t.related),
      bulletList(placeholder(t.relatedHint)),
    ),
  };
}

export const howTo: BuiltInTemplate = {
  key: "how-to",
  category: "knowledge",
  text: { en: text(en), de: text(de) },
};
