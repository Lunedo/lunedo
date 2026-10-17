import { defaultImportTexts, type ImportText } from "@pagehall/editor-schema";
import type { TemplateLanguage } from "../templates/builtin/types.js";

const importTexts: Readonly<Record<TemplateLanguage, Readonly<Record<ImportText, string>>>> = {
  en: defaultImportTexts,
  de: {
    jiraNotImported: "Jira-Inhalt nicht importiert.",
    chartNotImported: "Diagramm nicht importiert. Die Quelltabelle folgt.",
    pivotNotImported: "Pivot-Tabelle nicht importiert. Die Quelltabelle folgt.",
  },
};

export function importText(language: TemplateLanguage, key: ImportText): string {
  return importTexts[language][key];
}

export function jiraIssueUrl(sourceUrl: string | null, key: string): string | null {
  if (!sourceUrl) return null;
  try {
    const site = new URL(sourceUrl);
    if (site.protocol !== "https:" || !site.hostname.endsWith(".atlassian.net")) return null;
    return `https://${site.hostname}/browse/${encodeURIComponent(key)}`;
  } catch {
    return null;
  }
}
