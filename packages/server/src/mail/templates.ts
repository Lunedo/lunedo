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
