import designTokens from "@lunedo/tokens/design-tokens.json" with { type: "json" };
import type { supportedLanguages } from "../settings/builtin.js";
import {
  type BackupFailedText,
  type BackupMissingText,
  type BackupRecoveredText,
  type BackupTestRestoreFailedText,
  backupFailed,
  backupMissing,
  backupRecovered,
  backupTestRestoreFailed,
} from "./backup-texts.js";
import { storageCleared, storageReached, storageTest } from "./storage-texts.js";
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
  portalInvitation: {
    instanceName: string;
    knowledgeBaseName: string;
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
  spaceAdministratorTaken: {
    instanceName: string;
    organizationName: string;
    spaceName: string;
    actorName: string;
    reason: string;
    takenAt: string;
  };
  guestExpiring: { instanceName: string; organizationName: string; guestName: string; date: string };
  guestInactive: { instanceName: string; organizationName: string; guestName: string; days: number };
  tokenExpiring: { instanceName: string; tokenName: string; date: string };
  tokenUnused: { instanceName: string; tokenName: string; days: number };
  serviceAccountUnattended: { instanceName: string; serviceAccountName: string; organizationName: string };
  emergencySignIn: {
    instanceName: string;
    accountName: string;
    browser: string | null;
    operatingSystem: string | null;
    clientIp: string | null;
  };
  providerCredentialExpiring: { instanceName: string; providerName: string; date: string };
  providerSyncHeld: { instanceName: string; providerName: string; deactivations: number; accounts: number };
  homeOrganizationChanged: {
    instanceName: string;
    accountName: string;
    previousOrganizationName: string | null;
    organizationName: string | null;
    reason: "providerRule" | "manual";
  };
  mailCredentialExpiring: { instanceName: string; date: string };
  storageLevelReached: {
    instanceName: string;
    level: 1 | 2 | 3;
    percent: string;
    used: string;
    total: string;
    store: "local" | "s3";
    reminder: boolean;
    link: string | null;
  };
  storageLevelCleared: {
    instanceName: string;
    level: 0 | 1 | 2;
    percent: string;
    store: "local" | "s3";
    link: string | null;
  };
  storageTest: { instanceName: string; link: string | null };
  updateAvailable: {
    instanceName: string;
    version: string;
    current: string;
    breaking: boolean;
    link: string | null;
  };
  backupFailed: BackupFailedText;
  backupMissing: BackupMissingText;
  backupRecovered: BackupRecoveredText;
  backupTestRestoreFailed: BackupTestRestoreFailedText;
  accountRolesWithheld: { instanceName: string; accountName: string; providerName: string; roles: number };
  accountWithoutOrganization: {
    instanceName: string;
    accountName: string;
    email: string | null;
    providerName: string;
  };
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

export interface MailEntry {
  text: string;
  excerpt: string | null;
  meta: string | null;
  url: string | null;
}

export interface MailSection {
  heading: string;
  entries: MailEntry[];
}

export interface Content {
  subject: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  sections?: MailSection[];
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
const IGNORE_DE = "Wenn du das nicht angefordert hast, kannst du diese E-Mail ignorieren.";
const NOT_YOU_EN = "If this was not you, contact your administrator immediately.";
const NOT_YOU_DE = "Wenn du das nicht warst, wende dich sofort an deine Administration.";

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
    portalInvitation: ({ knowledgeBaseName, inviterName, link, days }) => ({
      subject: `${inviterName} invited you to read ${knowledgeBaseName}`,
      paragraphs: [
        `${inviterName} invited you to read the help ${knowledgeBaseName}. Choose a password to create your reader account; afterwards you can also add a passkey.`,
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
    spaceAdministratorTaken: ({ instanceName, organizationName, spaceName, actorName, reason, takenAt }) => ({
      subject: `${actorName} became space admin of ${spaceName} on ${instanceName}`,
      paragraphs: [
        `${actorName} used the administration of ${organizationName} on ${takenAt} to become space admin of ${spaceName}. You receive this because you are a space admin there.`,
        `Reason: ${reason}`,
        "The role gives full access to the content of the space. If you did not expect this, remove it in the permissions of the space and talk to the administrators of the organization. The step is recorded in the audit log.",
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
    emergencySignIn: ({ instanceName, accountName, browser, operatingSystem, clientIp }) => ({
      subject: `Emergency sign-in to ${instanceName}`,
      paragraphs: [
        `${accountName}, the owner of ${instanceName}, signed in with a password while password sign-in is turned off: ${describeBrowser(browser, operatingSystem, "an unknown browser", "on")}${clientIp ? `, address ${clientIp}` : ""}.`,
        "This sign-in is meant for emergencies, for example when the identity provider fails. Check the audit log if you did not expect it.",
      ],
    }),
    accountRolesWithheld: ({ instanceName, accountName, providerName, roles }) => ({
      subject: `Administrative roles of ${accountName} on ${instanceName} are paused`,
      paragraphs: [
        `Lunedo could not read the groups of ${accountName} from ${providerName} for longer than twice the sync interval. ${roles} administrative role${roles === 1 ? "" : "s"} granted by mapping rules ${roles === 1 ? "is" : "are"} paused until the groups can be read again. Memberships stay as last known.`,
        "Check the connection to the provider and its sync log.",
      ],
    }),
    accountWithoutOrganization: ({ instanceName, accountName, email, providerName }) => ({
      subject: `${accountName} is not a member of any organization on ${instanceName}`,
      paragraphs: [
        `${accountName}${email ? ` (${email})` : ""} signed in to ${instanceName} through ${providerName} for the first time. No mapping rule and no organization domain made the account a member of an organization.`,
        "Assign an organization in the account list of the instance settings, filtered by accounts without an organization.",
      ],
    }),
    homeOrganizationChanged: ({
      instanceName,
      accountName,
      previousOrganizationName,
      organizationName,
      reason,
    }) => ({
      subject: `Home organization of ${accountName} on ${instanceName} changed`,
      paragraphs: [
        `${organizationName ? `The home organization of ${accountName} on ${instanceName} is now ${organizationName}` : `${accountName} on ${instanceName} has no home organization anymore`}${previousOrganizationName ? `; before, it was ${previousOrganizationName}` : ""}.`,
        reason === "providerRule"
          ? "The mapping rule or the group at the identity provider that gave this membership no longer applies."
          : "An administrator changed it.",
        "The home organization decides whose administrators manage the account and whose defaults apply to its settings.",
      ],
    }),
    storageLevelReached: (params) => storageReached("en", params),
    storageLevelCleared: (params) => storageCleared("en", params),
    updateAvailable: ({ instanceName, version, current, breaking, link }) => ({
      subject: `Lunedo ${version} is available for ${instanceName}`,
      paragraphs: [
        `${instanceName} runs Lunedo ${current}. Version ${version} is available.`,
        breaking
          ? "The release notes list breaking changes or manual steps. Read them before you update."
          : "The admin area shows what changed and the commands for your installation. The update takes a backup first.",
      ],
      ...(link ? { action: { label: "Show the update", url: link } } : {}),
    }),
    storageTest: (params) => storageTest("en", params),
    backupFailed: (params) => backupFailed("en", params),
    backupMissing: (params) => backupMissing("en", params),
    backupRecovered: (params) => backupRecovered("en", params),
    backupTestRestoreFailed: (params) => backupTestRestoreFailed("en", params),
    mailCredentialExpiring: ({ instanceName, date }) => ({
      subject: `E-mail on ${instanceName} stops on ${date}`,
      paragraphs: [
        `The client secret or certificate that ${instanceName} uses to send e-mail through Microsoft Graph expires on ${date}. Add a new one in the e-mail settings before then, or Lunedo can no longer send e-mail.`,
      ],
    }),
    providerCredentialExpiring: ({ instanceName, providerName, date }) => ({
      subject: `Credential of ${providerName} on ${instanceName} expires soon`,
      paragraphs: [
        `A client secret or certificate of the identity provider ${providerName} on ${instanceName} expires on ${date}. Add a new credential in the provider settings and register it with the provider before then, or sign-in through ${providerName} stops working.`,
      ],
    }),
    providerSyncHeld: ({ instanceName, providerName, deactivations, accounts }) => ({
      subject: `Synchronization of ${providerName} on ${instanceName} stopped`,
      paragraphs: [
        `The synchronization with ${providerName} would have deactivated ${deactivations} of ${accounts} accounts at once. It stopped and deactivated nobody, because a changed search base, a moved directory unit or missing read permissions look the same as people leaving.`,
        "Check the provider settings and the directory. If the people really left, confirm the run in the sync log of the provider.",
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
        `Für dein Konto auf ${instanceName} wurde das Zurücksetzen des Passworts angefordert.`,
        `Der Link funktioniert einmal und läuft in ${minutes} Minuten ab.`,
        IGNORE_DE,
      ],
      action: { label: "Passwort zurücksetzen", url: link },
    }),
    emailChangeConfirmation: ({ instanceName, link, hours }) => ({
      subject: `Neue E-Mail-Adresse für ${instanceName} bestätigen`,
      paragraphs: [
        `Bestätige, dass diese Adresse für dein Konto auf ${instanceName} verwendet werden soll.`,
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
      subject: `Deine E-Mail-Adresse auf ${instanceName} wurde geändert`,
      paragraphs: [
        `Die E-Mail-Adresse deines Kontos auf ${instanceName} wurde in ${newEmail} geändert. Diese Adresse erhält keine E-Mails für das Konto mehr.`,
        NOT_YOU_DE,
      ],
    }),
    secondFactorReset: ({ instanceName, reason }) => ({
      subject: `Dein zweiter Faktor auf ${instanceName} wurde zurückgesetzt`,
      paragraphs: [
        `Ein Administrator hat den zweiten Faktor deines Kontos auf ${instanceName} zurückgesetzt und alle deine Sitzungen beendet. Grund: ${reason}`,
        "Richte bei der nächsten Anmeldung eine Authenticator-App oder einen Passkey ein, bevor du fortfährst.",
        "Wenn du das nicht veranlasst hast, wende dich sofort an deine Administration.",
      ],
    }),
    recoveryCodeUsed: ({ instanceName, remaining }) => ({
      subject: `Ein Wiederherstellungscode wurde für ${instanceName} verwendet`,
      paragraphs: [
        `Mit einem Wiederherstellungscode wurde sich bei deinem Konto auf ${instanceName} angemeldet. Es sind noch ${remaining} unbenutzte Codes übrig.`,
        NOT_YOU_DE,
      ],
    }),
    smtpTest: ({ instanceName }) => ({
      subject: `Test-E-Mail von ${instanceName}`,
      paragraphs: [`${instanceName} kann mit diesen Einstellungen E-Mails versenden.`],
    }),
    invitation: ({ instanceName, organizationName, inviterName, link, days }) => ({
      subject: `${inviterName} hat dich zu ${organizationName} auf ${instanceName} eingeladen`,
      paragraphs: [
        `${inviterName} hat dich eingeladen, ${organizationName} auf ${instanceName} beizutreten.`,
        `Der Link funktioniert einmal und läuft in ${days} Tagen ab.`,
        IGNORE_DE,
      ],
      action: { label: "Einladung annehmen", url: link },
    }),
    portalInvitation: ({ knowledgeBaseName, inviterName, link, days }) => ({
      subject: `${inviterName} hat dich eingeladen, ${knowledgeBaseName} zu lesen`,
      paragraphs: [
        `${inviterName} hat dich eingeladen, die Hilfe ${knowledgeBaseName} zu lesen. Wähle ein Passwort, um dein Lesekonto anzulegen; danach kannst du auch einen Passkey hinzufügen.`,
        `Der Link funktioniert einmal und läuft in ${days} Tagen ab.`,
        IGNORE_DE,
      ],
      action: { label: "Einladung annehmen", url: link },
    }),
    registration: ({ instanceName, organizationName, link, hours }) => ({
      subject: `Registrierung für ${organizationName} auf ${instanceName} bestätigen`,
      paragraphs: [
        `Bestätige diese Adresse, um dein Konto in ${organizationName} auf ${instanceName} anzulegen.`,
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
    spaceAdministratorTaken: ({ instanceName, organizationName, spaceName, actorName, reason, takenAt }) => ({
      subject: `${actorName} ist Space-Admin von ${spaceName} auf ${instanceName} geworden`,
      paragraphs: [
        `${actorName} hat sich am ${takenAt} über die Verwaltung von ${organizationName} zum Space-Admin von ${spaceName} gemacht. Du bekommst diese Nachricht, weil du dort Space-Admin bist.`,
        `Begründung: ${reason}`,
        "Die Rolle gibt vollen Zugriff auf die Inhalte des Space. Wenn du das nicht erwartet hast, entferne sie in den Berechtigungen des Space und sprich mit der Administration der Organisation. Der Schritt steht im Audit-Log.",
      ],
    }),
    guestExpiring: ({ instanceName, organizationName, guestName, date }) => ({
      subject: `Gastzugang von ${guestName} zu ${organizationName} läuft bald ab`,
      paragraphs: [
        `Der Gastzugang von ${guestName} zu ${organizationName} auf ${instanceName} läuft am ${date} ab. Du bist für diesen Gast verantwortlich.`,
      ],
    }),
    guestInactive: ({ instanceName, organizationName, guestName, days }) => ({
      subject: `Gast ${guestName} ist in ${organizationName} inaktiv`,
      paragraphs: [
        `${guestName} hat ${instanceName} seit ${days} Tagen nicht verwendet. Du bist für diesen Gast in ${organizationName} verantwortlich; entferne den Gast, wenn der Zugang nicht mehr gebraucht wird.`,
      ],
    }),
    serviceAccountUnattended: ({ instanceName, serviceAccountName, organizationName }) => ({
      subject: `Servicekonto ${serviceAccountName} in ${organizationName} hat keine verantwortliche Person`,
      paragraphs: [
        `Die letzte verantwortliche Person des Servicekontos ${serviceAccountName} in ${organizationName} auf ${instanceName} hat die Organisation verlassen oder wurde deaktiviert. Das Servicekonto behält seine Berechtigungen. Benenne eine neue verantwortliche Person oder deaktiviere es.`,
      ],
    }),
    tokenUnused: ({ instanceName, tokenName, days }) => ({
      subject: `API-Token ${tokenName} auf ${instanceName} wurde seit ${days} Tagen nicht verwendet`,
      paragraphs: [
        `Das API-Token ${tokenName} auf ${instanceName} wurde seit ${days} Tagen nicht verwendet. Es funktioniert weiterhin. Wenn es nicht mehr gebraucht wird, widerrufe es, damit es nicht missbraucht werden kann.`,
      ],
    }),
    tokenExpiring: ({ instanceName, tokenName, date }) => ({
      subject: `API-Token ${tokenName} auf ${instanceName} läuft bald ab`,
      paragraphs: [
        `Das API-Token ${tokenName} auf ${instanceName} läuft am ${date} ab. Erstelle vorher ein neues Token, sonst funktionieren Skripte, die es verwenden, nicht mehr.`,
      ],
    }),
    emergencySignIn: ({ instanceName, accountName, browser, operatingSystem, clientIp }) => ({
      subject: `Notfallanmeldung bei ${instanceName}`,
      paragraphs: [
        `${accountName}, Eigentümer von ${instanceName}, hat sich mit Passwort angemeldet, obwohl die Anmeldung mit Passwort ausgeschaltet ist: ${describeBrowser(browser, operatingSystem, "ein unbekannter Browser", "unter")}${clientIp ? `, Adresse ${clientIp}` : ""}.`,
        "Diese Anmeldung ist für Notfälle gedacht, zum Beispiel wenn der Identitätsanbieter ausfällt. Prüfe das Audit-Log, wenn du sie nicht erwartet hast.",
      ],
    }),
    accountRolesWithheld: ({ instanceName, accountName, providerName, roles }) => ({
      subject: `Administrative Rollen von ${accountName} auf ${instanceName} sind ausgesetzt`,
      paragraphs: [
        `Lunedo konnte die Gruppen von ${accountName} länger als das doppelte Synchronisierungsintervall nicht aus ${providerName} lesen. ${roles === 1 ? "Eine administrative Rolle" : `${roles} administrative Rollen`} aus Zuordnungsregeln ${roles === 1 ? "ist" : "sind"} ausgesetzt, bis die Gruppen wieder gelesen werden können. Mitgliedschaften bleiben wie zuletzt bekannt.`,
        "Prüfe die Verbindung zum Anbieter und sein Sync-Protokoll.",
      ],
    }),
    accountWithoutOrganization: ({ instanceName, accountName, email, providerName }) => ({
      subject: `${accountName} ist auf ${instanceName} in keiner Organisation Mitglied`,
      paragraphs: [
        `${accountName}${email ? ` (${email})` : ""} hat sich zum ersten Mal über ${providerName} bei ${instanceName} angemeldet. Weder eine Zuordnungsregel noch eine Domain einer Organisation hat das Konto zum Mitglied einer Organisation gemacht.`,
        "Weise in der Kontenliste der Instanz-Einstellungen eine Organisation zu, gefiltert nach Konten ohne Organisation.",
      ],
    }),
    homeOrganizationChanged: ({
      instanceName,
      accountName,
      previousOrganizationName,
      organizationName,
      reason,
    }) => ({
      subject: `Heimatorganisation von ${accountName} auf ${instanceName} geändert`,
      paragraphs: [
        `${organizationName ? `Die Heimatorganisation von ${accountName} auf ${instanceName} ist jetzt ${organizationName}` : `${accountName} hat auf ${instanceName} keine Heimatorganisation mehr`}${previousOrganizationName ? `; vorher war es ${previousOrganizationName}` : ""}.`,
        reason === "providerRule"
          ? "Die Zuordnungsregel oder die Gruppe beim Identitätsanbieter, aus der diese Mitgliedschaft kam, gilt nicht mehr."
          : "Ein Administrator hat sie geändert.",
        "Die Heimatorganisation bestimmt, wessen Administration das Konto verwaltet und wessen Standards für seine Einstellungen gelten.",
      ],
    }),
    storageLevelReached: (params) => storageReached("de", params),
    storageLevelCleared: (params) => storageCleared("de", params),
    updateAvailable: ({ instanceName, version, current, breaking, link }) => ({
      subject: `Lunedo ${version} ist für ${instanceName} verfügbar`,
      paragraphs: [
        `${instanceName} läuft mit Lunedo ${current}. Version ${version} ist verfügbar.`,
        breaking
          ? "Die Versionshinweise nennen inkompatible Änderungen oder manuelle Schritte. Lies sie vor dem Update."
          : "Der Administrationsbereich zeigt, was sich geändert hat, und die Befehle für deine Installation. Das Update legt vorher ein Backup an.",
      ],
      ...(link ? { action: { label: "Update anzeigen", url: link } } : {}),
    }),
    storageTest: (params) => storageTest("de", params),
    backupFailed: (params) => backupFailed("de", params),
    backupMissing: (params) => backupMissing("de", params),
    backupRecovered: (params) => backupRecovered("de", params),
    backupTestRestoreFailed: (params) => backupTestRestoreFailed("de", params),
    mailCredentialExpiring: ({ instanceName, date }) => ({
      subject: `E-Mail-Versand auf ${instanceName} endet am ${date}`,
      paragraphs: [
        `Das Client-Secret oder Zertifikat, mit dem ${instanceName} E-Mails über Microsoft Graph sendet, läuft am ${date} ab. Füge vorher in den E-Mail-Einstellungen neue Zugangsdaten hinzu, sonst kann Lunedo keine E-Mails mehr senden.`,
      ],
    }),
    providerCredentialExpiring: ({ instanceName, providerName, date }) => ({
      subject: `Zugangsdaten von ${providerName} auf ${instanceName} laufen bald ab`,
      paragraphs: [
        `Ein Client-Secret oder Zertifikat des Identitätsanbieters ${providerName} auf ${instanceName} läuft am ${date} ab. Füge vorher in den Einstellungen des Anbieters neue Zugangsdaten hinzu und hinterlege sie beim Anbieter, sonst funktioniert die Anmeldung über ${providerName} nicht mehr.`,
      ],
    }),
    providerSyncHeld: ({ instanceName, providerName, deactivations, accounts }) => ({
      subject: `Synchronisierung von ${providerName} auf ${instanceName} angehalten`,
      paragraphs: [
        `Die Synchronisierung mit ${providerName} hätte ${deactivations} von ${accounts} Konten auf einmal deaktiviert. Sie wurde angehalten und hat niemanden deaktiviert, denn eine geänderte Suchbasis, eine verschobene Organisationseinheit oder fehlende Leserechte sehen genauso aus wie ausgeschiedene Personen.`,
        "Prüfe die Einstellungen des Anbieters und das Verzeichnis. Wenn die Personen wirklich ausgeschieden sind, bestätige den Lauf im Sync-Protokoll des Anbieters.",
      ],
    }),
    signInNewBrowser: ({ instanceName, browser, operatingSystem, clientIp }) => ({
      subject: `Neue Anmeldung bei ${instanceName}`,
      paragraphs: [
        `Mit deinem Konto auf ${instanceName} wurde sich in einem Browser angemeldet, der bisher nicht verwendet wurde: ${describeBrowser(browser, operatingSystem, "ein unbekannter Browser", "unter")}${clientIp ? `, Adresse ${clientIp}` : ""}.`,
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
  unsubscribe?: { label: string; url: string } | null;
  security?: boolean;
  operations?: boolean;
}

const NEUTRAL = designTokens.color.light;

const FOOTER: Record<
  Language,
  { sentBy: (instanceName: string) => string; preferences: string; security: string; operations: string }
> = {
  en: {
    sentBy: (instanceName) => `Sent by ${instanceName}.`,
    preferences: "Choose which notifications you receive",
    security: "You receive this mail for your account's security.",
    operations: "You receive this mail as an instance administrator or operations contact.",
  },
  de: {
    sentBy: (instanceName) => `Gesendet von ${instanceName}.`,
    preferences: "Wähle, welche Benachrichtigungen du erhältst",
    security: "Du erhältst diese E-Mail zur Sicherheit deines Kontos.",
    operations: "Du erhältst diese E-Mail als Instanzadministration oder Betriebskontakt.",
  },
};

function footerReason(language: Language, branding: MailBranding): string | null {
  if (branding.operations) return FOOTER[language].operations;
  return branding.security ? FOOTER[language].security : null;
}

export function unsubscribeHeaders(oneClickUrl: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${oneClickUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

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
  for (const section of content.sections ?? []) {
    body.push(
      `<h2 style="margin:24px 0 8px;font-size:15px;line-height:1.3">${escapeHtml(section.heading)}</h2>`,
      ...section.entries.map((entry) => {
        const label = entry.url
          ? `<a href="${escapeHtml(entry.url)}" style="color:${NEUTRAL.text}">${escapeHtml(entry.text)}</a>`
          : escapeHtml(entry.text);
        const excerpt = entry.excerpt
          ? `<br><span style="color:${NEUTRAL.textMuted}">${escapeHtml(entry.excerpt)}</span>`
          : "";
        const meta = entry.meta
          ? `<br><span style="font-size:13px;color:${NEUTRAL.textMuted}">${escapeHtml(entry.meta)}</span>`
          : "";
        return `<p style="margin:0 0 12px;padding-left:12px;border-left:2px solid ${NEUTRAL.border}">${label}${excerpt}${meta}</p>`;
      }),
    );
  }
  const footer = [
    escapeHtml(FOOTER[language].sentBy(instanceName)),
    ...(footerReason(language, branding) ? [escapeHtml(footerReason(language, branding) ?? "")] : []),
    ...(branding.preferencesUrl
      ? [
          `<a href="${escapeHtml(branding.preferencesUrl)}" style="color:${NEUTRAL.textMuted}">${escapeHtml(FOOTER[language].preferences)}</a>`,
        ]
      : []),
    ...(branding.unsubscribe
      ? [
          `<a href="${escapeHtml(branding.unsubscribe.url)}" style="color:${NEUTRAL.textMuted}">${escapeHtml(branding.unsubscribe.label)}</a>`,
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
  return renderContent(language, content, params.instanceName, to, branding);
}

export function templateSubject<T extends MailTemplate>(
  template: T,
  language: Language,
  params: MailTemplates[T],
): string {
  return (catalogs[language][template] as (params: MailTemplates[T]) => Content)(params).subject;
}

export function renderContent(
  language: Language,
  content: Content,
  instanceName: string,
  to: string,
  branding: MailBranding = defaultBranding,
): MailMessage {
  const sections = (content.sections ?? []).map((section) =>
    [
      section.heading,
      ...section.entries.map((entry) =>
        [`- ${entry.text}`, entry.excerpt, entry.meta, entry.url]
          .filter((part): part is string => part !== null)
          .join("\n  "),
      ),
    ].join("\n"),
  );
  const text = [
    ...content.paragraphs,
    ...(content.action ? [`${content.action.label}: ${content.action.url}`] : []),
    ...sections,
    FOOTER[language].sentBy(instanceName),
    ...(footerReason(language, branding) ? [footerReason(language, branding) ?? ""] : []),
    ...(branding.preferencesUrl ? [`${FOOTER[language].preferences}: ${branding.preferencesUrl}`] : []),
    ...(branding.unsubscribe ? [`${branding.unsubscribe.label}: ${branding.unsubscribe.url}`] : []),
  ]
    .join("\n\n")
    .concat("\n");
  return {
    to,
    subject: content.subject,
    text,
    html: layout(language, content, instanceName, branding),
  };
}
