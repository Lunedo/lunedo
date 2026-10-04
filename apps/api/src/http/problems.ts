import { HttpException } from "@nestjs/common";
import { z } from "zod";

export const PROBLEM_TYPE_PREFIX = "urn:pagehall:problem:";

export const problems = {
  invalidInput: { status: 400, title: "The request is not valid" },
  passwordPolicy: { status: 400, title: "The password does not meet the policy" },
  invalidToken: { status: 400, title: "The link or code is not valid" },
  sameEmail: { status: 400, title: "The new e-mail address is the current one" },
  invalidSmtpConfiguration: { status: 400, title: "The mail server configuration is not valid" },
  invalidSetting: { status: 400, title: "The setting value is not valid" },
  settingManagedElsewhere: { status: 400, title: "The setting is changed through another endpoint" },
  ambiguousCredentials: { status: 400, title: "The request carries both a session and an API token" },
  invalidPrincipal: { status: 400, title: "The role cannot go to this principal" },
  roleNeedsAccountOrGroup: { status: 400, title: "The role can only go to individual accounts and groups" },
  roleNotAssignable: { status: 400, title: "The role cannot be assigned" },
  ownerExpiry: { status: 400, title: "The owner role cannot expire" },
  expiryInPast: { status: 400, title: "The expiry lies in the past" },
  expiryRequired: { status: 400, title: "An expiry date is required" },
  expiryTooLate: { status: 400, title: "The expiry exceeds the maximum lifetime" },
  invalidOwner: { status: 400, title: "The owner is not valid" },
  invalidLogo: { status: 400, title: "The logo is not a supported image" },
  invalidProviderConfiguration: { status: 400, title: "The identity provider configuration is not valid" },
  invalidScopes: { status: 400, title: "The scopes are not valid" },
  invalidResponsible: { status: 400, title: "The responsible person is not valid" },
  invalidInvitation: { status: 400, title: "The invitation is not valid" },
  accountDetailsRequired: { status: 400, title: "The account details are missing" },
  accountRequired: { status: 400, title: "An account is required" },
  notGuest: { status: 400, title: "The account is not a guest" },
  notMember: { status: 400, title: "The account is not a member" },
  invalidCredentials: { status: 401, title: "The credentials are not valid" },
  invalidSecondFactor: { status: 401, title: "The second factor is not valid" },
  challengeExpired: { status: 401, title: "The sign-in step expired" },
  notSignedIn: { status: 401, title: "Sign in or send an API token" },
  sessionEnded: { status: 401, title: "The session ended" },
  invalidApiToken: { status: 401, title: "The API token is not valid" },
  invalidSetupCode: { status: 401, title: "The setup code is not valid" },
  setupSessionRequired: { status: 401, title: "Enter the setup code first" },
  forbidden: { status: 403, title: "Not allowed" },
  csrfRejected: { status: 403, title: "The request failed the cross-site request check" },
  secondFactorSetupRequired: { status: 403, title: "Set up a second factor first" },
  reauthenticationRequired: { status: 403, title: "Confirm your identity first" },
  sessionRequired: { status: 403, title: "This endpoint needs a signed-in session" },
  passwordSignInDisabled: { status: 403, title: "Sign-in with a password is turned off" },
  notFound: { status: 404, title: "Not found" },
  methodNotAllowed: { status: 405, title: "The method is not allowed" },
  roleNotFound: { status: 404, title: "The role does not exist" },
  groupNotFound: { status: 404, title: "The group does not exist" },
  unknownSetupAction: { status: 404, title: "The setup action does not exist" },
  emailInUse: { status: 409, title: "The e-mail address is in use" },
  slugTaken: { status: 409, title: "The slug is taken" },
  domainTaken: { status: 409, title: "The domain belongs to another organization" },
  roleNameTaken: { status: 409, title: "The role name is taken" },
  groupNameTaken: { status: 409, title: "The group name is taken" },
  alreadyMember: { status: 409, title: "The account is already a member" },
  alreadyAssigned: { status: 409, title: "The role is already assigned" },
  identityInUse: { status: 409, title: "The identity is linked to an account already" },
  domainInUse: { status: 409, title: "A domain belongs to another identity provider" },
  invalidServiceAccountKey: { status: 400, title: "The service account key is not valid" },
  syncUnavailable: { status: 409, title: "The provider cannot be synchronized" },
  accountHasOrganization: { status: 409, title: "The account belongs to an organization already" },
  providerDeactivated: { status: 409, title: "The identity provider is deactivated" },
  invalidSamlMetadata: { status: 400, title: "The SAML metadata cannot be used" },
  invalidCertificate: { status: 400, title: "The certificate cannot be used" },
  providerInitiatedSignIn: { status: 403, title: "Sign-in started at the identity provider is turned off" },
  passwordExpired: { status: 403, title: "The directory password has expired" },
  passwordMustChange: { status: 403, title: "The directory password must be changed" },
  accountLocked: { status: 403, title: "The directory account is locked" },
  accountDisabled: { status: 403, title: "The directory account is disabled" },
  outsideSignInHours: { status: 403, title: "Sign-in is not allowed at this time" },
  syncNotRunning: { status: 409, title: "The run is not running anymore" },
  providerUnavailable: { status: 502, title: "The identity provider could not be reached" },
  groupManagedByProvider: { status: 409, title: "The group is managed by an identity provider" },
  lastCredential: { status: 409, title: "The last credential cannot be removed" },
  lastSignInMethod: { status: 409, title: "The last way to sign in cannot be removed" },
  lastOwner: { status: 409, title: "The last owner cannot leave" },
  homeOrganization: { status: 409, title: "An account cannot leave its home organization" },
  deactivateSelf: { status: 409, title: "An account cannot deactivate itself" },
  endOwnSessions: { status: 409, title: "Own sessions are ended on the security page" },
  resetOwnSecondFactor: { status: 409, title: "An account cannot reset its own second factor this way" },
  instanceOwner: { status: 409, title: "The instance owner cannot be changed this way" },
  settingLocked: { status: 409, title: "A higher level locked the setting" },
  setupIncomplete: { status: 409, title: "The setup is not complete" },
  setupNotReady: { status: 409, title: "The setup step is not ready" },
  keysNotDownloaded: { status: 409, title: "Download the keys first" },
  keysAlreadyDownloaded: { status: 409, title: "The keys were already downloaded" },
  totpExists: { status: 409, title: "An authenticator app is already set up" },
  ownerMissing: { status: 409, title: "The owner account is missing" },
  lastSecondFactor: { status: 409, title: "The last second factor cannot be removed" },
  noSecondFactor: { status: 409, title: "No second factor is set up" },
  secondFactorExists: { status: 409, title: "The second factor already exists" },
  instanceUrlMissing: { status: 409, title: "The instance URL is not set" },
  payloadTooLarge: { status: 413, title: "The request body is too large" },
  unsupportedMediaType: { status: 415, title: "The request body has an unsupported type" },
  locked: { status: 429, title: "Too many failed attempts" },
  rateLimited: { status: 429, title: "Too many requests" },
  internalError: { status: 500, title: "Internal server error" },
  busy: { status: 503, title: "The server is busy" },
} as const satisfies Record<string, { status: number; title: string }>;

