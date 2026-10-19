import { doc, hint, iconSection, orderedList, placeholder } from "./nodes.js";
import type { BuiltInTemplate, BuiltInTemplateText } from "./types.js";

const en = {
  name: "Troubleshooting",
  description: "Article on a known problem: what readers see, why it happens, how to fix it.",
  symptom: "What you see",
  symptomHint: "Describe what readers notice, with the exact error message and a screenshot.",
  cause: "Cause",
  causeHint: "Explain briefly why the problem occurs.",
  resolution: "Solution",
  resolutionHint: "Describe each step that fixes the problem.",
};

const de: typeof en = {
  name: "Störung",
  description: "Artikel zu einem bekannten Problem: was man sieht, Ursache und Lösung.",
  symptom: "Was du siehst",
  symptomHint: "Beschreibe, was Betroffene bemerken, mit der genauen Fehlermeldung und einem Bildschirmfoto.",
  cause: "Ursache",
  causeHint: "Erkläre kurz, warum das Problem auftritt.",
  resolution: "Lösung",
  resolutionHint: "Beschreibe jeden Schritt, der das Problem behebt.",
};

function text(t: typeof en): BuiltInTemplateText {
  return {
    name: t.name,
    description: t.description,
    title: "",
    fields: [],
    document: doc(
      iconSection("symptom", t.symptom, "eye", hint(t.symptomHint)),
      iconSection("cause", t.cause, "search", hint(t.causeHint)),
      iconSection("resolution", t.resolution, "wrench", orderedList(placeholder(t.resolutionHint))),
    ),
  };
}

export const articleTroubleshooting: BuiltInTemplate = {
  key: "article-troubleshooting",
  category: "knowledge",
  knowledgeBase: true,
  articleType: "troubleshooting",
  text: { en: text(en), de: text(de) },
};
