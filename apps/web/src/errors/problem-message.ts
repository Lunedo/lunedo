import type { TFunction } from "i18next";
import { ApiError } from "../api/request.js";
import { translateKey } from "../i18n/translate.js";

const KNOWN = new Set([
  "resetOwnSecondFactor",
  "invalidProviderConfiguration",
  "passwordSignInDisabled",
  "identityInUse",
  "lastCredential",
  "lastSignInMethod",
  "endOwnSessions",
  "roleNeedsAccountOrGroup",
  "invalidInput",
  "passwordPolicy",
  "invalidToken",
  "sameEmail",
  "invalidSmtpConfiguration",
  "invalidSetting",
  "invalidPrincipal",
  "roleNotAssignable",
  "ownerExpiry",
  "expiryInPast",
  "credentialExpired",
  "expiryRequired",
  "expiryTooLate",
  "invalidOwner",
  "invalidLogo",
  "invalidScopes",
  "invalidResponsible",
  "invalidInvitation",
  "accountDetailsRequired",
  "notGuest",
  "guestMembership",
  "notMember",
  "invalidCredentials",
  "invalidSecondFactor",
  "challengeExpired",
  "notSignedIn",
  "sessionEnded",
  "invalidSetupCode",
  "setupSessionRequired",
  "forbidden",
  "csrfRejected",
  "secondFactorSetupRequired",
  "reauthenticationRequired",
  "notFound",
  "roleNotFound",
  "groupNotFound",
  "emailInUse",
  "slugTaken",
  "domainTaken",
  "domainInUse",
  "groupManagedByProvider",
  "syncUnavailable",
  "providerDeactivated",
  "accountHasOrganization",
  "syncNotRunning",
  "syncNotHeld",
  "providerUnavailable",
  "invalidServiceAccountKey",
  "roleNameTaken",
  "groupNameTaken",
  "providerGroupNotFound",
  "alreadyMember",
  "alreadyAssigned",
  "lastOwner",
  "homeOrganization",
  "deactivateSelf",
  "instanceOwner",
  "instanceUrlFromEnvironment",
  "instanceMoved",
  "settingLocked",
  "setupIncomplete",
  "setupNotReady",
  "keysNotDownloaded",
  "keysAlreadyDownloaded",
  "totpExists",
  "ownerMissing",
  "lastSecondFactor",
  "noSecondFactor",
  "secondFactorExists",
  "instanceUrlMissing",
  "payloadTooLarge",
  "locked",
  "rateLimited",
  "internalError",
  "busy",
  "networkError",
  "passwordExpired",
  "passwordMustChange",
  "accountLocked",
  "accountDisabled",
  "outsideSignInHours",
  "providerInitiatedSignIn",
  "invalidSamlMetadata",
  "invalidCertificate",
  "confirmationMismatch",
  "anonymizeSelf",
  "notPlaceholder",
  "invalidMailConfiguration",
  "mailNotReady",
]);

const DIRECTORY_PROBLEMS: Record<string, string> = {
  invalidCredentials: "problems.directoryInvalidCredentials",
  providerUnavailable: "problems.directoryUnavailable",
};

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
  if (error.code === "settingLocked" && problem.lockedBy) {
    return t("problems.settingLockedBy", { level: translateKey(t, `settings.levels.${problem.lockedBy}`) });
  }
  return translateKey(t, problemKey(error));
}

export function directoryProblemMessage(t: TFunction, error: unknown): string {
  const key = error instanceof ApiError ? DIRECTORY_PROBLEMS[error.code] : undefined;
  return key ? translateKey(t, key) : problemMessage(t, error);
}
