import type { TFunction } from "i18next";
import { translateKey } from "../i18n/translate.js";

export function kindLabel(t: TFunction, kind: string): string {
  return translateKey(t, `chatChannels.kinds.${kind}`);
}

export function failureText(
  t: TFunction,
  kind: string,
  failure: { reason: string; status: number | null; code: string | null },
): string {
  const service = kindLabel(t, kind);
  const answer = failure.code
    ? t("chatChannels.answerCode", { code: failure.code })
    : failure.status
      ? t("chatChannels.answerStatus", { status: failure.status })
      : "";
  const reason =
    failure.reason === "unauthorized" && kind === "matrix"
      ? t("chatChannels.failures.unauthorizedMatrix")
      : translateKey(t, `chatChannels.failures.${failure.reason}`, { service });
  return answer ? `${answer} ${reason}` : reason;
}
