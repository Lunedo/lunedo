import type { Content, Language } from "./templates.js";

export interface BackupFailedText {
  instanceName: string;
  reason: string;
  reminder: boolean;
  link: string | null;
}

export interface BackupMissingText {
  instanceName: string;
  days: number;
  lastSuccess: string | null;
  reminder: boolean;
  link: string | null;
}

export interface BackupRecoveredText {
  instanceName: string;
  link: string | null;
}

export interface BackupTestRestoreFailedText {
  instanceName: string;
  backupName: string;
  reason: string;
  link: string | null;
}

function open(language: Language, link: string | null): Pick<Content, "action"> {
  if (!link) return {};
  return {
    action: {
      label: language === "de" ? "Backup-Einstellungen öffnen" : "Open the backup settings",
      url: link,
    },
  };
}

function reminderPrefix(language: Language, reminder: boolean): string {
  if (!reminder) return "";
  return language === "de" ? "Erinnerung: " : "Reminder: ";
}

export function backupFailed(language: Language, params: BackupFailedText): Content {
  const prefix = reminderPrefix(language, params.reminder);
  if (language === "de") {
    return {
      subject: `${prefix}Backup von ${params.instanceName} fehlgeschlagen`,
      paragraphs: [
        `Das letzte Backup von ${params.instanceName} ist fehlgeschlagen: ${params.reason}`,
        "Weitere fehlgeschlagene Backups melden wir erst wieder, wenn ein Backup gelungen ist, oder mit der eingestellten Erinnerung.",
      ],
      ...open(language, params.link),
    };
  }
  return {
    subject: `${prefix}Backup of ${params.instanceName} failed`,
    paragraphs: [
      `The last backup of ${params.instanceName} failed: ${params.reason}`,
      "Further failures are not reported again until a backup succeeds, except by the reminder you set.",
    ],
    ...open(language, params.link),
  };
}

export function backupMissing(language: Language, params: BackupMissingText): Content {
  const prefix = reminderPrefix(language, params.reminder);
  if (language === "de") {
    return {
      subject: `${prefix}${params.instanceName} hat seit ${params.days} ${params.days === 1 ? "Tag" : "Tagen"} kein Backup`,
      paragraphs: [
        params.lastSuccess
          ? `Das letzte erfolgreiche Backup stammt vom ${params.lastSuccess}.`
          : "Es gibt noch kein erfolgreiches Backup.",
        "Prüfe den Zeitplan, das Backup-Ziel und die letzten Läufe in den Backup-Einstellungen.",
      ],
      ...open(language, params.link),
    };
  }
  return {
    subject: `${prefix}No backup of ${params.instanceName} for ${params.days} ${params.days === 1 ? "day" : "days"}`,
    paragraphs: [
      params.lastSuccess
        ? `The last successful backup was made on ${params.lastSuccess}.`
        : "There is no successful backup yet.",
      "Check the schedule, the backup target and the latest runs in the backup settings.",
    ],
    ...open(language, params.link),
  };
}

export function backupRecovered(language: Language, params: BackupRecoveredText): Content {
  return language === "de"
    ? {
        subject: `Backups von ${params.instanceName} funktionieren wieder`,
        paragraphs: ["Das letzte Backup ist gelungen."],
        ...open(language, params.link),
      }
    : {
        subject: `Backups of ${params.instanceName} work again`,
        paragraphs: ["The last backup succeeded."],
        ...open(language, params.link),
      };
}

export function backupTestRestoreFailed(language: Language, params: BackupTestRestoreFailedText): Content {
  return language === "de"
    ? {
        subject: `Test-Wiederherstellung eines Backups von ${params.instanceName} fehlgeschlagen`,
        paragraphs: [
          `Die Test-Wiederherstellung von ${params.backupName} ist fehlgeschlagen: ${params.reason}`,
          "Dieses Backup lässt sich möglicherweise nicht wiederherstellen. Prüfe das Ergebnis und erstelle ein neues Backup.",
        ],
        ...open(language, params.link),
      }
    : {
        subject: `Test restore of a backup of ${params.instanceName} failed`,
        paragraphs: [
          `The test restore of ${params.backupName} failed: ${params.reason}`,
          "This backup may not restore. Check the result and create a new backup.",
        ],
        ...open(language, params.link),
      };
}
