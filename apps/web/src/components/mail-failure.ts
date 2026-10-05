import type { TFunction } from "i18next";
import { translateKey } from "../i18n/translate.js";

type Cause =
  | "dns"
  | "connection"
  | "timeout"
  | "socket"
  | "tls"
  | "auth"
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
};

export function mailFailure(
  t: TFunction,
  error: { code: string | null; responseCode: number | null } | null,
): { cause: string; details: string | null } {
  const code = error?.code ?? null;
  const response = error?.responseCode ?? null;
  let cause: Cause = (code ? CAUSES[code] : undefined) ?? "unknown";
  if (cause === "unknown" && response !== null) cause = response >= 500 ? "refused" : "deferred";
  const parts = [code, response === null ? null : String(response)].filter((part) => part !== null);
  return {
    cause: translateKey(t, `mail.failureCauses.${cause}`, { response: response ?? "" }),
    details: parts.length > 0 ? t("mail.failureCode", { code: parts.join(" ") }) : null,
  };
}
