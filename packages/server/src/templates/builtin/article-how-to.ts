import { doc, hint, iconSection, orderedList, placeholder } from "./nodes.js";
import type { BuiltInTemplate, BuiltInTemplateText } from "./types.js";

const en = {
  name: "How-to",
  description: "Article that guides readers step by step through a task.",
  summary: "What this is about",
  summaryHint: "Say in one or two sentences what the reader achieves and who it is for.",
  prerequisites: "Before you start",
  prerequisitesHint: "List what the reader needs: access, devices, programs or information.",
  steps: "Steps",
  stepsHint: "Describe one action per step and add a screenshot where it helps.",
  help: "Did it not work?",
  helpHint: "Name common problems and what to do, or whom to contact.",
};

const de: typeof en = {
  name: "Anleitung",
  description: "Artikel, der Schritt für Schritt durch eine Aufgabe führt.",
  summary: "Worum geht es",
  summaryHint: "Sag in ein, zwei Sätzen, was Lesende erreichen und für wen die Anleitung ist.",
  prerequisites: "Bevor du startest",
  prerequisitesHint: "Liste auf, was man braucht: Zugänge, Geräte, Programme oder Informationen.",
  steps: "Schritte",
  stepsHint: "Beschreibe pro Schritt eine Handlung und füge ein Bildschirmfoto ein, wo es hilft.",
  help: "Hat es nicht geklappt?",
  helpHint: "Nenne häufige Probleme und was dann hilft, oder an wen man sich wendet.",
};

function text(t: typeof en): BuiltInTemplateText {
  return {
    name: t.name,
    description: t.description,
    title: "",
    fields: [],
    document: doc(
      iconSection("summary", t.summary, "info", hint(t.summaryHint)),
      iconSection("prerequisites", t.prerequisites, "list-checks", hint(t.prerequisitesHint)),
      iconSection("steps", t.steps, "list-ordered", orderedList(placeholder(t.stepsHint))),
      iconSection("help", t.help, "life-buoy", hint(t.helpHint)),
    ),
  };
}

export const articleHowTo: BuiltInTemplate = {
  key: "article-how-to",
  category: "knowledge",
  knowledgeBase: true,
  articleType: "howTo",
  text: { en: text(en), de: text(de) },
};
