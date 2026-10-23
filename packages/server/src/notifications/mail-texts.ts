import type { ContentNotificationType } from "@lunedo/shared";
import type { Language } from "../mail/templates.js";

export interface LineContext {
  actor: string | null;
  actorCount: number;
  count: number;
  own: boolean;
  date(instant: string): string;
  dateTime(instant: string): string;
}

type Params = Record<string, unknown>;
type Line = (params: Params, context: LineContext) => string;

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const number = (value: unknown): number => (typeof value === "number" ? value : 0);

const BUILT_IN_STATUS: Record<Language, Record<string, string>> = {
  en: {
    roughDraft: "Rough draft",
    inProgress: "In progress",
    readyForReview: "Ready for review",
    verified: "Verified",
  },
  de: {
    roughDraft: "Rohentwurf",
    inProgress: "In Arbeit",
    readyForReview: "Bereit zur Prüfung",
    verified: "Geprüft",
  },
};

function statusOf(language: Language, params: Params): string | null {
  if (typeof params.statusName === "string") return params.statusName;
  if (typeof params.statusBuiltIn === "string") {
    return BUILT_IN_STATUS[language][params.statusBuiltIn] ?? params.statusBuiltIn;
  }
  return null;
}

function people(language: Language, context: LineContext): string {
  const actor = context.actor ?? (language === "de" ? "Jemand" : "Someone");
  const others = Math.max(context.actorCount - 1, 0);
  if (others === 0) return actor;
  if (language === "de")
    return `${actor} und ${others === 1 ? "1 weitere Person" : `${others} weitere Personen`}`;
  return `${actor} and ${others === 1 ? "1 other" : `${others} others`}`;
}

function plural(language: Language, context: LineContext): boolean {
  return language === "de" && context.actorCount > 1;
}

