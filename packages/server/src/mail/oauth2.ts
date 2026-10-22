import { createHash } from "node:crypto";
import { microsoftAuthorities, type SmtpOAuth2Configuration } from "@lunedo/shared";
import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";

const TIMEOUT_MS = 30_000;

export const MICROSOFT_SMTP_SCOPE = "https://outlook.office365.com/.default";
export const GOOGLE_MAIL_SCOPE = "https://mail.google.com/";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const MICROSOFT_AUTHORITIES: readonly string[] = microsoftAuthorities;

export const mailTokenErrorCodes = [
  "oauthTokenUnreachable",
  "oauthClientRejected",
  "oauthNotAuthorized",
  "oauthScopeRejected",
  "oauthTokenRefused",
  "oauthKeyInvalid",
] as const;
export type MailTokenErrorCode = (typeof mailTokenErrorCodes)[number];

export class MailTokenError extends Error {
  override name = "MailTokenError";

  constructor(
    readonly code: MailTokenErrorCode,
    readonly responseCode: number | null,
    message: string,
  ) {
    super(message);
  }
}

export class MailOAuth2ConfigurationError extends Error {
  override name = "MailOAuth2ConfigurationError";
}

const serviceAccountKeySchema = z.object({
  type: z.literal("service_account"),
  client_email: z.email(),
  client_id: z.string(),
  private_key: z.string().min(1),
});

export interface ServiceAccountKey {
  clientEmail: string;
  clientId: string;
  privateKey: string;
}

export function parseServiceAccountKey(json: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new MailOAuth2ConfigurationError("The key file of the service account is not JSON");
  }
  const key = serviceAccountKeySchema.safeParse(parsed);
  if (!key.success) {
    throw new MailOAuth2ConfigurationError("The file is not a key of a Google service account");
  }
  return {
    clientEmail: key.data.client_email.toLowerCase(),
    clientId: key.data.client_id,
    privateKey: key.data.private_key,
  };
}

export function checkOAuth2Configuration(
  configuration: SmtpOAuth2Configuration,
  options: { allowInsecure: boolean },
): void {
  if (options.allowInsecure) return;
  if (configuration.provider === "generic" && new URL(configuration.tokenUrl).protocol !== "https:") {
    throw new MailOAuth2ConfigurationError("The token endpoint must use HTTPS");
  }
}

export function tokenFingerprint(
  configuration: SmtpOAuth2Configuration,
  mailbox: string,
  secret: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify([configuration, mailbox.toLowerCase(), secret]))
    .digest("base64url");
}

function tokenEndpoint(configuration: SmtpOAuth2Configuration): string {
  switch (configuration.provider) {
    case "microsoft365":
      return `${configuration.authority}/${configuration.tenantId}/oauth2/v2.0/token`;
    case "google":
      return GOOGLE_TOKEN_URL;
    case "generic":
      return configuration.tokenUrl;
  }
}

async function tokenForm(
  configuration: SmtpOAuth2Configuration,
  mailbox: string,
  secret: string,
): Promise<URLSearchParams> {
  if (configuration.provider === "google") {
    let key: Awaited<ReturnType<typeof importPKCS8>>;
    try {
      key = await importPKCS8(secret, "RS256");
    } catch {
      throw new MailTokenError(
        "oauthKeyInvalid",
        null,
        "The private key of the service account is not valid",
      );
    }
    const assertion = await new SignJWT({ scope: GOOGLE_MAIL_SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(configuration.serviceAccount)
      .setSubject(mailbox)
      .setAudience(GOOGLE_TOKEN_URL)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key);
    return new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    });
  }
  return new URLSearchParams({
    grant_type: "client_credentials",
    client_id: configuration.clientId,
    client_secret: secret,
    scope: configuration.provider === "microsoft365" ? MICROSOFT_SMTP_SCOPE : configuration.scope,
  });
}

function refusal(status: number, error: string | null): MailTokenError {
  if (error === "invalid_client") {
    return new MailTokenError(
      "oauthClientRejected",
      status,
      "The token endpoint refused the client credentials",
    );
  }
  if (error === "unauthorized_client" || error === "access_denied") {
    return new MailTokenError(
      "oauthNotAuthorized",
      status,
      "The client may not get a token for this mailbox",
    );
  }
  if (error === "invalid_scope") {
    return new MailTokenError("oauthScopeRejected", status, "The token endpoint refused the scope");
  }
  return new MailTokenError(
    "oauthTokenRefused",
    status,
    `The token endpoint refused the request (${status})`,
  );
}

export interface MailAccessToken {
  token: string;
  expiresAt: number;
}

export async function requestMailToken(input: {
  configuration: SmtpOAuth2Configuration;
  mailbox: string;
  secret: string;
  fetch?: typeof fetch;
  now?: () => number;
}): Promise<MailAccessToken> {
  const form = await tokenForm(input.configuration, input.mailbox, input.secret);
  const now = input.now ?? Date.now;
  let response: Response;
  try {
    response = await (input.fetch ?? fetch)(tokenEndpoint(input.configuration), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new MailTokenError("oauthTokenUnreachable", null, "The token endpoint could not be reached");
  }
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: unknown;
    expires_in?: unknown;
    error?: unknown;
  };
  if (response.ok && typeof body.access_token === "string" && body.access_token) {
    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : Number(body.expires_in);
    return {
      token: body.access_token,
      expiresAt: now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
    };
  }
  if (response.status >= 500 || response.status === 429) {
    throw new MailTokenError(
      "oauthTokenUnreachable",
      response.status,
      "The token endpoint is busy or not available",
    );
  }
  throw refusal(response.status, typeof body.error === "string" ? body.error : null);
}
