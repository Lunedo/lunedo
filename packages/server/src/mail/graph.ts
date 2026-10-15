import type { GraphMailConfiguration, GraphMailErrorCode } from "@pagehall/shared";
import { createTransport } from "nodemailer";
import { type GraphClientCredential, requestGraphToken } from "../identity/graph-token.js";
import type { MailMessage, MailTransport } from "./transport.js";

const TIMEOUT_MS = 30_000;

export class GraphMailError extends Error {
  override name = "GraphMailError";

  constructor(
    readonly code: GraphMailErrorCode,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

export interface GraphTokenCache {
  get(key: string): { token: string; expiresAt: number } | undefined;
  set(key: string, value: { token: string; expiresAt: number }): void;
  delete(key: string): void;
}

function tokenFailure(status: number, description: string | null): GraphMailError {
  const text = description ?? "";
  if (text.includes("AADSTS7000222")) {
    return new GraphMailError(
      "graphCredentialExpired",
      status,
      "The client secret of the app registration has expired",
    );
  }
  if (/AADSTS(90002|900023)/.test(text)) {
    return new GraphMailError("graphTenantUnknown", status, "Microsoft Entra ID does not know the tenant");
  }
  if (/AADSTS(700016|7000229)/.test(text)) {
    return new GraphMailError(
      "graphApplicationUnknown",
      status,
      "The app registration does not exist in the tenant",
    );
  }
  return new GraphMailError(
    "graphCredentialInvalid",
    status,
    "Microsoft Entra ID refused the client secret or certificate",
  );
}

function sendFailure(status: number, code: string, message: string): GraphMailError {
  if (status === 403 && /AccessPolicy|RAOP|ApplicationAccessPolicy/i.test(message)) {
    return new GraphMailError("graphMailboxNotAllowed", status, "The app may not send as this mailbox");
  }
  if (status === 403) {
    return new GraphMailError("graphPermissionMissing", status, "The app has no permission to send e-mail");
  }
  if (status === 404 || code === "ErrorInvalidUser" || code === "MailboxNotEnabledForRESTAPI") {
    return new GraphMailError(
      "graphMailboxUnknown",
      status,
      "The sender mailbox does not exist in the tenant",
    );
  }
  if (status === 401) {
    return new GraphMailError("graphCredentialInvalid", status, "Microsoft Graph refused the access token");
  }
  return new GraphMailError("graphRefused", status, `Microsoft Graph refused the e-mail (${status})`);
}

export class GraphMailTransport implements MailTransport {
  readonly #configuration: GraphMailConfiguration;
  readonly #credentials: readonly GraphClientCredential[];
  readonly #fetch: typeof fetch;
  readonly #tokens: GraphTokenCache;

  constructor(options: {
    configuration: GraphMailConfiguration;
    credentials: readonly GraphClientCredential[];
    tokens: GraphTokenCache;
    fetch?: typeof fetch;
  }) {
    this.#configuration = options.configuration;
    this.#credentials = options.credentials;
    this.#tokens = options.tokens;
    this.#fetch = options.fetch ?? fetch;
  }

  async #request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new GraphMailError("graphUnreachable", null, "Microsoft Graph could not be reached");
    }
  }

  #cacheKey(): string {
    const config = this.#configuration;
    return JSON.stringify([
      config.authority,
      config.tenantId,
      config.clientId,
      this.#credentials.map((item) => item.id),
    ]);
  }

  async #token(): Promise<string> {
    const key = this.#cacheKey();
    const cached = this.#tokens.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    if (this.#credentials.length === 0) {
      throw new GraphMailError(
        "graphCredentialMissing",
        null,
        "No valid client secret or certificate is stored",
      );
    }
    let failure: GraphMailError | null = null;
    for (const credential of this.#credentials) {
      const result = await requestGraphToken({
        request: (url, init) => this.#request(url, init),
        authority: this.#configuration.authority,
        tenantId: this.#configuration.tenantId,
        clientId: this.#configuration.clientId,
        graphUrl: this.#configuration.graphUrl,
        credential,
      });
      if (result.ok) {
        this.#tokens.set(key, {
          token: result.token,
          expiresAt: Date.now() + (result.expiresIn - 60) * 1000,
        });
        return result.token;
      }
      failure =
        result.status >= 500
          ? new GraphMailError("graphUnreachable", result.status, "Microsoft Entra ID is not available")
          : tokenFailure(result.status, result.description);
      if (result.status !== 400 && result.status !== 401) break;
    }
    throw failure ?? new GraphMailError("graphCredentialInvalid", null, "No access token was issued");
  }

  async #mime(message: MailMessage): Promise<string> {
    const config = this.#configuration;
    const composed = await createTransport({ streamTransport: true, buffer: true }).sendMail({
      from: config.senderName ? { name: config.senderName, address: config.sender } : config.sender,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.headers ? { headers: message.headers } : {}),
      ...(message.messageId ? { messageId: message.messageId } : {}),
    });
    return Buffer.from(composed.message as Buffer).toString("base64");
  }

  async send(message: MailMessage): Promise<void> {
    const config = this.#configuration;
    const token = await this.#token();
    const request = message.headers
      ? { type: "text/plain", content: await this.#mime(message) }
      : {
          type: "application/json",
          content: JSON.stringify({
            message: {
              subject: message.subject,
              body: { contentType: "HTML", content: message.html },
              toRecipients: [{ emailAddress: { address: message.to } }],
              ...(config.senderName
                ? { from: { emailAddress: { address: config.sender, name: config.senderName } } }
                : {}),
            },
            saveToSentItems: false,
          }),
        };
    const response = await this.#request(
      `${config.graphUrl}/v1.0/users/${encodeURIComponent(config.sender)}/sendMail`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": request.type },
        body: request.content,
      },
    );
    if (response.status === 202 || response.ok) return;
    if (response.status === 401) this.#tokens.delete(this.#cacheKey());
    if (response.status === 429 || response.status >= 500) {
      throw new GraphMailError(
        "graphUnreachable",
        response.status,
        "Microsoft Graph is busy or not available",
      );
    }
    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: unknown; message?: unknown };
    };
    throw sendFailure(
      response.status,
      typeof body.error?.code === "string" ? body.error.code : "",
      typeof body.error?.message === "string" ? body.error.message : "",
    );
  }
}