const english: Record<ContentNotificationType, Line> = {
  "content.mentioned": (p, c) => `${people("en", c)} mentioned you in ${text(p.itemTitle)}`,
  "task.assigned": (p) => `You were assigned a task in ${text(p.itemTitle)}`,
  "blogPost.scheduleHeld": (p, c) =>
    p.reason === "accountRemoved"
      ? `The scheduled post ${text(p.itemTitle)} is waiting for approval because the person who scheduled it no longer has an account.`
      : `The scheduled post ${text(p.itemTitle)} is waiting for approval because ${c.actor ?? "its author"} can no longer edit it.`,
  "page.shared": (p, c) =>
    `${people("en", c)} shared ${text(p.itemTitle)} with you: ${
      p.role === "editor"
        ? "you can edit it"
        : p.role === "commenter"
          ? "you can read and comment"
          : "you can read it"
    }${p.includeDescendants === true ? " together with its pages" : ""}.`,
  "comment.created": (p, c) =>
    c.actorCount === 0
      ? `Someone commented on ${text(p.itemTitle)}`
      : `${people("en", c)} commented on ${text(p.itemTitle)}`,
  "content.changed": (p, c) =>
    c.actorCount === 0
      ? `${text(p.itemTitle)} was changed`
      : `${people("en", c)} changed ${text(p.itemTitle)}`,
  "ownership.transferred": (p, c) =>
    c.own
      ? `${people("en", c)} made you the owner of ${text(p.itemTitle)}`
      : `${people("en", c)} gave ${text(p.itemTitle)} a new owner`,
  "page.statusChanged": (p, c) => {
    const status = statusOf("en", p);
    return status
      ? `${people("en", c)} set the status of ${text(p.itemTitle)} to ${status}`
      : `${people("en", c)} removed the status of ${text(p.itemTitle)}`;
  },
  "access.requested": (p) =>
    p.target === "page"
      ? `${text(p.requesterName)} asks for access to ${text(p.itemTitle)} in ${text(p.spaceName)}`
      : `${text(p.requesterName)} asks for access to the space ${text(p.spaceName)}`,
  "access.requestDecided": (p) => {
    const what = p.target === "page" ? text(p.itemTitle) : text(p.spaceName);
    if (p.decision === "approved") return `Your request for access to ${what} was approved.`;
    if (p.decision === "satisfied") return `You now have access to ${what}, so your request was closed.`;
    return `Your request for access to ${p.target === "page" ? "a page" : text(p.spaceName)} was declined.`;
  },
  "restriction.orphaned": (p) =>
    `Nobody on the access list of the restricted page ${text(p.itemTitle)} in ${text(p.spaceName)} has an active account anymore. Review the restriction in the space settings.`,
  "ownership.orphaned": (p) => {
    const items = number(p.items);
    return `${items === 1 ? "1 item" : `${items} items`} in ${text(p.spaceName)} no longer ${items === 1 ? "has" : "have"} an owner, because the owner left. Assign new owners in the space settings.`;
  },
  "space.confidentialWithoutAdministrator": (p) =>
    `The confidential space ${text(p.spaceKey)} has no space admin anymore. You can appoint one of its remaining members.`,
  "blogPost.published": (p) => `New post in ${text(p.spaceName)}: ${text(p.itemTitle)}`,
  "article.reviewDue": (p, c) =>
    `The article ${text(p.itemTitle)} is due for review on ${c.date(text(p.dueAt))}. Check that it is still correct and mark it as reviewed.`,
  "article.sourceChanged": (p) =>
    `A source page of the article ${text(p.itemTitle)} was changed. Check whether the article needs an update and mark it as reviewed.`,
  "meeting.reminder": (p, c) =>
    `${text(p.seriesTitle)} on ${c.dateTime(text(p.startsAt))}: add your topics before the meeting so others can prepare.`,
  "meeting.notesAvailable": (p, c) =>
    `${c.actor ?? "Someone"} closed ${text(p.itemTitle)}. The notes are available.`,
  "import.finished": (p) => {
    const problems = number(p.problems);
    return `The import into ${text(p.spaceName)} (${text(p.spaceKey)}) is ready for review. ${
      problems === 0
        ? "Nothing needs attention."
        : problems === 1
          ? "1 item needs attention."
          : `${problems} items need attention.`
    }`;
  },
  "import.failed": (p) =>
    `The import into ${text(p.spaceName)} (${text(p.spaceKey)}) failed. Open it to see why and what to do.`,
  "import.held": (p) =>
    `The import into the space ${text(p.spaceKey)} paused because its administrator can no longer import. You can take it over.`,
  "export.ready": (p, c) =>
    `Your export of ${text(p.name)} is ready to download until ${c.dateTime(text(p.expiresAt))}.`,
  "export.failed": (p) =>
    `Your export of ${text(p.name)} failed. Open your exports to see why and what to do.`,
  "copy.finished": (p) => {
    const left = Number(p.hidden) + Number(p.skipped);
    return `Your copy ${text(p.itemTitle)} is ready in the space ${text(p.spaceKey)}.${
      left > 0 ? ` ${left === 1 ? "1 item was" : `${left} items were`} not copied.` : ""
    }`;
  },
  "copy.failed": (p) =>
    `Copying ${text(p.itemTitle)} failed and nothing was created. Start the copy again; if it fails again, ask your administrator.`,
  "oneOnOne.started": (p, c) =>
    `${c.actor ?? "Someone"} started a one-on-one with you: ${text(p.itemTitle)}.`,
  "chatChannel.failing": (p) =>
    `The chat channel ${text(p.channelName)} stopped accepting messages, so nothing is posted there. Open its settings to see why and fix it.`,
};

