import { smtpSecurityModes } from "@pagehall/shared";
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

export { smtpSecurityModes };
export type SmtpSecurity = (typeof smtpSecurityModes)[number];

export interface SmtpOptions {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string | null;
  password: string | null;
  from: string;
}

export interface SmtpTimeouts {
  connectMs: number;
  greetingMs: number;
  idleMs: number;
  sendMs: number;
}

export const smtpTimeouts: SmtpTimeouts = {
  connectMs: 20_000,
  greetingMs: 20_000,
  idleMs: 30_000,
  sendMs: 60_000,
};

export type SmtpTimeoutCode = "SMTP_CONNECT_TIMEOUT" | "SMTP_GREETING_TIMEOUT" | "SMTP_SEND_TIMEOUT";

export class SmtpTimeoutError extends Error {
  override name = "SmtpTimeoutError";

  constructor(
    readonly code: SmtpTimeoutCode,
    message: string,
  ) {
    super(message);
  }
}

function classifyTimeout(error: unknown): SmtpTimeoutError | null {
  const details = error as { code?: unknown; message?: unknown };
  if (details.code !== "ETIMEDOUT") return null;
  const message = typeof details.message === "string" ? details.message : "";
  if (/greeting/i.test(message)) {
    return new SmtpTimeoutError("SMTP_GREETING_TIMEOUT", "The mail server did not send its greeting in time");
  }
  if (/connection timeout/i.test(message)) {
    return new SmtpTimeoutError("SMTP_CONNECT_TIMEOUT", "The connection to the mail server timed out");
  }
  return new SmtpTimeoutError("SMTP_SEND_TIMEOUT", "The mail server stopped answering while sending");
}

export class SmtpTransport implements MailTransport {
  readonly #options: SmtpOptions;
  readonly #timeouts: SmtpTimeouts;

  constructor(options: SmtpOptions, timeouts: Partial<SmtpTimeouts> = {}) {
    this.#options = options;
    this.#timeouts = { ...smtpTimeouts, ...timeouts };
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
      connectionTimeout: this.#timeouts.connectMs,
      greetingTimeout: this.#timeouts.greetingMs,
      socketTimeout: this.#timeouts.idleMs,
      dnsTimeout: this.#timeouts.connectMs,
      ...(username ? { auth: { user: username, pass: password ?? "" } } : {}),
    });
    let deadline: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        transport.sendMail({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => {
            reject(new SmtpTimeoutError("SMTP_SEND_TIMEOUT", "Sending the e-mail took too long"));
          }, this.#timeouts.sendMs);
        }),
      ]);
    } catch (error) {
      throw classifyTimeout(error) ?? error;
    } finally {
      clearTimeout(deadline);
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