export type ProblemCode = keyof typeof problems;

export function isProblemCode(code: string): code is ProblemCode {
  return Object.hasOwn(problems, code);
}

export function problemType(code: ProblemCode): string {
  return `${PROBLEM_TYPE_PREFIX}${code}`;
}

export const problemSchema = z
  .object({
    type: z.string().describe("Stable identifier of the error kind. Clients branch on this value."),
    title: z.string().describe("Short summary of the error kind. It does not change between occurrences."),
    status: z.number().int().describe("HTTP status code of the response."),
    detail: z.string().optional().describe("Explanation of this occurrence, for people."),
    code: z.string().describe("The last part of `type`, for clients that prefer a short key."),
    fields: z
      .array(z.string().describe("Path of an invalid field, with dots between levels."))
      .optional()
      .describe("Invalid fields, for `invalidInput`."),
    denials: z
      .array(z.string().describe("Reason code of the authorization service."))
      .optional()
      .describe("Why the request was not allowed, for `forbidden`."),
    retryAfterSeconds: z
      .number()
      .int()
      .optional()
      .describe("Seconds to wait before retrying, for `rateLimited` and `locked`."),
    problem: z.string().optional().describe("Which password rule failed, for `passwordPolicy`."),
    minLength: z.number().int().optional().describe("Minimum password length, for `passwordPolicy`."),
    lockedBy: z.string().optional().describe("Level that locked the setting, for `settingLocked`."),
    maxLifetimeDays: z
      .number()
      .int()
      .optional()
      .describe("Maximum lifetime of API tokens in days, for `expiryRequired` and `expiryTooLate`."),
    domains: z
      .array(z.string().describe("A domain."))
      .optional()
      .describe("Domains that belong to another identity provider, for `domainInUse`."),
  })
  .describe("Error response following RFC 9457 Problem Details.");

export type ProblemBody = z.input<typeof problemSchema>;

export function problemBody(code: ProblemCode, detail?: string, extensions: Record<string, unknown> = {}) {
  const { status, title } = problems[code];
  return {
    type: problemType(code),
    title,
    status,
    ...(detail ? { detail } : {}),
    code,
    ...extensions,
  };
}

export class ProblemException extends HttpException {
  constructor(
    readonly code: ProblemCode,
    detail?: string,
    readonly extensions: Record<string, unknown> = {},
  ) {
    super(problemBody(code, detail, extensions), problems[code].status);
  }
}

export function notFound(detail = "Not found"): ProblemException {
  return new ProblemException("notFound", detail);
}