const german: Record<ContentNotificationType, Line> = {
  "content.mentioned": (p, c) =>
    `${people("de", c)} ${plural("de", c) ? "haben" : "hat"} dich in ${text(p.itemTitle)} erwähnt`,
  "task.assigned": (p) => `Dir wurde in ${text(p.itemTitle)} eine Aufgabe zugewiesen`,
  "blogPost.scheduleHeld": (p, c) =>
    p.reason === "accountRemoved"
      ? `Der geplante Beitrag ${text(p.itemTitle)} wartet auf Freigabe, weil die Person, die ihn geplant hat, kein Konto mehr hat.`
      : `Der geplante Beitrag ${text(p.itemTitle)} wartet auf Freigabe, weil ${c.actor ?? "die Person, die ihn geplant hat,"} ihn nicht mehr bearbeiten kann.`,
  "page.shared": (p, c) =>
    `${people("de", c)} ${plural("de", c) ? "haben" : "hat"} ${text(p.itemTitle)} für dich freigegeben: ${
      p.role === "editor"
        ? "Du kannst die Seite bearbeiten"
        : p.role === "commenter"
          ? "Du kannst sie lesen und kommentieren"
          : "Du kannst sie lesen"
    }${p.includeDescendants === true ? ", mitsamt ihren Unterseiten" : ""}.`,
  "comment.created": (p, c) =>
    c.actorCount === 0
      ? `Jemand hat ${text(p.itemTitle)} kommentiert`
      : `${people("de", c)} ${plural("de", c) ? "haben" : "hat"} ${text(p.itemTitle)} kommentiert`,
  "content.changed": (p, c) =>
    c.actorCount === 0
      ? `${text(p.itemTitle)} wurde geändert`
      : `${people("de", c)} ${plural("de", c) ? "haben" : "hat"} ${text(p.itemTitle)} geändert`,
  "ownership.transferred": (p, c) =>
    c.own
      ? `${people("de", c)} hat dich zum Besitzer von ${text(p.itemTitle)} gemacht`
      : `${people("de", c)} hat ${text(p.itemTitle)} einen neuen Besitzer gegeben`,
  "page.statusChanged": (p, c) => {
    const status = statusOf("de", p);
    return status
      ? `${people("de", c)} hat den Status von ${text(p.itemTitle)} auf ${status} gesetzt`
      : `${people("de", c)} hat den Status von ${text(p.itemTitle)} entfernt`;
  },
  "access.requested": (p) =>
    p.target === "page"
      ? `${text(p.requesterName)} bittet um Zugriff auf ${text(p.itemTitle)} in ${text(p.spaceName)}`
      : `${text(p.requesterName)} bittet um Zugriff auf den Space ${text(p.spaceName)}`,
  "access.requestDecided": (p) => {
    const what = p.target === "page" ? text(p.itemTitle) : text(p.spaceName);
    if (p.decision === "approved") return `Deine Anfrage für ${what} wurde genehmigt.`;
    if (p.decision === "satisfied")
      return `Du hast jetzt Zugriff auf ${what}, deine Anfrage wurde deshalb geschlossen.`;
    return `Deine Anfrage für ${p.target === "page" ? "eine Seite" : text(p.spaceName)} wurde abgelehnt.`;
  },
  "restriction.orphaned": (p) =>
    `Niemand auf der Zugriffsliste der beschränkten Seite ${text(p.itemTitle)} in ${text(p.spaceName)} hat noch ein aktives Konto. Prüfe die Beschränkung in den Space-Einstellungen.`,
  "ownership.orphaned": (p) => {
    const items = number(p.items);
    return `${items === 1 ? "1 Inhalt" : `${items} Inhalte`} in ${text(p.spaceName)} ${items === 1 ? "hat" : "haben"} keinen Besitzer mehr, weil der Besitzer gegangen ist. Weise in den Space-Einstellungen neue Besitzer zu.`;
  },
  "space.confidentialWithoutAdministrator": (p) =>
    `Der vertrauliche Space ${text(p.spaceKey)} hat keinen Space-Admin mehr. Du kannst eines der verbliebenen Mitglieder ernennen.`,
  "blogPost.published": (p) => `Neuer Beitrag in ${text(p.spaceName)}: ${text(p.itemTitle)}`,
  "article.reviewDue": (p, c) =>
    `Der Artikel ${text(p.itemTitle)} ist am ${c.date(text(p.dueAt))} zur Überprüfung fällig. Prüfe, ob er noch stimmt, und markiere ihn als geprüft.`,
  "article.sourceChanged": (p) =>
    `Eine Quellseite des Artikels ${text(p.itemTitle)} wurde geändert. Prüfe, ob der Artikel angepasst werden muss, und markiere ihn als geprüft.`,
  "meeting.reminder": (p, c) =>
    `${text(p.seriesTitle)} am ${c.dateTime(text(p.startsAt))}: Trag deine Themen vor der Besprechung ein, damit sich alle vorbereiten können.`,
  "meeting.notesAvailable": (p, c) =>
    `${c.actor ?? "Jemand"} hat ${text(p.itemTitle)} geschlossen. Die Notizen sind verfügbar.`,
  "import.finished": (p) => {
    const problems = number(p.problems);
    return `Der Import in ${text(p.spaceName)} (${text(p.spaceKey)}) ist bereit zur Prüfung. ${
      problems === 0
        ? "Nichts ist zu prüfen."
        : problems === 1
          ? "1 Punkt ist zu prüfen."
          : `${problems} Punkte sind zu prüfen.`
    }`;
  },
  "import.failed": (p) =>
    `Der Import in ${text(p.spaceName)} (${text(p.spaceKey)}) ist fehlgeschlagen. Öffne ihn, um Grund und nächste Schritte zu sehen.`,
  "import.held": (p) =>
    `Der Import in den Space ${text(p.spaceKey)} ist angehalten, weil die Person, die ihn gestartet hat, nicht mehr importieren darf. Du kannst ihn übernehmen.`,
  "export.ready": (p, c) =>
    `Dein Export von ${text(p.name)} steht bis ${c.dateTime(text(p.expiresAt))} zum Herunterladen bereit.`,
  "export.failed": (p) =>
    `Dein Export von ${text(p.name)} ist fehlgeschlagen. Öffne deine Exporte, um zu sehen, warum und was zu tun ist.`,
  "copy.finished": (p) => {
    const left = Number(p.hidden) + Number(p.skipped);
    return `Deine Kopie ${text(p.itemTitle)} ist im Space ${text(p.spaceKey)} fertig.${
      left > 0 ? ` ${left === 1 ? "1 Element wurde" : `${left} Elemente wurden`} nicht kopiert.` : ""
    }`;
  },
  "copy.failed": (p) =>
    `Das Kopieren von ${text(p.itemTitle)} ist fehlgeschlagen, es wurde nichts angelegt. Starte die Kopie erneut; schlägt sie wieder fehl, wende dich an deine Administration.`,
  "oneOnOne.started": (p, c) =>
    `${c.actor ?? "Jemand"} hat ein 1:1 mit dir gestartet: ${text(p.itemTitle)}.`,
  "chatChannel.failing": (p) =>
    `Der Chat-Kanal ${text(p.channelName)} nimmt keine Nachrichten mehr an, deshalb wird dort nichts gepostet. Öffne seine Einstellungen, um den Grund zu sehen und ihn zu beheben.`,
};

