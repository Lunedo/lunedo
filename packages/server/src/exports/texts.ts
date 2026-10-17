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
  whiteboardWithoutImage: string;
  someContent: string;
  nodeTitles: Readonly<Record<string, string>>;
  pageNumber: { before: string; between: string };
  exportedBy: (date: string, name: string) => string;
  comments: string;
  commentOn: (quote: string) => string;
  deletedComment: string;
  appendix: string;
  appendixFile: string;
  appendixPage: string;
  appendixSize: string;
  contentsHint: string;
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
    drawing: "Drawing",
    drawio: "draw.io diagram",
    mermaid: "Mermaid diagram",
    plantuml: "PlantUML diagram",
    diagramSource: "Source",
    diagramNotRendered: "{name} has no image yet. Its source is shown instead.",
    drawioReference: "draw.io diagram from another page",
    diagramFrom: "From {title}",
    diagramRemoved: "The draw.io diagram was removed from its page.",
    diagramNotImported: "The draw.io diagram {name} is on a page that was not imported.",
    restrictedContent: "Restricted content",
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
    unavailableHere: "{name} cannot be shown in this format. Open the page in Pagehall to see it.",
    pageProperties: "Page properties",
    propertiesReport: "Page properties report",
    noReportedProperties: "No pages with page properties match the filters",
    propertiesReportCreator: "Creator",
    propertiesReportLabels: "Labels",
    propertiesReportMore: "{shown} of {total} pages. Open the page in Pagehall to see all.",
    importedQuery:
      "Imported with a query that could not be converted: {query}. Check the labels and spaces of this block.",
    contentByLabel: "Content by label",
    noLabeledContent: "No pages match the labels",
    relatedLabels: "Related labels",
    noRelatedLabels: "No related labels",
    excerpt: "Excerpt",
    hiddenExcerpt: "Hidden excerpt",
    includedPage: "Included page",
    includedExcerpt: "Included excerpt",
    notImportedYet:
      "The included page {title} was not part of the import. It appears here once it is imported.",
    includeLoop: "This content is not shown because it would include itself.",
    includeTooDeep: "This content is not shown because included pages are nested too deeply.",
    noExcerpt: "The included page has no excerpt.",
    roadmap: "Roadmap",
    roadmapReadOnly: "Imported roadmap. Roadmaps can be edited once planning is available.",
    roadmapAsList: "Show as list",
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
  whiteboardWithoutImage:
    "This whiteboard has no saved image yet, for example because nothing was drawn on it. Open it in Pagehall to see it.",
  someContent: "This content",
  nodeTitles: {},
  pageNumber: { before: "Page ", between: " of " },
  exportedBy: (date, name) => `Exported on ${date} by ${name}`,
  comments: "Comments",
  commentOn: (quote) => `On “${quote}”`,
  deletedComment: "Deleted comment",
  appendix: "Appendix: attachments",
  appendixFile: "File",
  appendixPage: "Page",
  appendixSize: "Size",
  contentsHint: "Word fills in the contents when you update the fields of the document.",
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
    drawing: "Zeichnung",
    drawio: "draw.io-Diagramm",
    mermaid: "Mermaid-Diagramm",
    plantuml: "PlantUML-Diagramm",
    diagramSource: "Quelltext",
    diagramNotRendered: "{name} hat noch kein Bild. Stattdessen wird der Quelltext gezeigt.",
    drawioReference: "draw.io-Diagramm von einer anderen Seite",
    diagramFrom: "Aus {title}",
    diagramRemoved: "Das draw.io-Diagramm wurde von seiner Seite entfernt.",
    diagramNotImported: "Das draw.io-Diagramm {name} liegt auf einer Seite, die nicht importiert wurde.",
    restrictedContent: "Eingeschränkter Inhalt",
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
    unavailableHere:
      "{name} kann in diesem Format nicht dargestellt werden. Öffnen Sie die Seite in Pagehall, um es zu sehen.",
    pageProperties: "Seiteneigenschaften",
    propertiesReport: "Bericht zu Seiteneigenschaften",
    noReportedProperties: "Keine Seite mit Seiteneigenschaften passt zu den Filtern",
    propertiesReportCreator: "Erstellt von",
    propertiesReportLabels: "Labels",
    propertiesReportMore: "{shown} von {total} Seiten. Öffnen Sie die Seite in Pagehall, um alle zu sehen.",
    importedQuery:
      "Mit einer Abfrage importiert, die nicht übernommen werden konnte: {query}. Prüfen Sie Labels und Bereiche dieses Blocks.",
    contentByLabel: "Inhalte nach Label",
    noLabeledContent: "Keine Seite passt zu den Labels",
    relatedLabels: "Verwandte Labels",
    noRelatedLabels: "Keine verwandten Labels",
    excerpt: "Auszug",
    hiddenExcerpt: "Versteckter Auszug",
    includedPage: "Eingebundene Seite",
    includedExcerpt: "Eingebundener Auszug",
    notImportedYet:
      "Die eingebundene Seite {title} war nicht Teil des Imports. Sie erscheint hier, sobald sie importiert ist.",
    includeLoop: "Dieser Inhalt wird nicht angezeigt, weil er sich selbst einbinden würde.",
    includeTooDeep:
      "Dieser Inhalt wird nicht angezeigt, weil eingebundene Seiten zu tief verschachtelt sind.",
    noExcerpt: "Die eingebundene Seite hat keinen Auszug.",
    roadmap: "Roadmap",
    roadmapReadOnly:
      "Importierte Roadmap. Roadmaps lassen sich bearbeiten, sobald die Planung verfügbar ist.",
    roadmapAsList: "Als Liste anzeigen",
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
  whiteboardWithoutImage:
    "Von diesem Whiteboard ist noch kein Bild gespeichert, zum Beispiel weil noch nichts darauf gezeichnet wurde. Öffnen Sie es in Pagehall, um es zu sehen.",
  someContent: "Dieser Inhalt",
  nodeTitles: {},
  pageNumber: { before: "Seite ", between: " von " },
  exportedBy: (date, name) => `Exportiert am ${date} von ${name}`,
  comments: "Kommentare",
  commentOn: (quote) => `Zu „${quote}“`,
  deletedComment: "Gelöschter Kommentar",
  appendix: "Anhang: Dateien",
  appendixFile: "Datei",
  appendixPage: "Seite",
  appendixSize: "Größe",
  contentsHint: "Word füllt das Inhaltsverzeichnis, wenn Sie die Felder des Dokuments aktualisieren.",
};

const texts: Record<Language, ExportTexts> = { en: english, de: german };

export function exportTexts(language: Language): ExportTexts {
  return texts[language];
}
