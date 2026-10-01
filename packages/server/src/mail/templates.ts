import type { supportedLanguages } from "../settings/builtin.js";
import type { MailMessage } from "./transport.js";

export type Language = (typeof supportedLanguages)[number];

export interface MailTemplates {
  passwordReset: { instanceName: string; link: string; minutes: number };
  emailChangeConfirmation: { instanceName: string; link: string; hours: number };
  emailChangeAddressInUse: { instanceName: string };
  emailChangeNotice: { instanceName: string; newEmail: string };
  recoveryCodeUsed: { instanceName: string; remaining: number };
  smtpTest: { instanceName: string };
  invitation: {
    instanceName: string;
    organizationName: string;
    inviterName: string;
    link: string;
    days: number;
  };
  registration: { instanceName: string; organizationName: string; link: string; hours: number };
  breakGlassStarted: {
    instanceName: string;
    organizationName: string;
    requesterName: string;
    reason: string;
    minutes: number;
  };
  guestExpiring: { instanceName: string; organizationName: string; guestName: string; date: string };
  guestInactive: { instanceName: string; organizationName: string; guestName: string; days: number };
  tokenExpiring: { instanceName: string; tokenName: string; date: string };
  serviceAccountUnattended: { instanceName: string; serviceAccountName: string; organizationName: string };
  accessExpiring: {
    instanceName: string;
    organizationName: string;
    kind: "role" | "group" | "membership";
    name: string;
    date: string;
  };
}

export type MailTemplate = keyof MailTemplates;

interface Content {
  subject: string;
  paragraphs: string[];
  action?: { label: string; url: string };
}

type Catalog = { [K in MailTemplate]: (params: MailTemplates[K]) => Content };

const IGNORE_EN = "If you did not ask for this, you can ignore this e-mail.";
const IGNORE_DE = "Wenn Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren.";
const NOT_YOU_EN = "If this was not you, contact your administrator immediately.";
const NOT_YOU_DE = "Wenn Sie das nicht waren, wenden Sie sich sofort an Ihre Administration.";

