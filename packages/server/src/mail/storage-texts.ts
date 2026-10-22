import type { Content, Language, MailTemplates } from "./templates.js";

type Reached = Omit<MailTemplates["storageLevelReached"], "instanceName"> & { instanceName: string };
type Cleared = Omit<MailTemplates["storageLevelCleared"], "instanceName"> & { instanceName: string };

const holds = {
  en: {
    local: (used: string, total: string, percent: string) =>
      `The file storage volume holds ${used} of ${total} (${percent}).`,
    s3: (used: string, total: string, percent: string) =>
      `Lunedo stores ${used} in S3, ${percent} of the limit of ${total}.`,
  },
  de: {
    local: (used: string, total: string, percent: string) =>
      `Das Laufwerk für Dateien ist mit ${used} von ${total} belegt (${percent}).`,
    s3: (used: string, total: string, percent: string) =>
      `Lunedo speichert ${used} in S3, das sind ${percent} des Limits von ${total}.`,
  },
} as const;

const effect = {
  en: {
    1: "Nothing is blocked yet. Free up space or add capacity before the storage fills up.",
    2: "New space and subtree exports and imports are refused until the usage falls. Uploads and editing still work.",
    3: "Uploads are refused too. Editing pages still works. Free up space or add capacity now.",
  },
  de: {
    1: "Noch ist nichts gesperrt. Schaffen Sie Platz oder erweitern Sie den Speicher, bevor er voll läuft.",
    2: "Neue Exporte von Spaces und Teilbäumen sowie Importe werden abgelehnt, bis die Belegung sinkt. Uploads und Bearbeiten funktionieren weiter.",
    3: "Auch Uploads werden abgelehnt. Seiten lassen sich weiter bearbeiten. Schaffen Sie jetzt Platz oder erweitern Sie den Speicher.",
  },
} as const;

const recovered = {
  en: {
    0: "Storage usage is back to normal. Nothing is blocked.",
    1: "Exports, imports and uploads work again. The usage is still above the warning level.",
    2: "Uploads work again. New exports and imports are still refused.",
  },
  de: {
    0: "Die Speicherbelegung ist wieder normal. Nichts ist gesperrt.",
    1: "Exporte, Importe und Uploads funktionieren wieder. Die Belegung liegt noch über der Warnstufe.",
    2: "Uploads funktionieren wieder. Neue Exporte und Importe werden weiter abgelehnt.",
  },
} as const;

export function storageReached(language: Language, params: Reached): Content {
  const prefix = params.reminder ? (language === "de" ? "Erinnerung: " : "Reminder: ") : "";
  const subject =
    language === "de"
      ? `${prefix}Speicher von ${params.instanceName} zu ${params.percent} belegt`
      : `${prefix}Storage of ${params.instanceName} is ${params.percent} full`;
  const open = language === "de" ? "Speichereinstellungen öffnen" : "Open the storage settings";
  return {
    subject,
    paragraphs: [
      holds[language][params.store](params.used, params.total, params.percent),
      effect[language][params.level],
    ],
    ...(params.link ? { action: { label: open, url: params.link } } : {}),
  };
}

export function storageCleared(language: Language, params: Cleared): Content {
  const subject =
    language === "de"
      ? `Speicher von ${params.instanceName}: Belegung ${params.level === 0 ? "wieder normal" : "gesunken"} (${params.percent})`
      : `Storage of ${params.instanceName}: usage ${params.level === 0 ? "back to normal" : "has fallen"} (${params.percent})`;
  const open = language === "de" ? "Speichereinstellungen öffnen" : "Open the storage settings";
  return {
    subject,
    paragraphs: [recovered[language][params.level]],
    ...(params.link ? { action: { label: open, url: params.link } } : {}),
  };
}

export function storageTest(
  language: Language,
  params: { instanceName: string; link: string | null },
): Content {
  const open = language === "de" ? "Speichereinstellungen öffnen" : "Open the storage settings";
  return {
    subject:
      language === "de"
        ? `Testnachricht von ${params.instanceName}`
        : `Test message from ${params.instanceName}`,
    paragraphs: [
      language === "de"
        ? "Diese Nachricht bestätigt, dass Speicherwarnungen hier ankommen."
        : "This message confirms that storage warnings reach this address.",
    ],
    ...(params.link ? { action: { label: open, url: params.link } } : {}),
  };
}