const lines: Record<Language, Record<string, Line>> = { en: english, de: german };

export function contentLine(
  language: Language,
  type: string,
  params: Params,
  context: LineContext,
): string | null {
  const line = lines[language][type];
  return line ? line(params, context) : null;
}

export interface MailWording {
  digestSubject(instanceName: string, count: number): string;
  digestIntro(count: number): string;
  otherSection: string;
  open: string;
  changes(count: number): string;
  unsubscribeEvent: string;
  unsubscribeDigest: string;
}

export const mailWording: Record<Language, MailWording> = {
  en: {
    digestSubject: (instanceName, count) =>
      `Your daily summary from ${instanceName}: ${count === 1 ? "1 notification" : `${count} notifications`}`,
    digestIntro: (count) =>
      `${count === 1 ? "This is what happened" : "These things happened"} since your last summary, newest first.`,
    otherSection: "Other notifications",
    open: "Open",
    changes: (count) => `${count} times`,
    unsubscribeEvent: "Stop e-mails like this",
    unsubscribeDigest: "Stop the daily summary",
  },
  de: {
    digestSubject: (instanceName, count) =>
      `Deine tägliche Zusammenfassung von ${instanceName}: ${count === 1 ? "1 Benachrichtigung" : `${count} Benachrichtigungen`}`,
    digestIntro: () => "Das ist seit deiner letzten Zusammenfassung passiert, das Neueste zuerst.",
    otherSection: "Weitere Benachrichtigungen",
    open: "Öffnen",
    changes: (count) => `${count}-mal`,
    unsubscribeEvent: "Solche E-Mails abbestellen",
    unsubscribeDigest: "Tägliche Zusammenfassung abbestellen",
  },
};

export function excerptOf(value: string, length = 200): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > length ? `${single.slice(0, length - 1).trimEnd()}…` : single;
}
