import type { TFunction } from "i18next";
import { ApiError } from "../api/request.js";
import { translateKey } from "../i18n/translate.js";

const KNOWN = new Set([
  "shareBeyondOwnAccess",
  "ownShare",
  "confidentialSharing",
  "moveChangesAccess",
  "spaceNotImported",
  "importedBeforeReimports",
  "importNotAccepted",
  "reimportRunning",
  "reimportApplying",
  "reimportNotInReview",
  "changesUnavailable",
  "changeNotFound",
  "changeApplied",
  "changeNotComparable",
  "comparisonUnavailable",
  "comparisonWithheld",
  "invalidDecision",
  "holderNotInPagehall",
  "differenceResolved",
  "notRestricted",
  "reimportSpaceFixed",
  "importStarted",
  "importNotReady",
  "importNotRunning",
  "importNotInReview",
  "importNotHeld",
  "importFinished",
  "importFolderDisabled",
  "importFolderUnavailable",
  "importFileUnavailable",
  "reportUnavailable",
  "uploadIncomplete",
  "uploadComplete",
  "invalidUpload",
  "invalidUploadPart",
  "uploadChecksumMismatch",
  "invalidSource",
  "invalidSourceUrl",
  "invalidReviewer",
  "tooManyReviewers",
  "uploadTooLarge",
  "invalidComment",
  "invalidAnchor",
  "anchorNotFound",
  "tooManyComments",
  "restoreExpired",
  "notInlineComment",
  "invalidEmoji",
  "reactionsDisabled",
  "tooManyReactions",
  "reactionsUnavailable",
  "invalidExcerpt",
  "invalidTimeZone",
  "scheduleInPast",
  "scheduleTooLate",
  "notPublished",
  "notInOrganization",
  "blogPostMode",
  "tooManyStars",
  "personalOnly",
  "invalidHomePage",
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
  "settingAboveMaximum",
  "setupIncomplete",
  "setupNotReady",
  "keysNotDownloaded",
  "keysAlreadyDownloaded",
  "totpExists",
  "ownerMissing",
  "totpMissing",
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
  "invalidFileName",
  "invalidItem",
  "invalidCover",
  "invalidFocus",
  "invalidScope",
  "peopleRequired",
  "tooManyPeople",
  "invalidPassword",
  "messageTooLong",
  "invalidRole",
  "signInRequired",
  "passwordRequired",
  "wrongPassword",
  "linkNotForYou",
  "guestInvitesDisabled",
  "attachmentNotFound",
  "versionNotFound",
  "shareNotFound",
  "restrictionNotFound",
  "linkNotFound",
  "requestNotFound",
  "personNotFound",
  "nameTaken",
  "alreadyShared",
  "restrictionWithoutViewers",
  "restrictionWithoutEditors",
  "shareLinksDisabled",
  "anyoneLinksDisabled",
  "restrictedPage",
  "requestClosed",
  "alreadyHasAccess",
  "fileTooLarge",
  "rangeNotSatisfiable",
  "tooManyRequests",
]);

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
  if (error.code === "confidentialSharing" && problem.pages) {
    return t("problems.confidentialSharingPages", { count: problem.pages });
  }
  if (error.code === "expiryTooLate" && problem.maxDays) {
    return t("problems.linkExpiryTooLate", { days: problem.maxDays });
  }
  if (error.code === "settingAboveMaximum" && problem.maximum !== undefined) {
    return problem.maximum === "unlimited"
      ? t("problems.settingAboveMaximum")
      : t("problems.settingAboveMaximumValue", { maximum: problem.maximum });
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
