import { HttpException } from "@nestjs/common";
import { z } from "zod";
import { moveImpactSchema } from "../spaces/schemas.js";
import { uuid } from "./schemas.js";

export const PROBLEM_TYPE_PREFIX = "urn:pagehall:problem:";

export const problems = {
  invalidInput: { status: 400, title: "The request is not valid" },
  passwordPolicy: { status: 400, title: "The password does not meet the policy" },
  invalidToken: { status: 400, title: "The link or code is not valid" },
  sameEmail: { status: 400, title: "The new e-mail address is the current one" },
  invalidSmtpConfiguration: { status: 400, title: "The mail server configuration is not valid" },
  invalidMailConfiguration: { status: 400, title: "The e-mail configuration is not valid" },
  invalidSetting: { status: 400, title: "The setting value is not valid" },
  settingBelowMinimum: { status: 400, title: "The value is below the minimum set for the instance" },
  settingAboveMaximum: { status: 400, title: "The value is above the maximum set for the instance" },
  settingManagedElsewhere: { status: 400, title: "The setting is changed through another endpoint" },
  ambiguousCredentials: { status: 400, title: "The request carries both a session and an API token" },
  invalidPrincipal: { status: 400, title: "The role cannot go to this principal" },
  roleNeedsAccountOrGroup: { status: 400, title: "The role can only go to individual accounts and groups" },
  roleNotAssignable: { status: 400, title: "The role cannot be assigned" },
  ownerExpiry: { status: 400, title: "The owner role cannot expire" },
  expiryInPast: { status: 400, title: "The expiry lies in the past" },
  credentialExpired: { status: 409, title: "The credential has expired" },
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
  guestMembership: { status: 400, title: "Guest and portal accounts can only be guests" },
  notMember: { status: 400, title: "The account is not a member" },
  confirmationMismatch: { status: 400, title: "The confirmation does not match" },
  anonymizeSelf: { status: 400, title: "An account cannot anonymize itself" },
  invalidSpaceKey: { status: 400, title: "The space key is not valid" },
  invalidSpaceName: { status: 400, title: "The space name is not valid" },
  invalidSpaceDescription: { status: 400, title: "The space description is too long" },
  invalidHolder: { status: 400, title: "The holder cannot get a role in this space" },
  personalSpaceVisibility: { status: 400, title: "Personal spaces are always private" },
  invalidTitle: { status: 400, title: "The title is not valid" },
  invalidDescription: { status: 400, title: "The description is too long" },
  invalidLinkUrl: { status: 400, title: "The link address is not valid" },
  invalidLinkTarget: { status: 400, title: "The link target is not valid" },
  invalidPlacement: { status: 400, title: "The place in the page tree is not valid" },
  invalidConversion: { status: 400, title: "The item cannot be converted" },
  invalidDocument: { status: 400, title: "The document does not match the editor schema" },
  invalidLabel: { status: 400, title: "The label is not valid" },
  invalidComment: { status: 400, title: "The comment does not match the comment schema" },
  invalidAnchor: { status: 400, title: "The selected text cannot carry a comment" },
  notInlineComment: { status: 400, title: "Only inline comments can be resolved" },
  invalidEmoji: { status: 400, title: "The reaction is not a single emoji" },
  reactionsUnavailable: { status: 400, title: "Only people can react" },
  invalidExcerpt: { status: 400, title: "The excerpt is too long" },
  scheduleInPast: { status: 400, title: "The scheduled time lies in the past" },
  scheduleTooLate: { status: 400, title: "The scheduled time is too far ahead" },
  notInOrganization: { status: 400, title: "The blog post does not belong to an organization" },
  invalidKind: { status: 400, title: "This kind of item cannot be created here" },
  personalOnly: { status: 400, title: "Only people have this personal data" },
  invalidHomePage: { status: 400, title: "The page cannot be the organization home page" },
  invalidNote: { status: 400, title: "The note is too long" },
  reasonRequired: { status: 400, title: "A reason is required" },
  invalidTemplateName: { status: 400, title: "The template name is not valid" },
  invalidTemplateFields: { status: 400, title: "The input fields of the template are not valid" },
  unknownTemplateField: { status: 400, title: "The template uses an input field that does not exist" },
  invalidTemplateValues: { status: 400, title: "Some input values are missing or not valid" },
  selfAppointment: { status: 400, title: "Nobody can give themselves access this way" },
  invalidFileName: { status: 400, title: "The file name is not valid" },
  invalidUpload: { status: 400, title: "The upload is not valid" },
  invalidUploadPart: { status: 400, title: "The part of the upload is not valid" },
  uploadChecksumMismatch: { status: 400, title: "The uploaded data does not match its checksum" },
  invalidSource: { status: 400, title: "The export format is not valid" },
  invalidSourceUrl: { status: 400, title: "The address of the source site is not valid" },
  invalidReviewer: { status: 400, title: "The reviewer is not valid" },
  invalidChatChannel: { status: 400, title: "The chat channel is not valid" },
  invalidChatAddress: { status: 400, title: "The address of the chat service is not valid" },
  chatAddressBlocked: { status: 400, title: "The address points to a private network" },
  chatAddressInsecure: { status: 400, title: "The address needs HTTPS" },
  confidentialSpace: { status: 409, title: "Confidential spaces cannot post to chat channels" },
  tooManyChatChannels: { status: 409, title: "There are too many chat channels" },
  pushDisabled: { status: 409, title: "Browser push is turned off for this instance" },
  invalidPushSubscription: { status: 400, title: "The push subscription is not valid" },
  tooManyPushDevices: { status: 409, title: "There are too many devices with browser push" },
  tooManyReviewers: { status: 400, title: "The import has too many reviewers" },
  skipNotConfirmed: { status: 400, title: "Skipping the people step needs a confirmation" },
  invalidAtlassianSite: { status: 400, title: "The Atlassian site is not allowed" },
  invalidAtlassianEmail: { status: 400, title: "The Atlassian e-mail address is not valid" },
  invalidAtlassianToken: { status: 400, title: "The Atlassian API token is not valid" },
  atlassianUnauthorized: { status: 400, title: "Atlassian refused the API token" },
  userListInvalid: { status: 400, title: "The file is not a user list from Atlassian" },
  invalidMapping: { status: 400, title: "The mapping is not valid" },
  invalidMappingTarget: { status: 400, title: "The account cannot take over the placeholder" },
  invalidItem: { status: 400, title: "Files can only be attached to pages and blog posts" },
  invalidCover: { status: 400, title: "The cover must be an image attached to the post" },
  invalidFocus: { status: 400, title: "The focal point lies outside the image" },
  invalidScope: { status: 400, title: "The link scope cannot be used here" },
  peopleRequired: { status: 400, title: "The link needs at least one person or group" },
  tooManyPeople: { status: 400, title: "The link names too many people or groups" },
  invalidPassword: { status: 400, title: "The link password is not valid" },
  messageTooLong: { status: 400, title: "The message is too long" },
  invalidRole: { status: 400, title: "The role cannot be given here" },
  signInRequired: { status: 401, title: "Sign in to open this link" },
  passwordRequired: { status: 401, title: "The link needs its password" },
  wrongPassword: { status: 401, title: "The link password is not correct" },
  linkNotForYou: { status: 403, title: "The link was shared with other people" },
  guestInvitesDisabled: { status: 403, title: "Members cannot invite guests in this organization" },
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
  keyTaken: { status: 409, title: "The space key is taken" },
  importStarted: { status: 409, title: "The import has started" },
  spaceNotImported: { status: 409, title: "The space was not created by an import" },
  importedBeforeReimports: { status: 409, title: "The space was imported before re-imports were possible" },
  importNotAccepted: { status: 409, title: "The earlier import is not accepted yet" },
  reimportSpaceFixed: { status: 400, title: "The space of a re-import cannot change" },
  reimportRunning: { status: 409, title: "Another re-import of the space is running" },
  reimportApplying: { status: 409, title: "The re-import is applying its changes" },
  reimportNotInReview: { status: 409, title: "The changes do not wait to be applied" },
  changesUnavailable: { status: 409, title: "The changes are not listed yet" },
  changeNotFound: { status: 404, title: "The change does not exist" },
  changeApplied: { status: 409, title: "The change was applied already" },
  changeNotComparable: { status: 409, title: "Only conflicts can be compared" },
  comparisonUnavailable: { status: 409, title: "The comparison is no longer available" },
  comparisonWithheld: { status: 403, title: "The new content is restricted at the source" },
  invalidDecision: { status: 400, title: "The decision does not fit the change" },
  restrictionPending: { status: 409, title: "The restriction from the source is not applied yet" },
  exportDisabled: { status: 403, title: "Export is turned off for this space" },
  exportRunning: { status: 409, title: "Another export of yours is still running" },
  exportStorageFull: { status: 503, title: "The storage for exports is full" },
  nothingToExport: { status: 409, title: "There is nothing to export" },
  tooManyExports: { status: 409, title: "You keep as many exports as allowed" },
  holderNotInPagehall: { status: 409, title: "The person or group is not in Pagehall yet" },
  differenceResolved: { status: 409, title: "The difference no longer exists" },
  notRestricted: { status: 409, title: "The page has no restriction of this kind" },
  importNotReady: { status: 409, title: "The export is still being read" },
  importNotRunning: { status: 409, title: "The import is not running" },
  importNotInReview: { status: 409, title: "The import is not waiting for a decision" },
  importNotHeld: { status: 409, title: "The import is not waiting for an administrator" },
  importFinished: { status: 409, title: "The import is finished" },
  peopleSourceMissing: { status: 409, title: "Choose how people are recognized first" },
  importNotResolvable: { status: 409, title: "People and groups can be mapped once the import has finished" },
  groupAlreadyMapped: { status: 409, title: "The group is mapped already" },
  userListTooLarge: { status: 413, title: "The user list is too large" },
  atlassianRateLimited: { status: 503, title: "Atlassian asked to slow down" },
  atlassianUnreachable: { status: 502, title: "Atlassian could not be reached" },
  importFolderDisabled: { status: 409, title: "The import folder is turned off" },
  importFolderUnavailable: { status: 409, title: "The import folder cannot be read" },
  importFileUnavailable: { status: 409, title: "The file is not in the import folder" },
  reportUnavailable: { status: 409, title: "The report is not available yet" },
  uploadIncomplete: { status: 409, title: "The upload is not complete" },
  uploadComplete: { status: 409, title: "The upload is already complete" },
  alreadyGranted: { status: 409, title: "The holder already has a role in the space" },
  permissionNotFound: { status: 404, title: "The permission does not exist" },
  lastSpaceAdmin: { status: 409, title: "A space needs at least one space admin" },
  selfExtension: { status: 403, title: "Nobody can extend their own permissions" },
  spaceHasAdministrator: { status: 409, title: "The space has a space admin" },
  spaceHasMembers: { status: 409, title: "The space still has active members" },
  confidentialVisibility: { status: 400, title: "A confidential space stays private" },
  confidentialScope: { status: 400, title: "Links in a confidential space name specific people only" },
  confidentialSharing: {
    status: 409,
    title: "The content is shared too broadly for a confidential space",
  },
  seriesEnded: { status: 409, title: "The meeting series has ended" },
  meetingClosed: { status: 409, title: "The meeting is closed already" },
  meetingNotClosed: { status: 409, title: "The meeting is not closed" },
  meetingNotUpcoming: { status: 409, title: "Only the upcoming meeting can change this way" },
  meetingNotEditable: { status: 403, title: "The meeting notes cannot be edited" },
  nextDateRequired: { status: 400, title: "The date of the next meeting is required" },
  startRequired: { status: 400, title: "The start of the meeting is required" },
  attendeeNotFound: { status: 404, title: "The person is not an attendee" },
  invalidMember: { status: 400, title: "The person cannot take part" },
  tooManyMembers: { status: 400, title: "The series has too many members" },
  tooManyAttendees: { status: 400, title: "The meeting has too many attendees" },
  invalidDuration: { status: 400, title: "The duration is not valid" },
  invalidRhythm: { status: 400, title: "The rhythm is not valid" },
  invalidSchedule: { status: 400, title: "The schedule is not valid" },
  invalidTimeZone: { status: 400, title: "The time zone is not known" },
  invalidSeriesDefaults: { status: 400, title: "The defaults of the series template are not valid" },
  topicClosed: { status: 409, title: "The topic is closed already" },
  invalidStatement: { status: 400, title: "The decision is too long" },
  notesNeedAccount: { status: 403, title: "Private notes belong to a person" },
  notesTooLarge: { status: 413, title: "The private notes are too large" },
  notesChanged: { status: 409, title: "The private notes were changed elsewhere" },
  oneOnOneNeedsAccount: { status: 403, title: "A one-on-one is between two people" },
  noSharedOrganization: { status: 409, title: "The two people share no organization" },
  notOneOnOne: { status: 409, title: "The space is not a one-on-one" },
  notOneOnOneMember: { status: 403, title: "Only the remaining person can change the one-on-one" },
  notUnderReview: { status: 409, title: "The personal space is not under review" },
  moveIntoDescendant: { status: 409, title: "An item cannot be moved below itself" },
  itemMoved: { status: 409, title: "The item was moved at the same moment" },
  moveChangesAccess: { status: 409, title: "The move changes who can access the content" },
  restrictedParentInTrash: {
    status: 409,
    title: "The content was below a restricted page that is in the trash",
  },
  overviewPage: { status: 409, title: "The overview page of a space stays a page in its space" },
  tooManyLabels: { status: 409, title: "The page has too many labels" },
  ownerNeedsEditAccess: { status: 400, title: "The new owner cannot edit the item" },
  ownershipNotTransferable: { status: 409, title: "The owner of this item cannot be changed here" },
  invalidStatus: { status: 400, title: "The status is not valid" },
  statusExists: { status: 409, title: "A status with this name exists already" },
  statusNotFound: { status: 404, title: "The status does not exist anymore" },
  statusInUse: { status: 409, title: "Pages use this status" },
  statusDisabled: { status: 409, title: "Page status is turned off in this space" },
  tooManyStatusValues: { status: 409, title: "The space has too many status values" },
  invalidShortcut: { status: 400, title: "The shortcut is not valid" },
  shortcutNotFound: { status: 404, title: "The shortcut does not exist anymore" },
  shortcutTargetNotFound: { status: 400, title: "The content of the shortcut cannot be found" },
  tooManyShortcuts: { status: 409, title: "The space has too many shortcuts" },
  invalidAnnouncement: { status: 400, title: "The announcement is not valid" },
  announcementNotDismissible: { status: 409, title: "A warning cannot be dismissed" },
  announcementChanged: { status: 409, title: "The announcement changed in the meantime" },
  tooManyComments: { status: 409, title: "The page has too many comments" },
  anchorNotFound: { status: 409, title: "The selected text no longer exists" },
  restoreExpired: { status: 409, title: "The time to restore has passed" },
  reactionsDisabled: { status: 409, title: "Reactions are turned off" },
  tooManyReactions: { status: 409, title: "Too many reactions from one person" },
  notPublished: { status: 409, title: "The blog post is not published" },
  notHeld: { status: 409, title: "The blog post is not waiting for approval" },
  blogPostMode: { status: 409, title: "Blog posts always use publish mode" },
  tooManyStars: { status: 409, title: "Too many starred items" },
  tooManySavedSearches: { status: 409, title: "Too many saved searches" },
  notPublishMode: { status: 409, title: "The page is not in publish mode" },
  nothingToDiscard: { status: 409, title: "The draft has no changes to discard" },
  draftPending: { status: 409, title: "The draft has unpublished changes" },
  notArchived: { status: 409, title: "The item is not archived" },
  versionNotFound: { status: 404, title: "The version does not exist" },
  attachmentNotFound: { status: 404, title: "The file does not exist" },
  shareNotFound: { status: 404, title: "The access entry does not exist" },
  restrictionNotFound: { status: 404, title: "The page is not restricted" },
  linkNotFound: { status: 404, title: "The link does not exist, has expired or was revoked" },
  requestNotFound: { status: 404, title: "The access request does not exist" },
  personNotFound: { status: 404, title: "The person does not exist" },
  nameTaken: { status: 409, title: "A file with this name exists" },
  alreadyShared: { status: 409, title: "The page is already shared with them" },
  shareBeyondOwnAccess: { status: 403, title: "A share cannot reach further than your own access" },
  ownShare: { status: 403, title: "Nobody changes access they hold themselves" },
  restrictionWithoutViewers: { status: 409, title: "A restricted page needs someone who can view it" },
  restrictionWithoutEditors: {
    status: 409,
    title: "A page restricted for editing needs someone who can edit it",
  },
  shareLinksDisabled: { status: 409, title: "Share links are turned off" },
  anyoneLinksDisabled: { status: 409, title: "Links for anyone are turned off" },
  restrictedPage: { status: 409, title: "A restricted page cannot be opened by anyone with a link" },
  requestClosed: { status: 409, title: "The access request was already decided" },
  alreadyHasAccess: { status: 409, title: "The person already has access" },
  discardedDraftNotFound: { status: 404, title: "The discarded draft does not exist" },
  trashEntryNotFound: { status: 404, title: "The trash entry does not exist" },
  templateNotFound: { status: 404, title: "The template does not exist" },
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
  notPlaceholder: { status: 409, title: "The account is not a placeholder that can be merged" },
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
  syncNotHeld: { status: 409, title: "The run holds no deactivations to confirm" },
  providerUnavailable: { status: 502, title: "The identity provider could not be reached" },
  providerGroupNotFound: {
    status: 400,
    title: "The group does not exist in the directory of the identity provider",
  },
  groupManagedByProvider: { status: 409, title: "The group is managed by an identity provider" },
  lastCredential: { status: 409, title: "The last credential cannot be removed" },
  lastSignInMethod: { status: 409, title: "The last way to sign in cannot be removed" },
  lastOwner: { status: 409, title: "The last owner cannot leave" },
  homeOrganization: { status: 409, title: "An account cannot leave its home organization" },
  deactivateSelf: { status: 409, title: "An account cannot deactivate itself" },
  endOwnSessions: { status: 409, title: "Own sessions are ended on the security page" },
  resetOwnSecondFactor: { status: 409, title: "An account cannot reset its own second factor this way" },
  instanceOwner: { status: 409, title: "The instance owner cannot be changed this way" },
  instanceUrlFromEnvironment: {
    status: 409,
    title: "The address of the instance is set in the server environment",
  },
  instanceMoved: { status: 409, title: "The instance has moved to another address" },
  settingLocked: { status: 409, title: "A higher level locked the setting" },
  setupIncomplete: { status: 409, title: "The setup is not complete" },
  setupNotReady: { status: 409, title: "The setup step is not ready" },
  keysNotDownloaded: { status: 409, title: "Download the keys first" },
  keysAlreadyDownloaded: { status: 409, title: "The keys were already downloaded" },
  totpExists: { status: 409, title: "An authenticator app is already set up" },
  ownerMissing: { status: 409, title: "The owner account is missing" },
  totpMissing: { status: 409, title: "The authenticator app is not confirmed yet" },
  lastSecondFactor: { status: 409, title: "The last second factor cannot be removed" },
  noSecondFactor: { status: 409, title: "No second factor is set up" },
  secondFactorExists: { status: 409, title: "The second factor already exists" },
  instanceUrlMissing: { status: 409, title: "The instance URL is not set" },
  mailNotReady: { status: 409, title: "The sending method is not set up yet" },
  payloadTooLarge: { status: 413, title: "The request body is too large" },
  fileTooLarge: { status: 413, title: "The file is larger than allowed" },
  uploadTooLarge: { status: 413, title: "The file is larger than uploads allow" },
  unsupportedMediaType: { status: 415, title: "The request body has an unsupported type" },
  rangeNotSatisfiable: { status: 416, title: "The requested range is not available" },
  locked: { status: 429, title: "Too many failed attempts" },
  rateLimited: { status: 429, title: "Too many requests" },
  tooManyRequests: { status: 429, title: "Too many access requests today" },
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
      .describe("Invalid fields, for `invalidInput` and the codes about the address of a chat channel."),
    denials: z
      .array(z.string().describe("Reason code of the authorization service."))
      .optional()
      .describe("Why the request was not allowed, for `forbidden`."),
    retryAfterSeconds: z
      .number()
      .int()
      .optional()
      .describe("Seconds to wait before retrying, for `rateLimited` and `locked`."),
    problem: z
      .string()
      .optional()
      .describe(
        "Which password rule failed, for `passwordPolicy`; why the address of a chat channel was refused, for `invalidChatAddress`.",
      ),
    minLength: z.number().int().optional().describe("Minimum password length, for `passwordPolicy`."),
    lockedBy: z.string().optional().describe("Level that locked the setting, for `settingLocked`."),
    minimum: z.number().optional().describe("Lowest allowed value, for `settingBelowMinimum`."),
    maximum: z
      .union([z.number(), z.literal("unlimited")])
      .optional()
      .describe("Highest allowed value, for `settingAboveMaximum`."),
    maxLifetimeDays: z
      .number()
      .int()
      .optional()
      .describe("Maximum lifetime of API tokens in days, for `expiryRequired` and `expiryTooLate`."),
    domains: z
      .array(z.string().describe("A domain."))
      .optional()
      .describe("Domains that belong to another identity provider, for `domainInUse`."),
    instanceUrl: z.string().optional().describe("The current address of the instance, for `instanceMoved`."),
    maxBytes: z
      .number()
      .int()
      .optional()
      .describe("Largest allowed file size in bytes, for `fileTooLarge` and `uploadTooLarge`."),
    missing: z.number().int().optional().describe("Number of parts still missing, for `uploadIncomplete`."),
    uncoveredPages: z
      .number()
      .int()
      .optional()
      .describe("Number of pages below that your own role does not cover, for `shareBeyondOwnAccess`."),
    maxDays: z
      .number()
      .int()
      .optional()
      .describe("Longest allowed lifetime of a link for anyone in days, for `expiryTooLate`."),
    pages: z
      .number()
      .int()
      .optional()
      .describe(
        "Number of pages that give access to groups or through broad links, for `confidentialSharing`; number of pages that would lose the status, for `statusInUse`.",
      ),
    impact: moveImpactSchema
      .optional()
      .describe("Who gains and who loses access, with the confirmation to send, for `moveChangesAccess`."),
    formerParent: z
      .object({
        id: uuid("ID of the former parent page."),
        title: z.string().describe("Title of the former parent page."),
      })
      .nullable()
      .optional()
      .describe(
        "The former parent page in the trash, for `restrictedParentInTrash`; null when the caller may not view it.",
      ),
    parentEntries: z
      .number()
      .int()
      .optional()
      .describe(
        "Number of trash entries of former parent pages the caller can restore together with the content, for `restrictedParentInTrash`; 0 when the caller cannot restore all of them.",
      ),
    problems: z
      .array(
        z
          .object({
            path: z.string().describe("Position in the document, such as `content.2.content.0`."),
            code: z.string().describe("Kind of problem, such as `unknownNode` or `invalidAttribute`."),
            message: z.string().describe("Explanation for people."),
          })
          .describe("A problem in the document."),
      )
      .optional()
      .describe("What is wrong with the document, for `invalidDocument` and `invalidComment`."),
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

export function forbiddenProblem(denials: readonly string[]): ProblemException {
  if (denials.includes("exportDisabled")) {
    return new ProblemException(
      "exportDisabled",
      "Export is turned off for this space. A space administrator can turn it on in the space settings.",
      { denials },
    );
  }
  return new ProblemException("forbidden", "Not allowed", { denials });
}

export function notFound(detail = "Not found"): ProblemException {
  return new ProblemException("notFound", detail);
}
