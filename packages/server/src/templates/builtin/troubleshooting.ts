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
  name: "Troubleshooting article",
  description: "Symptom, cause and resolution of a known problem, with escalation path.",
  title: "Troubleshooting: {problem}",
  problemLabel: "Problem",
  appliesTo: "Applies to",
  appliesToHint: "System, environment or version",
  lastVerified: "Last verified",
  lastVerifiedHint: "Date the resolution last worked",
  symptom: "Symptom",
  symptomHint: "Describe what users see, including the exact error message.",
  cause: "Cause",
  causeHint: "Explain why the problem occurs. If the cause is unknown, write down what has been ruled out.",
  resolution: "Resolution",
  resolutionHint: "Describe each step needed to fix the problem.",
  workaround: "Workaround",
  workaroundHint: "Describe a temporary workaround, if there is one.",
  escalate: "When to escalate",
  escalateHint: "Say when to escalate and to whom, for example if the steps do not help within 30 minutes.",
  related: "Related articles",
  relatedHint: "Link similar problems, tickets or external documentation.",
};

const de: typeof en = {
  name: "Fehlerbehebung",
  description: "Symptom, Ursache und Lösung eines bekannten Problems, mit Eskalationsweg.",
  title: "Fehlerbehebung: {problem}",
  problemLabel: "Problem",
  appliesTo: "Gilt für",
  appliesToHint: "System, Umgebung oder Version",
  lastVerified: "Zuletzt geprüft",
  lastVerifiedHint: "Datum, an dem die Lösung zuletzt funktioniert hat",
  symptom: "Symptom",
  symptomHint: "Beschreibe, was Betroffene sehen, mit der genauen Fehlermeldung.",
  cause: "Ursache",
  causeHint:
    "Erkläre, warum das Problem auftritt. Ist die Ursache unbekannt, halte fest, was bereits ausgeschlossen ist.",
  resolution: "Lösung",
  resolutionHint: "Beschreibe jeden Schritt, der das Problem behebt.",
  workaround: "Umgehungslösung",
  workaroundHint: "Beschreibe eine vorübergehende Umgehung, falls es eine gibt.",
  escalate: "Wann eskalieren?",
  escalateHint:
    "Lege fest, wann und an wen eskaliert wird, zum Beispiel wenn die Schritte nach 30 Minuten nicht helfen.",
  related: "Verwandte Artikel",
  relatedHint: "Verlinke ähnliche Probleme, Tickets oder externe Dokumentation.",
};

function text(t: typeof en): BuiltInTemplateText {
  return {
    name: t.name,
    description: t.description,
    title: t.title,
    fields: [{ key: "problem", label: t.problemLabel, type: "text", required: true }],
    document: doc(
      propertyTable(
        [t.problemLabel, field("problem")],
        [t.appliesTo, placeholder(t.appliesToHint)],
        [t.lastVerified, placeholder(t.lastVerifiedHint)],
      ),
      heading(2, t.symptom),
      hint(t.symptomHint),
      heading(2, t.cause),
      hint(t.causeHint),
      heading(2, t.resolution),
      orderedList(placeholder(t.resolutionHint)),
      heading(2, t.workaround),
      hint(t.workaroundHint),
      callout("warning", paragraph(bold(t.escalate)), hint(t.escalateHint)),
      heading(2, t.related),
      bulletList(placeholder(t.relatedHint)),
    ),
  };
}

export const troubleshooting: BuiltInTemplate = {
  key: "troubleshooting",
  category: "knowledge",
  text: { en: text(en), de: text(de) },
};
