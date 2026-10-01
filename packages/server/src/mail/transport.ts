import { createTransport } from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

export const smtpSecurityModes = ["tls", "starttls", "none"] as const;
export type SmtpSecurity = (typeof smtpSecurityModes)[number];

export interface SmtpOptions {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string | null;
  password: string | null;
  from: string;
}

const TIMEOUT_MS = 30_000;

export class SmtpTransport implements MailTransport {
  readonly #options: SmtpOptions;

  constructor(options: SmtpOptions) {
    this.#options = options;
  }

  async send(message: MailMessage): Promise<void> {
    const { host, port, security, username, password, from } = this.#options;
    const transport = createTransport({
      host,
      port,
      secure: security === "tls",
      requireTLS: security === "starttls",
      ignoreTLS: security === "none",
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
      ...(username ? { auth: { user: username, pass: password ?? "" } } : {}),
    });
    try {
      await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } finally {
      transport.close();
    }
  }
}

export function describeMailError(error: unknown): { code: string | null; responseCode: number | null } {
  const details = error as { code?: unknown; responseCode?: unknown };
  return {
    code: typeof details.code === "string" ? details.code : null,
    responseCode: typeof details.responseCode === "number" ? details.responseCode : null,
  };
}
