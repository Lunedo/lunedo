import type { RenderLabels } from "@pagehall/editor-schema";
import type { Language } from "../mail/templates.js";

export interface ExportTexts {
  labels: RenderLabels;
  contents: string;
  untitledPage: string;
  untitledFolder: string;
  blog: string;
  publishedVersion: (version: number, date: string) => string;
  lastChanged: (date: string) => string;
  exported: (date: string) => string;
  meeting: (date: string) => string;
  attendees: (names: string) => string;
  attachments: string;
  link: string;
  unavailable: (what: string) => string;
  pageUnavailable: string;
}

const english: ExportTexts = {
  labels: {
    noAccess: "No access",
    inTrash: "In trash",
    taskDone: "Done",
    taskOpen: "Open",
    untitledPage: "Untitled page",
    unknownPerson: "Unknown person",
    unsupportedMacro: "Content from Confluence that cannot be shown yet: {name}",
    taskReport: "Task report",
    decision: "Decision",
    unknownTopic: "Topic",
    tableOfContents: "Table of contents",
    file: "File",
    image: "Image",
    childPages: "Child pages",
    noChildPages: "No child pages",
    attachmentList: "Attachments",
    noAttachments: "No attachments",
    pageReport: "Page report",
    noReportedPages: "No pages match the filters",
    decisionReport: "Decision report",
    noReportedDecisions: "No decisions match the filters",
    reportTitle: "Page",
    reportAuthor: "Author",
    reportUpdated: "Last changed",
    noReportedTasks: "No tasks match the filters",
    reportTask: "Task",
    reportAssignee: "Assigned to",
    reportDue: "Due",
    reportPage: "Page",
    templateButton: "Create from template",
    callout: { info: "Info", tip: "Tip", note: "Note", warning: "Warning", error: "Error" },
  },
  contents: "Contents",
  untitledPage: "Untitled page",
  untitledFolder: "Untitled folder",
  blog: "Blog",
  publishedVersion: (version, date) => `Published version ${version} of ${date}`,
  lastChanged: (date) => `Last changed on ${date}`,
  exported: (date) => `Exported on ${date}`,
  meeting: (date) => `Meeting on ${date}`,
  attendees: (names) => `Attendees: ${names}`,
  attachments: "Attachments",
  link: "Link",
  unavailable: (what) => `${what} could not be exported.`,
  pageUnavailable: "The content of this page could not be exported.",
};

const german: ExportTexts = {
  labels: {
    noAccess: "Kein Zugriff",
    inTrash: "Im Papierkorb",
    taskDone: "Erledigt",
    taskOpen: "Offen",
    untitledPage: "Seite ohne Titel",
    unknownPerson: "Unbekannte Person",
    unsupportedMacro: "Inhalt aus Confluence, der noch nicht angezeigt wird: {name}",
    taskReport: "Aufgabenbericht",
    decision: "Entscheidung",
    unknownTopic: "Thema",
    tableOfContents: "Inhaltsverzeichnis",
    file: "Datei",
    image: "Bild",
    childPages: "Unterseiten",
    noChildPages: "Keine Unterseiten",
    attachmentList: "Anhänge",
    noAttachments: "Keine Anhänge",
    pageReport: "Seitenbericht",
    noReportedPages: "Keine Seite passt zu den Filtern",
    decisionReport: "Entscheidungsbericht",
    noReportedDecisions: "Keine Entscheidung passt zu den Filtern",
    reportTitle: "Seite",
    reportAuthor: "Autor",
    reportUpdated: "Zuletzt geändert",
    noReportedTasks: "Keine Aufgabe passt zu den Filtern",
    reportTask: "Aufgabe",
    reportAssignee: "Zugewiesen an",
    reportDue: "Fällig",
    reportPage: "Seite",
    templateButton: "Aus Vorlage erstellen",
    callout: { info: "Info", tip: "Tipp", note: "Notiz", warning: "Warnung", error: "Fehler" },
  },
  contents: "Inhalt",
  untitledPage: "Seite ohne Titel",
  untitledFolder: "Ordner ohne Titel",
  blog: "Blog",
  publishedVersion: (version, date) => `Veröffentlichte Version ${version} vom ${date}`,
  lastChanged: (date) => `Zuletzt geändert am ${date}`,
  exported: (date) => `Exportiert am ${date}`,
  meeting: (date) => `Besprechung am ${date}`,
  attendees: (names) => `Teilnehmende: ${names}`,
  attachments: "Anhänge",
  link: "Link",
  unavailable: (what) => `${what} konnte nicht exportiert werden.`,
  pageUnavailable: "Der Inhalt dieser Seite konnte nicht exportiert werden.",
};

const texts: Record<Language, ExportTexts> = { en: english, de: german };

export function exportTexts(language: Language): ExportTexts {
  return texts[language];
}
