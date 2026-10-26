import type { Language } from "../mail/templates.js";

export interface PushTextInput {
  params: Record<string, unknown>;
  actor: string | null;
  actorCount: number;
}

export interface PushText {
  title: string;
  body: string;
}

type Texts = Record<string, (input: PushTextInput) => PushText>;

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function together(actor: string | null, count: number, language: Language): string {
  if (!actor) return language === "de" ? "Jemand" : "Someone";
  if (count <= 1) return actor;
  const others = count - 1;
  if (language === "de")
    return `${actor} und ${others} ${others === 1 ? "weitere Person" : "weitere Personen"}`;
  return `${actor} and ${others} ${others === 1 ? "other" : "others"}`;
}

const en: Texts = {
  "content.mentioned": ({ params, actor }) => ({
    title: `${actor ?? "Someone"} mentioned you`,
    body: text(params.itemTitle),
  }),
  "task.assigned": ({ params }) => ({
    title: `New task in ${text(params.itemTitle)}`,
    body: text(params.taskText),
  }),
  "page.shared": ({ params, actor }) => ({
    title: `${actor ?? "Someone"} shared a page with you`,
    body: text(params.itemTitle),
  }),
  "access.requested": ({ params }) => ({
    title: `${text(params.requesterName)} asks for access`,
    body: text(params.itemTitle) || text(params.spaceName),
  }),
  "access.requestDecided": ({ params }) => ({
    title:
      params.decision === "declined"
        ? "Your access request was declined"
        : "Your access request was approved",
    body:
      params.decision === "declined"
        ? text(params.spaceName)
        : text(params.itemTitle) || text(params.spaceName),
  }),
  "comment.created": ({ params, actor, actorCount }) => ({
    title: `${together(actor, actorCount, "en")} commented`,
    body: text(params.itemTitle),
  }),
  "content.changed": ({ params, actor, actorCount }) => ({
    title: actorCount === 0 ? "Content changed" : `${together(actor, actorCount, "en")} made changes`,
    body: text(params.itemTitle),
  }),
  "blogPost.published": ({ params }) => ({
    title: `New post in ${text(params.spaceName)}`,
    body: text(params.itemTitle),
  }),
  "blogPost.scheduleHeld": ({ params }) => ({
    title: "A scheduled post is waiting for approval",
    body: text(params.itemTitle),
  }),
  "page.statusChanged": ({ params, actor }) => ({
    title: `${actor ?? "Someone"} changed the status`,
    body: text(params.itemTitle),
  }),
  "ownership.transferred": ({ params, actor }) => ({
    title: `${actor ?? "Someone"} changed the owner`,
    body: text(params.itemTitle),
  }),
  "ownership.orphaned": ({ params }) => ({
    title: "Content without an owner",
    body: text(params.spaceName),
  }),
  "restriction.orphaned": ({ params }) => ({
    title: "A restricted page has nobody with access",
    body: text(params.itemTitle),
  }),
  "space.confidentialWithoutAdministrator": ({ params }) => ({
    title: "A confidential space has no space admin",
    body: text(params.spaceKey),
  }),
  "space.personalWithoutAdministrator": ({ params }) => ({
    title: "A personal space has no space admin",
    body: text(params.spaceKey),
  }),
  "space.memberAddedByAdministration": ({ params }) => ({
    title: "The administration added someone to a space",
    body: `${text(params.memberName)} · ${text(params.spaceName)}`,
  }),
  "space.memberRemovedByAdministration": ({ params }) => ({
    title: "The administration removed someone from a space",
    body: `${text(params.memberName)} · ${text(params.spaceName)}`,
  }),
  "space.administratorAppointed": ({ params }) => ({
    title: "You are now space admin",
    body: text(params.spaceName),
  }),
  "article.reviewDue": ({ params }) => ({
    title: "An article is due for review",
    body: text(params.itemTitle),
  }),
  "article.sourceChanged": ({ params }) => ({
    title: "A source page of an article changed",
    body: text(params.itemTitle),
  }),
  "meeting.reminder": ({ params }) => ({
    title: "Add your topics before the meeting",
    body: text(params.seriesTitle),
  }),
  "meeting.notesAvailable": ({ params }) => ({
    title: "Meeting notes are available",
    body: text(params.itemTitle),
  }),
  "oneOnOne.started": ({ params, actor }) => ({
    title: `${actor ?? "Someone"} started a one-on-one with you`,
    body: text(params.itemTitle),
  }),
  "import.finished": ({ params }) => ({ title: "Import ready for review", body: text(params.spaceName) }),
  "import.failed": ({ params }) => ({ title: "Import failed", body: text(params.spaceName) }),
  "import.held": ({ params }) => ({ title: "Import paused", body: text(params.spaceKey) }),
  "export.ready": ({ params }) => ({ title: "Export ready to download", body: text(params.name) }),
  "export.failed": ({ params }) => ({ title: "Export failed", body: text(params.name) }),
  "copy.finished": ({ params }) => ({ title: "Copy ready", body: text(params.itemTitle) }),
  "copy.failed": ({ params }) => ({ title: "Copy failed", body: text(params.itemTitle) }),
  "chatChannel.failing": ({ params }) => ({
    title: "A chat channel stopped accepting messages",
    body: text(params.channelName),
  }),
  "apiToken.expiring": ({ params }) => ({ title: "An API token expires soon", body: text(params.tokenName) }),
  "apiToken.unused": ({ params }) => ({ title: "An API token is not used", body: text(params.tokenName) }),
  "guest.expiring": ({ params }) => ({ title: "Guest access ends soon", body: text(params.guestName) }),
  "guest.inactive": ({ params }) => ({ title: "A guest is inactive", body: text(params.guestName) }),
  "access.expiring": ({ params }) => ({ title: "Access ends soon", body: text(params.name) }),
  "serviceAccount.unattended": ({ params }) => ({
    title: "A service account has nobody responsible",
    body: text(params.serviceAccountName),
  }),
  "breakGlass.started": ({ params }) => ({
    title: "Break-glass access started",
    body: text(params.requesterName),
  }),
  "space.administratorTaken": ({ params }) => ({
    title: "An administrator became space admin",
    body: `${text(params.actorName)} · ${text(params.spaceName)}`,
  }),
  "auth.emergencySignIn": ({ params }) => ({
    title: "Emergency sign-in used",
    body: text(params.accountName),
  }),
  "account.rolesWithheld": ({ params }) => ({
    title: "Administrative roles paused",
    body: text(params.accountName),
  }),
  "account.withoutOrganization": ({ params }) => ({
    title: "New account without an organization",
    body: text(params.accountName),
  }),
  "account.homeOrganizationChanged": ({ params }) => ({
    title: "Home organization changed",
    body: text(params.accountName),
  }),
  "mail.credentialExpiring": () => ({
    title: "The e-mail credential expires soon",
    body: "Microsoft Graph",
  }),
  "storage.levelReached": ({ params }) => ({
    title: params.level === 3 ? "Storage is almost full" : "Storage is filling up",
    body: `${Math.round(Number(params.percent) || 0)} %`,
  }),
  "storage.levelCleared": ({ params }) => ({
    title: params.level === 0 ? "Storage usage is back to normal" : "Storage usage has fallen",
    body: `${Math.round(Number(params.percent) || 0)} %`,
  }),
  "backup.failed": ({ params }) => ({ title: "A backup failed", body: text(params.reason) }),
  "backup.missing": ({ params }) => ({
    title: "No recent backup",
    body: `${Number(params.days) || 0} days without a successful backup`,
  }),
  "backup.recovered": () => ({ title: "Backups work again", body: "The last backup succeeded." }),
  "backup.testRestoreFailed": ({ params }) => ({
    title: "A test restore failed",
    body: text(params.backupName),
  }),
  "identityProvider.credentialExpiring": ({ params }) => ({
    title: "A sign-in provider credential expires soon",
    body: text(params.providerName),
  }),
  "identityProvider.syncHeld": ({ params }) => ({
    title: "Directory synchronization stopped",
    body: text(params.providerName),
  }),
  "signIn.newBrowser": ({ params }) => ({
    title: "Signed in from a new browser",
    body: [text(params.browser), text(params.operatingSystem)].filter(Boolean).join(", "),
  }),
};

