import type { TFunction } from "i18next";
import { ApiError } from "../api/request.js";
import en from "../i18n/locales/en.json" with { type: "json" };
import { translateKey } from "../i18n/translate.js";

const KNOWN = new Set(Object.keys(en.problems));

let organization = "";

export function setProblemOrganization(name: string): void {
  organization = name;
}

function organizationValues(t: TFunction): { organization: string } {
  return { organization: organization || t("brand.name") };
}

const DIRECTORY_PROBLEMS: Record<string, string> = {
  invalidCredentials: "problems.directoryInvalidCredentials",
  providerUnavailable: "problems.directoryUnavailable",
};

function megabytes(bytes: number): string {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`;
}

export function problemKey(error: unknown): string {
  if (error instanceof ApiError && KNOWN.has(error.code)) return `problems.${error.code}`;
  return "problems.unknown";
}

export function problemMessage(t: TFunction, error: unknown): string {
  if (!(error instanceof ApiError)) return t("problems.unknown");
  const { problem } = error;
  if (error.code === "passwordPolicy") {
    const rule = problem.problem;
    if (rule === "tooShort") return t("problems.passwordTooShort", { minimum: problem.minLength ?? 12 });
    if (rule === "tooLong") return t("problems.passwordTooLong");
    if (rule === "common") return t("problems.passwordCommon");
    return t("problems.passwordPolicy");
  }
  if ((error.code === "rateLimited" || error.code === "locked") && problem.retryAfterSeconds) {
    return translateKey(t, `problems.${error.code}Retry`, { seconds: problem.retryAfterSeconds });
  }
  if (error.code === "invalidSamlMetadata" && problem.detail) {
    return t("problems.invalidSamlMetadataDetail", { detail: problem.detail });
  }
  if (error.code === "fileTooLarge" && problem.maxBytes) {
    return t("problems.fileTooLargeLimit", { size: megabytes(problem.maxBytes) });
  }
  if (error.code === "shareBeyondOwnAccess" && problem.uncoveredPages) {
    return t("problems.shareBeyondOwnAccessBelow", { count: problem.uncoveredPages });
  }
  if (error.code === "statusInUse" && problem.pages) {
    return t("problems.statusInUsePages", { count: problem.pages });
  }
  if (error.code === "confidentialSharing" && problem.pages) {
    return t("problems.confidentialSharingPages", { count: problem.pages });
  }
  if (error.code === "restrictedParentInTrash") {
    const ask = !problem.parentEntries;
    if (problem.formerParent) {
      return t(ask ? "problems.restrictedParentInTrashNamedAsk" : "problems.restrictedParentInTrashNamed", {
        title: problem.formerParent.title,
      });
    }
    return t(ask ? "problems.restrictedParentInTrashAsk" : "problems.restrictedParentInTrash");
  }
  if (error.code === "expiryTooLate" && problem.maxDays) {
    return t("problems.linkExpiryTooLate", { days: problem.maxDays });
  }
  if (error.code === "settingAboveMaximum" && problem.maximum !== undefined) {
    return problem.maximum === "unlimited"
      ? t("problems.settingAboveMaximum")
      : t("problems.settingAboveMaximumValue", { maximum: problem.maximum });
  }
  if (error.code === "invalidChatAddress" && problem.problem) {
    const key = `problems.chatAddress.${problem.problem}`;
    const text = translateKey(t, key);
    if (text !== key) return text;
  }
  if (error.code === "settingLocked" && problem.lockedBy) {
    return t("problems.settingLockedBy", { level: translateKey(t, `settings.levels.${problem.lockedBy}`) });
  }
  return translateKey(t, problemKey(error), organizationValues(t));
}

export function directoryProblemMessage(t: TFunction, error: unknown): string {
  const key = error instanceof ApiError ? DIRECTORY_PROBLEMS[error.code] : undefined;
  return key ? translateKey(t, key, organizationValues(t)) : problemMessage(t, error);
}
