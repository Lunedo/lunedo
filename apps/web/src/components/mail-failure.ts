import type { TFunction } from "i18next";
import { translateKey } from "../i18n/translate.js";

type Cause =
  | "dns"
  | "connection"
  | "timeout"
  | "connectTimeout"
  | "greetingTimeout"
  | "sendTimeout"
  | "socket"
  | "tls"
  | "auth"
  | "authToken"
  | "tokenUnreachable"
  | "clientRejected"
  | "notAuthorized"
  | "scopeRejected"
  | "tokenRefused"
  | "keyInvalid"
  | "envelope"
  | "refused"
  | "deferred"
  | "unknown";

const CAUSES: Record<string, Cause> = {
  EDNS: "dns",
  ENOTFOUND: "dns",
  EAI_AGAIN: "dns",
  ECONNECTION: "connection",
  ECONNREFUSED: "connection",
  EHOSTUNREACH: "connection",
  ENETUNREACH: "connection",
  ETIMEDOUT: "timeout",
  SMTP_CONNECT_TIMEOUT: "connectTimeout",
  SMTP_GREETING_TIMEOUT: "greetingTimeout",
  SMTP_SEND_TIMEOUT: "sendTimeout",
  ESOCKET: "socket",
  ECONNRESET: "socket",
  ETLS: "tls",
  CERT_HAS_EXPIRED: "tls",
  DEPTH_ZERO_SELF_SIGNED_CERT: "tls",
  SELF_SIGNED_CERT_IN_CHAIN: "tls",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "tls",
  ERR_TLS_CERT_ALTNAME_INVALID: "tls",
  EAUTH: "auth",
  ENOAUTH: "auth",
  EENVELOPE: "envelope",
  oauthTokenUnreachable: "tokenUnreachable",
  oauthClientRejected: "clientRejected",
  oauthNotAuthorized: "notAuthorized",
  oauthScopeRejected: "scopeRejected",
  oauthTokenRefused: "tokenRefused",
  oauthKeyInvalid: "keyInvalid",
};

const STEPS = ["token", "connect", "authenticate", "send"] as const;

export interface MailFailureDetails {
  code: string | null;
  responseCode: number | null;
  step?: string | null;
}

export function mailFailure(
  t: TFunction,
  error: MailFailureDetails | null,
  options: { oauth2?: boolean } = {},
): { cause: string; details: string | null } {
  const code = error?.code ?? null;
  const response = error?.responseCode ?? null;
  let cause: Cause = (code ? CAUSES[code] : undefined) ?? "unknown";
  if (cause === "unknown" && response !== null) cause = response >= 500 ? "refused" : "deferred";
  if (cause === "auth" && options.oauth2) cause = "authToken";
  const step = STEPS.find((entry) => entry === error?.step);
  const parts = [code, response === null ? null : String(response)].filter((part) => part !== null);
  const details = [
    step ? t("mail.failureStep", { step: t(`mail.failureSteps.${step}`) }) : null,
    parts.length > 0 ? t("mail.failureCode", { code: parts.join(" ") }) : null,
  ].filter((part) => part !== null);
  return {
    cause: translateKey(t, `mail.failureCauses.${cause}`, { response: response ?? "" }),
    details: details.length > 0 ? details.join(" · ") : null,
  };
}