const de: Texts = {
  "content.mentioned": ({ params, actor }) => ({
    title: `${actor ?? "Jemand"} hat dich erwähnt`,
    body: text(params.itemTitle),
  }),
  "task.assigned": ({ params }) => ({
    title: `Neue Aufgabe in ${text(params.itemTitle)}`,
    body: text(params.taskText),
  }),
  "page.shared": ({ params, actor }) => ({
    title: `${actor ?? "Jemand"} hat eine Seite mit dir geteilt`,
    body: text(params.itemTitle),
  }),
  "access.requested": ({ params }) => ({
    title: `${text(params.requesterName)} bittet um Zugriff`,
    body: text(params.itemTitle) || text(params.spaceName),
  }),
  "access.requestDecided": ({ params }) => ({
    title:
      params.decision === "declined"
        ? "Deine Zugriffsanfrage wurde abgelehnt"
        : "Deine Zugriffsanfrage wurde genehmigt",
    body:
      params.decision === "declined"
        ? text(params.spaceName)
        : text(params.itemTitle) || text(params.spaceName),
  }),
  "comment.created": ({ params, actor, actorCount }) => ({
    title: `${together(actor, actorCount, "de")} ${actorCount > 1 ? "haben" : "hat"} kommentiert`,
    body: text(params.itemTitle),
  }),
  "content.changed": ({ params, actor, actorCount }) => ({
    title:
      actorCount === 0
        ? "Inhalt geändert"
        : `${together(actor, actorCount, "de")} ${actorCount > 1 ? "haben" : "hat"} Änderungen vorgenommen`,
    body: text(params.itemTitle),
  }),
  "blogPost.published": ({ params }) => ({
    title: `Neuer Beitrag in ${text(params.spaceName)}`,
    body: text(params.itemTitle),
  }),
  "blogPost.scheduleHeld": ({ params }) => ({
    title: "Ein geplanter Beitrag wartet auf Freigabe",
    body: text(params.itemTitle),
  }),
  "page.statusChanged": ({ params, actor }) => ({
    title: `${actor ?? "Jemand"} hat den Status geändert`,
    body: text(params.itemTitle),
  }),
  "ownership.transferred": ({ params, actor }) => ({
    title: `${actor ?? "Jemand"} hat den Besitzer geändert`,
    body: text(params.itemTitle),
  }),
  "ownership.orphaned": ({ params }) => ({
    title: "Inhalte ohne Besitzer",
    body: text(params.spaceName),
  }),
  "restriction.orphaned": ({ params }) => ({
    title: "Niemand hat mehr Zugriff auf eine beschränkte Seite",
    body: text(params.itemTitle),
  }),
  "space.confidentialWithoutAdministrator": ({ params }) => ({
    title: "Ein vertraulicher Space hat keinen Space-Admin",
    body: text(params.spaceKey),
  }),
  "space.personalWithoutAdministrator": ({ params }) => ({
    title: "Ein persönlicher Space hat keinen Space-Admin",
    body: text(params.spaceKey),
  }),
  "space.memberAddedByAdministration": ({ params }) => ({
    title: "Die Verwaltung hat jemanden zu einem Space hinzugefügt",
    body: `${text(params.memberName)} · ${text(params.spaceName)}`,
  }),
  "space.memberRemovedByAdministration": ({ params }) => ({
    title: "Die Verwaltung hat jemanden aus einem Space entfernt",
    body: `${text(params.memberName)} · ${text(params.spaceName)}`,
  }),
  "space.administratorAppointed": ({ params }) => ({
    title: "Du bist jetzt Space-Admin",
    body: text(params.spaceName),
  }),
  "article.reviewDue": ({ params }) => ({
    title: "Ein Artikel ist zur Überprüfung fällig",
    body: text(params.itemTitle),
  }),
  "article.sourceChanged": ({ params }) => ({
    title: "Eine Quellseite eines Artikels wurde geändert",
    body: text(params.itemTitle),
  }),
  "meeting.reminder": ({ params }) => ({
    title: "Trag deine Themen vor der Besprechung ein",
    body: text(params.seriesTitle),
  }),
  "meeting.notesAvailable": ({ params }) => ({
    title: "Besprechungsnotizen sind verfügbar",
    body: text(params.itemTitle),
  }),
  "oneOnOne.started": ({ params, actor }) => ({
    title: `${actor ?? "Jemand"} hat ein 1:1 mit dir gestartet`,
    body: text(params.itemTitle),
  }),
  "import.finished": ({ params }) => ({ title: "Import bereit zur Prüfung", body: text(params.spaceName) }),
  "import.failed": ({ params }) => ({ title: "Import fehlgeschlagen", body: text(params.spaceName) }),
  "import.held": ({ params }) => ({ title: "Import angehalten", body: text(params.spaceKey) }),
  "export.ready": ({ params }) => ({ title: "Export bereit zum Herunterladen", body: text(params.name) }),
  "export.failed": ({ params }) => ({ title: "Export fehlgeschlagen", body: text(params.name) }),
  "copy.finished": ({ params }) => ({ title: "Kopie fertig", body: text(params.itemTitle) }),
  "copy.failed": ({ params }) => ({ title: "Kopieren fehlgeschlagen", body: text(params.itemTitle) }),
  "chatChannel.failing": ({ params }) => ({
    title: "Ein Chat-Kanal nimmt keine Nachrichten mehr an",
    body: text(params.channelName),
  }),
  "apiToken.expiring": ({ params }) => ({
    title: "Ein API-Token läuft bald ab",
    body: text(params.tokenName),
  }),
  "apiToken.unused": ({ params }) => ({
    title: "Ein API-Token wird nicht verwendet",
    body: text(params.tokenName),
  }),
  "guest.expiring": ({ params }) => ({ title: "Ein Gastzugang endet bald", body: text(params.guestName) }),
  "guest.inactive": ({ params }) => ({ title: "Ein Gast ist inaktiv", body: text(params.guestName) }),
  "access.expiring": ({ params }) => ({ title: "Ein Zugriff endet bald", body: text(params.name) }),
  "serviceAccount.unattended": ({ params }) => ({
    title: "Für ein Dienstkonto ist niemand verantwortlich",
    body: text(params.serviceAccountName),
  }),
  "breakGlass.started": ({ params }) => ({
    title: "Notfallzugriff begonnen",
    body: text(params.requesterName),
  }),
  "space.administratorTaken": ({ params }) => ({
    title: "Ein Administrator ist Space-Admin geworden",
    body: `${text(params.actorName)} · ${text(params.spaceName)}`,
  }),
  "auth.emergencySignIn": ({ params }) => ({
    title: "Notfall-Anmeldung verwendet",
    body: text(params.accountName),
  }),
  "account.rolesWithheld": ({ params }) => ({
    title: "Administrative Rollen ausgesetzt",
    body: text(params.accountName),
  }),
  "account.withoutOrganization": ({ params }) => ({
    title: "Neues Konto ohne Organisation",
    body: text(params.accountName),
  }),
  "account.homeOrganizationChanged": ({ params }) => ({
    title: "Heimatorganisation geändert",
    body: text(params.accountName),
  }),
  "mail.credentialExpiring": () => ({
    title: "Die E-Mail-Zugangsdaten laufen bald ab",
    body: "Microsoft Graph",
  }),
  "storage.levelReached": ({ params }) => ({
    title: params.level === 3 ? "Der Speicher ist fast voll" : "Der Speicher füllt sich",
    body: `${Math.round(Number(params.percent) || 0)} %`,
  }),
  "storage.levelCleared": ({ params }) => ({
    title:
      params.level === 0 ? "Die Speicherbelegung ist wieder normal" : "Die Speicherbelegung ist gesunken",
    body: `${Math.round(Number(params.percent) || 0)} %`,
  }),
  "backup.failed": ({ params }) => ({ title: "Ein Backup ist fehlgeschlagen", body: text(params.reason) }),
  "backup.missing": ({ params }) => ({
    title: "Kein aktuelles Backup",
    body: `${Number(params.days) || 0} Tage ohne erfolgreiches Backup`,
  }),
  "backup.recovered": () => ({
    title: "Backups funktionieren wieder",
    body: "Das letzte Backup ist gelungen.",
  }),
  "backup.testRestoreFailed": ({ params }) => ({
    title: "Eine Test-Wiederherstellung ist fehlgeschlagen",
    body: text(params.backupName),
  }),
  "identityProvider.credentialExpiring": ({ params }) => ({
    title: "Zugangsdaten eines Anmeldeanbieters laufen bald ab",
    body: text(params.providerName),
  }),
  "identityProvider.syncHeld": ({ params }) => ({
    title: "Verzeichnissynchronisierung angehalten",
    body: text(params.providerName),
  }),
  "signIn.newBrowser": ({ params }) => ({
    title: "In einem neuen Browser angemeldet",
    body: [text(params.browser), text(params.operatingSystem)].filter(Boolean).join(", "),
  }),
};

const catalogs: Record<Language, Texts> = { en, de };

export function pushTypes(language: Language): string[] {
  return Object.keys(catalogs[language]);
}

export function pushText(type: string, language: Language, input: PushTextInput): PushText {
  const render = catalogs[language][type];
  if (!render) return { title: language === "de" ? "Neue Benachrichtigung" : "New notification", body: "" };
  return render(input);
}
