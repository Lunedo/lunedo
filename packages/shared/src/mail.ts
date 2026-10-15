import { z } from "zod";
import { ENTRA_AUTHORITY, MICROSOFT_GRAPH } from "./identity-providers.js";
import { emailSchema, type SmtpOAuth2Provider } from "./validation.js";

export const mailMethods = ["smtp", "graph"] as const;
export type MailMethod = (typeof mailMethods)[number];

const httpUrl = z
  .url({ protocol: /^https?$/ })
  .max(2048)
  .transform((value) => value.replace(/\/+$/, ""));

export const graphMailConfigurationSchema = z
  .object({
    tenantId: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "must be the tenant ID"),
    clientId: z.string().trim().min(1).max(500),
    sender: emailSchema,
    senderName: z.string().trim().min(1).max(100).nullable().default(null),
    authority: httpUrl.default(ENTRA_AUTHORITY),
    graphUrl: httpUrl.default(MICROSOFT_GRAPH),
  })
  .strict();
export type GraphMailConfiguration = z.output<typeof graphMailConfigurationSchema>;
export type GraphMailConfigurationInput = z.input<typeof graphMailConfigurationSchema>;

export const graphMailErrorCodes = [
  "graphMailboxNotAllowed",
  "graphMailboxUnknown",
  "graphPermissionMissing",
  "graphCredentialExpired",
  "graphCredentialInvalid",
  "graphCredentialMissing",
  "graphTenantUnknown",
  "graphApplicationUnknown",
  "graphUnreachable",
  "graphRefused",
] as const;
export type GraphMailErrorCode = (typeof graphMailErrorCodes)[number];

export interface SmtpPreset {
  id: string;
  name: string;
  host: string;
  port: number;
  security: "tls" | "starttls";
  oauth2?: SmtpOAuth2Provider;
}

export const smtpPresets: readonly SmtpPreset[] = [
  {
    id: "microsoft365",
    name: "Microsoft 365",
    host: "smtp.office365.com",
    port: 587,
    security: "starttls",
    oauth2: "microsoft365",
  },
  {
    id: "googleWorkspace",
    name: "Google Workspace",
    host: "smtp.gmail.com",
    port: 465,
    security: "tls",
    oauth2: "google",
  },
  { id: "sendgrid", name: "SendGrid", host: "smtp.sendgrid.net", port: 587, security: "starttls" },
  { id: "mailgun", name: "Mailgun (US)", host: "smtp.mailgun.org", port: 587, security: "starttls" },
  { id: "mailgunEu", name: "Mailgun (EU)", host: "smtp.eu.mailgun.org", port: 587, security: "starttls" },
  {
    id: "sesFrankfurt",
    name: "Amazon SES (Frankfurt)",
    host: "email-smtp.eu-central-1.amazonaws.com",
    port: 587,
    security: "starttls",
  },
  {
    id: "sesIreland",
    name: "Amazon SES (Ireland)",
    host: "email-smtp.eu-west-1.amazonaws.com",
    port: 587,
    security: "starttls",
  },
  {
    id: "sesVirginia",
    name: "Amazon SES (N. Virginia)",
    host: "email-smtp.us-east-1.amazonaws.com",
    port: 587,
    security: "starttls",
  },
  { id: "postmark", name: "Postmark", host: "smtp.postmarkapp.com", port: 587, security: "starttls" },
  { id: "brevo", name: "Brevo", host: "smtp-relay.brevo.com", port: 587, security: "starttls" },
];

export function smtpPresetOf(
  configuration: { host: string; port: number; security: string } | null,
): string | null {
  if (!configuration) return null;
  return (
    smtpPresets.find(
      (preset) =>
        preset.host === configuration.host.toLowerCase() &&
        preset.port === configuration.port &&
        preset.security === configuration.security,
    )?.id ?? null
  );
}
