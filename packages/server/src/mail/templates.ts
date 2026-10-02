import designTokens from "@pagehall/tokens/design-tokens.json" with { type: "json" };
import type { supportedLanguages } from "../settings/builtin.js";
import type { MailMessage } from "./transport.js";

export type Language = (typeof supportedLanguages)[number];

export interface MailTemplates {
  passwordReset: { instanceName: string; link: string; minutes: number };
  emailChangeConfirmation: { instanceName: string; link: string; hours: number };
  emailChangeAddressInUse: { instanceName: string };
  emailChangeNotice: { instanceName: string; newEmail: string };
  recoveryCodeUsed: { instanceName: string; remaining: number };
  secondFactorReset: { instanceName: string; reason: string };
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
  tokenUnused: { instanceName: string; tokenName: string; days: number };
  serviceAccountUnattended: { instanceName: string; serviceAccountName: string; organizationName: string };
  signInNewBrowser: {
    instanceName: string;
    browser: string | null;
    operatingSystem: string | null;
    clientIp: string | null;
  };
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

function describeBrowser(
  browser: string | null,
  operatingSystem: string | null,
  unknown: string,
  on: string,
): string {
  if (!browser) return operatingSystem ?? unknown;
  return operatingSystem ? `${browser} ${on} ${operatingSystem}` : browser;
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
    secondFactorReset: ({ instanceName, reason }) => ({
      subject: `Your second factor on ${instanceName} was reset`,
      paragraphs: [
        `An administrator reset the second factor of your account on ${instanceName} and ended all your sessions. Reason: ${reason}`,
        "When you sign in next time, set up an authenticator app or a passkey before you continue.",
        "If you did not ask for this, contact your administrator at once.",
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
    tokenUnused: ({ instanceName, tokenName, days }) => ({
      subject: `API token ${tokenName} on ${instanceName} has not been used for ${days} days`,
      paragraphs: [
        `The API token ${tokenName} on ${instanceName} has not been used for ${days} days. It keeps working. If nothing needs it any more, revoke it, so it cannot be misused.`,
      ],
    }),
    tokenExpiring: ({ instanceName, tokenName, date }) => ({
      subject: `API token ${tokenName} on ${instanceName} expires soon`,
      paragraphs: [
        `The API token ${tokenName} on ${instanceName} expires on ${date}. Create a new token before then, or scripts using it will stop working.`,
      ],
    }),
    signInNewBrowser: ({ instanceName, browser, operatingSystem, clientIp }) => ({
      subject: `New sign-in to ${instanceName}`,
      paragraphs: [
        `Your account on ${instanceName} was used to sign in from a browser that was not used before: ${describeBrowser(browser, operatingSystem, "an unknown browser", "on")}${clientIp ? `, address ${clientIp}` : ""}.`,
        NOT_YOU_EN,
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
    secondFactorReset: ({ instanceName, reason }) => ({
      subject: `Ihr zweiter Faktor auf ${instanceName} wurde zurückgesetzt`,
      paragraphs: [
        `Eine Administratorin oder ein Administrator hat den zweiten Faktor Ihres Kontos auf ${instanceName} zurückgesetzt und alle Ihre Sitzungen beendet. Grund: ${reason}`,
        "Richten Sie bei der nächsten Anmeldung eine Authenticator-App oder einen Passkey ein, bevor Sie fortfahren.",
        "Wenn Sie das nicht veranlasst haben, wenden Sie sich sofort an Ihre Administration.",
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
    tokenUnused: ({ instanceName, tokenName, days }) => ({
      subject: `API-Token ${tokenName} auf ${instanceName} wurde seit ${days} Tagen nicht verwendet`,
      paragraphs: [
        `Das API-Token ${tokenName} auf ${instanceName} wurde seit ${days} Tagen nicht verwendet. Es funktioniert weiterhin. Wenn es nicht mehr gebraucht wird, widerrufen Sie es, damit es nicht missbraucht werden kann.`,
      ],
    }),
    tokenExpiring: ({ instanceName, tokenName, date }) => ({
      subject: `API-Token ${tokenName} auf ${instanceName} läuft bald ab`,
      paragraphs: [
        `Das API-Token ${tokenName} auf ${instanceName} läuft am ${date} ab. Erstellen Sie vorher ein neues Token, sonst funktionieren Skripte, die es verwenden, nicht mehr.`,
      ],
    }),
    signInNewBrowser: ({ instanceName, browser, operatingSystem, clientIp }) => ({
      subject: `Neue Anmeldung bei ${instanceName}`,
      paragraphs: [
        `Mit Ihrem Konto auf ${instanceName} wurde sich in einem Browser angemeldet, der bisher nicht verwendet wurde: ${describeBrowser(browser, operatingSystem, "ein unbekannter Browser", "unter")}${clientIp ? `, Adresse ${clientIp}` : ""}.`,
        NOT_YOU_DE,
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

export interface MailBranding {
  organizationName: string | null;
  logoUrl: string | null;
  accentColor: string;
  preferencesUrl: string | null;
}

const NEUTRAL = designTokens.color.light;

const FOOTER: Record<Language, { sentBy: (instanceName: string) => string; preferences: string }> = {
  en: {
    sentBy: (instanceName) => `Sent by ${instanceName}.`,
    preferences: "Choose which notifications you receive",
  },
  de: {
    sentBy: (instanceName) => `Gesendet von ${instanceName}.`,
    preferences: "Wählen Sie, welche Benachrichtigungen Sie erhalten",
  },
};

export const defaultBranding: MailBranding = {
  organizationName: null,
  logoUrl: null,
  accentColor: designTokens.color.light.accent,
  preferencesUrl: null,
};

const FONT = "font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

function layout(language: Language, content: Content, instanceName: string, branding: MailBranding): string {
  const accent = escapeHtml(branding.accentColor);
  const name = escapeHtml(branding.organizationName ?? instanceName);
  const heading = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${name}" height="32" style="display:block;height:32px;max-width:200px;border:0">`
    : `<span style="${FONT};font-size:15px;font-weight:600;color:${NEUTRAL.text}">${name}</span>`;
  const body = content.paragraphs.map(
    (paragraph) => `<p style="margin:0 0 16px">${escapeHtml(paragraph)}</p>`,
  );
  if (content.action) {
    const url = escapeHtml(content.action.url);
    body.splice(
      1,
      0,
      `<p style="margin:8px 0 24px"><a href="${url}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:${accent};color:${NEUTRAL.onAccent};font-weight:600;text-decoration:none">${escapeHtml(content.action.label)}</a></p>`,
      `<p style="margin:0 0 16px;font-size:13px;color:${NEUTRAL.textMuted};word-break:break-all">${url}</p>`,
    );
  }
  const footer = [
    escapeHtml(FOOTER[language].sentBy(instanceName)),
    ...(branding.preferencesUrl
      ? [
          `<a href="${escapeHtml(branding.preferencesUrl)}" style="color:${NEUTRAL.textMuted}">${escapeHtml(FOOTER[language].preferences)}</a>`,
        ]
      : []),
  ].join(" ");
  return [
    `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.subject)}</title></head>`,
    `<body style="margin:0;padding:0;background:${NEUTRAL.sidebar}">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NEUTRAL.sidebar}"><tr><td align="center" style="padding:24px 12px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${NEUTRAL.surface};border:1px solid ${NEUTRAL.border};border-top:4px solid ${accent};border-radius:12px">`,
    `<tr><td style="padding:24px 28px 8px">${heading}</td></tr>`,
    `<tr><td style="padding:8px 28px;${FONT};font-size:15px;line-height:1.6;color:${NEUTRAL.text}">`,
    `<h1 style="margin:0 0 16px;font-size:18px;line-height:1.3">${escapeHtml(content.subject)}</h1>`,
    body.join(""),
    "</td></tr>",
    `<tr><td style="padding:16px 28px 24px;border-top:1px solid ${NEUTRAL.border};${FONT};font-size:13px;color:${NEUTRAL.textMuted}">${footer}</td></tr>`,
    "</table></td></tr></table></body></html>",
  ].join("");
}

export function renderMail<T extends MailTemplate>(
  template: T,
  language: Language,
  params: MailTemplates[T],
  to: string,
  branding: MailBranding = defaultBranding,
): MailMessage {
  const content = (catalogs[language][template] as (params: MailTemplates[T]) => Content)(params);
  const text = [
    ...content.paragraphs,
    ...(content.action ? [`${content.action.label}: ${content.action.url}`] : []),
    FOOTER[language].sentBy(params.instanceName),
    ...(branding.preferencesUrl ? [`${FOOTER[language].preferences}: ${branding.preferencesUrl}`] : []),
  ]
    .join("\n\n")
    .concat("\n");
  return {
    to,
    subject: content.subject,
    text,
    html: layout(language, content, params.instanceName, branding),
  };
}