const catalogs: Record<Language, Catalog> = {
  en: {
    passwordReset: ({ instanceName, link, minutes }) => ({
      subject: `Reset your password for ${instanceName}`,
      paragraphs: [
        `Someone asked to reset the password of your account on ${instanceName}.`,
        `The link works once and expires in ${minutes} minutes.`,
        IGNORE_EN,
      ],
      action: { label: "Reset password", url: link },
    }),
    emailChangeConfirmation: ({ instanceName, link, hours }) => ({
      subject: `Confirm your new e-mail address for ${instanceName}`,
      paragraphs: [
        `Confirm that this address should be used for your account on ${instanceName}.`,
        `The link works once and expires in ${hours} hours.`,
        IGNORE_EN,
      ],
      action: { label: "Confirm address", url: link },
    }),
    emailChangeAddressInUse: ({ instanceName }) => ({
      subject: `E-mail address already in use on ${instanceName}`,
      paragraphs: [
        `Someone asked to use this address for an account on ${instanceName}, but another account already uses it. Nothing was changed.`,
        IGNORE_EN,
      ],
    }),
    emailChangeNotice: ({ instanceName, newEmail }) => ({
      subject: `Your e-mail address on ${instanceName} was changed`,
      paragraphs: [
        `The e-mail address of your account on ${instanceName} was changed to ${newEmail}. This address no longer receives e-mails for the account.`,
        NOT_YOU_EN,
      ],
    }),
    recoveryCodeUsed: ({ instanceName, remaining }) => ({
      subject: `A recovery code was used for ${instanceName}`,
      paragraphs: [
        `A recovery code was used to sign in to your account on ${instanceName}. ${remaining} unused codes are left.`,
        NOT_YOU_EN,
      ],
    }),
    smtpTest: ({ instanceName }) => ({
      subject: `Test e-mail from ${instanceName}`,
      paragraphs: [`${instanceName} can send e-mail with these settings.`],
    }),
    invitation: ({ instanceName, organizationName, inviterName, link, days }) => ({
      subject: `${inviterName} invited you to ${organizationName} on ${instanceName}`,
      paragraphs: [
        `${inviterName} invited you to join ${organizationName} on ${instanceName}.`,
        `The link works once and expires in ${days} days.`,
        IGNORE_EN,
      ],
      action: { label: "Accept invitation", url: link },
    }),
    registration: ({ instanceName, organizationName, link, hours }) => ({
      subject: `Confirm your registration for ${organizationName} on ${instanceName}`,
      paragraphs: [
        `Confirm this address to create your account in ${organizationName} on ${instanceName}.`,
        `The link works once and expires in ${hours} hours.`,
        IGNORE_EN,
      ],
      action: { label: "Create account", url: link },
    }),
    breakGlassStarted: ({ instanceName, organizationName, requesterName, reason, minutes }) => ({
      subject: `Emergency access to ${organizationName} on ${instanceName}`,
      paragraphs: [
        `${requesterName} started emergency access to ${organizationName} with administrator rights for ${minutes} minutes.`,
        `Reason: ${reason}`,
        "Every action during the access is recorded in the audit log.",
      ],
    }),
    guestExpiring: ({ instanceName, organizationName, guestName, date }) => ({
      subject: `Guest access of ${guestName} to ${organizationName} expires soon`,
      paragraphs: [
        `The guest access of ${guestName} to ${organizationName} on ${instanceName} expires on ${date}. You are responsible for this guest.`,
      ],
    }),
    guestInactive: ({ instanceName, organizationName, guestName, days }) => ({
      subject: `Guest ${guestName} has been inactive in ${organizationName}`,
      paragraphs: [
        `${guestName} has not used ${instanceName} for ${days} days. You are responsible for this guest in ${organizationName}; remove the guest if the access is no longer needed.`,
      ],
    }),
    serviceAccountUnattended: ({ instanceName, serviceAccountName, organizationName }) => ({
      subject: `Service account ${serviceAccountName} in ${organizationName} has no responsible person`,
      paragraphs: [
        `The last responsible person of the service account ${serviceAccountName} in ${organizationName} on ${instanceName} left or was deactivated. The service account keeps its permissions. Name a new responsible person or deactivate it.`,
      ],
    }),
    tokenExpiring: ({ instanceName, tokenName, date }) => ({
      subject: `API token ${tokenName} on ${instanceName} expires soon`,
      paragraphs: [
        `The API token ${tokenName} on ${instanceName} expires on ${date}. Create a new token before then, or scripts using it will stop working.`,
      ],
    }),
    accessExpiring: ({ instanceName, organizationName, kind, name, date }) => ({
      subject: `Access in ${organizationName} expires soon`,
      paragraphs: [
        `${kind === "role" ? `The role ${name}` : kind === "group" ? `The membership in the group ${name}` : "The membership"} in ${organizationName} on ${instanceName} expires on ${date}.`,
      ],
    }),
  },
  de: {
    passwordReset: ({ instanceName, link, minutes }) => ({
      subject: `Passwort für ${instanceName} zurücksetzen`,
      paragraphs: [
        `Für Ihr Konto auf ${instanceName} wurde das Zurücksetzen des Passworts angefordert.`,
        `Der Link funktioniert einmal und läuft in ${minutes} Minuten ab.`,
        IGNORE_DE,
      ],
      action: { label: "Passwort zurücksetzen", url: link },
    }),
    emailChangeConfirmation: ({ instanceName, link, hours }) => ({
      subject: `Neue E-Mail-Adresse für ${instanceName} bestätigen`,
      paragraphs: [
        `Bestätigen Sie, dass diese Adresse für Ihr Konto auf ${instanceName} verwendet werden soll.`,
        `Der Link funktioniert einmal und läuft in ${hours} Stunden ab.`,
        IGNORE_DE,
      ],
      action: { label: "Adresse bestätigen", url: link },
    }),
    emailChangeAddressInUse: ({ instanceName }) => ({
      subject: `E-Mail-Adresse auf ${instanceName} bereits vergeben`,
      paragraphs: [
        `Diese Adresse sollte für ein Konto auf ${instanceName} verwendet werden, gehört aber bereits zu einem anderen Konto. Es wurde nichts geändert.`,
        IGNORE_DE,
      ],
    }),
    emailChangeNotice: ({ instanceName, newEmail }) => ({
      subject: `Ihre E-Mail-Adresse auf ${instanceName} wurde geändert`,
      paragraphs: [
        `Die E-Mail-Adresse Ihres Kontos auf ${instanceName} wurde in ${newEmail} geändert. Diese Adresse erhält keine E-Mails für das Konto mehr.`,
        NOT_YOU_DE,
      ],
    }),
    recoveryCodeUsed: ({ instanceName, remaining }) => ({
      subject: `Ein Wiederherstellungscode wurde für ${instanceName} verwendet`,
      paragraphs: [
        `Mit einem Wiederherstellungscode wurde sich bei Ihrem Konto auf ${instanceName} angemeldet. Es sind noch ${remaining} unbenutzte Codes übrig.`,
        NOT_YOU_DE,
      ],
    }),
    smtpTest: ({ instanceName }) => ({
      subject: `Test-E-Mail von ${instanceName}`,
      paragraphs: [`${instanceName} kann mit diesen Einstellungen E-Mails versenden.`],
    }),
    invitation: ({ instanceName, organizationName, inviterName, link, days }) => ({
      subject: `${inviterName} hat Sie zu ${organizationName} auf ${instanceName} eingeladen`,
      paragraphs: [
        `${inviterName} hat Sie eingeladen, ${organizationName} auf ${instanceName} beizutreten.`,
        `Der Link funktioniert einmal und läuft in ${days} Tagen ab.`,
        IGNORE_DE,
      ],
      action: { label: "Einladung annehmen", url: link },
    }),
    registration: ({ instanceName, organizationName, link, hours }) => ({
      subject: `Registrierung für ${organizationName} auf ${instanceName} bestätigen`,
      paragraphs: [
        `Bestätigen Sie diese Adresse, um Ihr Konto in ${organizationName} auf ${instanceName} anzulegen.`,
        `Der Link funktioniert einmal und läuft in ${hours} Stunden ab.`,
        IGNORE_DE,
      ],
      action: { label: "Konto anlegen", url: link },
    }),
    breakGlassStarted: ({ instanceName, organizationName, requesterName, reason, minutes }) => ({
      subject: `Notfallzugriff auf ${organizationName} auf ${instanceName}`,
      paragraphs: [
        `${requesterName} hat einen Notfallzugriff auf ${organizationName} mit Administrationsrechten für ${minutes} Minuten gestartet.`,
        `Begründung: ${reason}`,
        "Jede Aktion während des Zugriffs wird im Audit-Log festgehalten.",
      ],
    }),
    guestExpiring: ({ instanceName, organizationName, guestName, date }) => ({
      subject: `Gastzugang von ${guestName} zu ${organizationName} läuft bald ab`,
      paragraphs: [
        `Der Gastzugang von ${guestName} zu ${organizationName} auf ${instanceName} läuft am ${date} ab. Sie sind für diesen Gast verantwortlich.`,
      ],
    }),
    guestInactive: ({ instanceName, organizationName, guestName, days }) => ({
      subject: `Gast ${guestName} ist in ${organizationName} inaktiv`,
      paragraphs: [
        `${guestName} hat ${instanceName} seit ${days} Tagen nicht verwendet. Sie sind für diesen Gast in ${organizationName} verantwortlich; entfernen Sie den Gast, wenn der Zugang nicht mehr gebraucht wird.`,
      ],
    }),
    serviceAccountUnattended: ({ instanceName, serviceAccountName, organizationName }) => ({
      subject: `Servicekonto ${serviceAccountName} in ${organizationName} hat keine verantwortliche Person`,
      paragraphs: [
        `Die letzte verantwortliche Person des Servicekontos ${serviceAccountName} in ${organizationName} auf ${instanceName} hat die Organisation verlassen oder wurde deaktiviert. Das Servicekonto behält seine Berechtigungen. Benennen Sie eine neue verantwortliche Person oder deaktivieren Sie es.`,
      ],
    }),
    tokenExpiring: ({ instanceName, tokenName, date }) => ({
      subject: `API-Token ${tokenName} auf ${instanceName} läuft bald ab`,
      paragraphs: [
        `Das API-Token ${tokenName} auf ${instanceName} läuft am ${date} ab. Erstellen Sie vorher ein neues Token, sonst funktionieren Skripte, die es verwenden, nicht mehr.`,
      ],
    }),
    accessExpiring: ({ instanceName, organizationName, kind, name, date }) => ({
      subject: `Zugang in ${organizationName} läuft bald ab`,
      paragraphs: [
        `${kind === "role" ? `Die Rolle ${name}` : kind === "group" ? `Die Mitgliedschaft in der Gruppe ${name}` : "Die Mitgliedschaft"} in ${organizationName} auf ${instanceName} läuft am ${date} ab.`,
      ],
    }),
  },
};

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderMail<T extends MailTemplate>(
  template: T,
  language: Language,
  params: MailTemplates[T],
  to: string,
): MailMessage {
  const content = (catalogs[language][template] as (params: MailTemplates[T]) => Content)(params);
  const text = [
    ...content.paragraphs,
    ...(content.action ? [`${content.action.label}: ${content.action.url}`] : []),
  ]
    .join("\n\n")
    .concat("\n");
  const body = content.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`);
  if (content.action) {
    body.splice(
      1,
      0,
      `<p><a href="${escapeHtml(content.action.url)}">${escapeHtml(content.action.label)}</a></p>`,
    );
  }
  const html = `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><title>${escapeHtml(content.subject)}</title></head><body>${body.join("")}</body></html>`;
  return { to, subject: content.subject, text, html };
}
