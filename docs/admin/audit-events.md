# Audit events

This page is generated from `packages/server/src/audit/catalog.ts`, `apps/web/src/i18n/locales/en.json` by `pnpm docs:generate`. Do not edit it by hand; change the code and run the command again.

Every event the [audit log](audit-log.md) records, grouped by the area at the start of its name. **What it records** is the name the audit log shows for the event. **Target** is the kind of object the event is about, **Actor** the kinds of actors that cause it. **Level** is the level the catalog assigns the event to, instance or organization. **Fields** are the details stored with the event besides who acted, the target, the time, the request and the client.

## access

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `access.overviewExported` | Permission overview exported | `organization` | `account` | organization | `accountId`, `people` |

## accessRequest

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `accessRequest.decided` | Access request decided | `accessRequest` | `account` | organization | `spaceId`, `itemId`, `title`, `requesterId`, `decision`, `role` |

## account

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `account.anonymized` | Account anonymized | `account` | `account` | organization | `reason`, `endedSessions`, `removedIdentities`, `endedMemberships` |
| `account.created` | Account created | `account` | `account`, `anonymous`, `system` | organization | `type`, `email`, `homeOrganizationId` |
| `account.createdAtSignIn` | Account created at the first sign-in | `account` | `system` | organization | `providerId`, `organizationId` |
| `account.deactivated` | Account deactivated | `account` | `account`, `system` | organization | `endedSessions` |
| `account.deactivatedByProvider` | Account deactivated by the provider | `account` | `system` | organization | `providerId`, `state` |
| `account.emailChanged` | E-mail address changed | `account` | `anonymous`, `account` | organization | `previousEmail`, `newEmail` |
| `account.emailChangeRequested` | E-mail change requested | `account` | `account` | organization | `newEmail` |
| `account.homeOrganizationChanged` | Home organization changed | `account` | `account`, `system` | organization | `previousOrganizationId`, `organizationId`, `reason` |
| `account.localCredentialsRemoved` | Local sign-in removed after the first provider sign-in | `account` | `account`, `system` | organization | `providerId`, `localSignIn`, `authenticatorApp`, `passkeys`, `recoveryLeft`, `endedSessions` |
| `account.managed` | Account managed by an identity provider | `account` | `account`, `system` | organization | `providerId`, `source` |
| `account.organizationAssigned` | Organization assigned | `account` | `account`, `system` | organization | `organizationId` |
| `account.passwordChanged` | Password changed | `account` | `account`, `system` | organization | `endedSessions` |
| `account.passwordReset` | Password reset | `account` | `anonymous` | organization | `endedSessions` |
| `account.passwordResetRequested` | Password reset requested | `account` | `anonymous` | organization | no further fields |
| `account.pictureChanged` | Profile picture changed | `account` | `account` | organization | `removed` |
| `account.placeholderCreated` | Placeholder created | `account` | `account`, `system` | instance | `email` |
| `account.placeholderMerged` | Placeholder merged | `account` | `account`, `system` | organization | `placeholderId`, `via`, `memberships`, `groups`, `roles` |
| `account.profileChanged` | Profile changed | `account` | `account` | organization | `name`, `previousName`, `jobTitle`, `previousJobTitle` |
| `account.reactivated` | Account reactivated | `account` | `account`, `system` | organization | no further fields |
| `account.reactivatedByProvider` | Account reactivated by the provider | `account` | `system` | organization | `providerId` |
| `account.secondFactorReset` | Second factor reset | `account` | `account`, `system` | organization | `reason`, `endedSessions`, `authenticatorApp`, `passkeys`, `recoveryLeft` |
| `account.sessionsEnded` | All sessions ended | `account` | `account`, `system` | organization | `endedSessions` |
| `account.unmanaged` | Account no longer managed by an identity provider | `account` | `account`, `system` | organization | `providerId` |

## announcement

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `announcement.changed` | Announcement banner set | `announcement` | `account` | organization | `level`, `replaced`, `severity`, `text`, `linkUrl`, `linkLabel`, `startsAt`, `endsAt` |
| `announcement.removed` | Announcement banner removed | `announcement` | `account` | organization | `level`, `severity`, `text` |

## apiToken

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `apiToken.created` | API token created | `apiToken` | `account`, `system` | organization | `accountId`, `name`, `organizationId`, `scopes`, `expiresAt`, `contentLevel`, `knowledgeBaseIds` |
| `apiToken.expired` | API token expired | `apiToken` | `system` | organization | `accountId` |
| `apiToken.levelChanged` | Write level of an API token changed | `apiToken` | `account`, `system` | organization | `accountId`, `name`, `contentLevel`, `previousContentLevel`, `knowledgeBaseIds`, `previousKnowledgeBaseIds` |
| `apiToken.rejected` | API token refused | `apiToken` | `anonymous` | organization | `reason` |
| `apiToken.revoked` | API token revoked | `apiToken` | `account`, `system` | organization | `accountId`, `reason` |
| `apiToken.updated` | API token changed | `apiToken` | `account`, `system` | organization | `name`, `previous` |

## article

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `article.feedbackDeleted` | Reader note on an article deleted | `page` | `account` | organization | `spaceId`, `title`, `day` |
| `article.reviewed` | Article marked as reviewed | `page` | `account` | organization | `spaceId`, `title`, `via` |
| `article.reviewUndone` | Review of an article undone | `page` | `account` | organization | `spaceId`, `title` |
| `article.sourceAdded` | Source page linked to an article | `page` | `account` | organization | `spaceId`, `title`, `sourceId` |
| `article.sourceRemoved` | Source page removed from an article | `page` | `account` | organization | `spaceId`, `title`, `sourceId` |

## attachment

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `attachment.versionKept` | File version marked to keep | `page` | `account` | organization | `spaceId`, `title`, `attachmentId`, `fileName`, `version` |
| `attachment.versionReleased` | File version no longer kept | `page` | `account` | organization | `spaceId`, `title`, `attachmentId`, `fileName`, `version` |

## audit

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `audit.exported` | Audit log exported | `audit` | `account` | organization | `scopeType`, `scopeId`, `from`, `to`, `actorId`, `targetType`, `targetId`, `name` |

## auth

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `auth.emergencySignIn` | Emergency sign-in | `account` | `account` | instance | `sessionId` |
| `auth.groupsClaimMissing` | Provider sent no groups | `identityProvider` | `system` | organization | no further fields |
| `auth.lockedOut` | Locked out | `account` | `anonymous` | organization | `subject`, `failures`, `lockedUntil` |
| `auth.providerSignedOut` | Signed out by the provider | `identityProvider` | `system` | organization | `endedSessions` |
| `auth.reauthenticated` | Identity confirmed | `account` | `account` | organization | `sessionId`, `method` |
| `auth.reauthenticationFailed` | Identity confirmation failed | `account` | `account` | organization | `sessionId`, `method` |
| `auth.sessionEnded` | Session ended | `account` | `account`, `system` | organization | `sessionId`, `reason` |
| `auth.signedIn` | Signed in | `account` | `account` | organization | `sessionId`, `methods`, `providerId` |
| `auth.signedOut` | Signed out | `account` | `account` | organization | `sessionId` |
| `auth.signInFailed` | Sign-in failed | `account` | `anonymous` | organization | `reason`, `method` |
| `auth.signInRefused` | Sign-in through a provider refused | `identityProvider` | `anonymous` | organization | `reason`, `reference` |

## backup

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `backup.created` | Backup created | `instance` | `account`, `system` | instance | `name`, `backupClass`, `trigger`, `location`, `sizeBytes` |
| `backup.deleted` | Backup deleted | `instance` | `account`, `system` | instance | `name`, `backupClass`, `reason` |
| `backup.failed` | Backup failed | `instance` | `account`, `system` | instance | `backupClass`, `trigger`, `reason` |
| `backup.keyConfirmed` | Backup key storage confirmed | `instance` | `account` | instance | `confirmed` |
| `backup.requested` | Backup started by hand | `instance` | `account` | instance | no further fields |
| `backup.settingsChanged` | Backup settings changed | `instance` | `account` | instance | `changes` |
| `backup.targetChanged` | Backup target changed | `instance` | `account` | instance | `kind`, `location`, `endpointHost`, `accessKeyId`, `credentialsReplaced` |
| `backup.targetConfirmed` | Backup target confirmed after a restore | `instance` | `account` | instance | `location` |
| `backup.testRestoreFinished` | Test restore finished | `instance` | `account`, `system` | instance | `name`, `trigger`, `state`, `stage` |
| `backup.testRestoreStarted` | Test restore started | `instance` | `account`, `system` | instance | `name`, `trigger` |

## blogPost

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `blogPost.heldCancelled` | Schedule of a held blog post cancelled | `page` | `account` | organization | `spaceId`, `title`, `scheduledBy` |
| `blogPost.heldPublished` | Held blog post published by a space admin | `page` | `account` | organization | `spaceId`, `title`, `version`, `scheduledBy` |
| `blogPost.pinned` | Blog post pinned | `page` | `account` | organization | `spaceId`, `title`, `level` |
| `blogPost.publishedBySchedule` | Blog post published by schedule | `page` | `system` | organization | `spaceId`, `title`, `version`, `scheduledBy` |
| `blogPost.scheduleHeld` | Scheduled blog post held for approval | `page` | `system` | organization | `spaceId`, `title`, `scheduledBy` |
| `blogPost.unpinned` | Blog post unpinned | `page` | `account` | organization | `spaceId`, `title`, `level` |

## breakGlass

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `breakGlass.actionAuthorized` | Action with break-glass access | `breakGlassAccess` | `account` | organization | `action`, `resourceType`, `resourceId` |
| `breakGlass.ended` | Break-glass access ended | `breakGlassAccess` | `account`, `system` | organization | `reason` |
| `breakGlass.started` | Break-glass access started | `breakGlassAccess` | `account` | organization | `accountId`, `reason`, `expiresAt` |

## chatChannel

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `chatChannel.changed` | Chat channel changed | `chatChannel` | `account` | organization | `spaceId`, `kind`, `name`, `events`, `addressChanged`, `signingKeyReplaced` |
| `chatChannel.connected` | Chat channel connected | `chatChannel` | `account` | organization | `spaceId`, `kind`, `name`, `events` |
| `chatChannel.removed` | Chat channel removed | `chatChannel` | `account` | organization | `spaceId`, `kind`, `name` |

## comment

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `comment.deletedByModerator` | Comment deleted by a space admin | `page` | `account` | organization | `spaceId`, `title`, `commentId`, `authorId` |

## group

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `group.created` | Group created | `group` | `account`, `system` | organization | `name` |
| `group.deleted` | Group deleted | `group` | `account`, `system` | organization | `name` |
| `group.managerAdded` | Group manager added | `group` | `account`, `system` | organization | `accountId` |
| `group.managerRemoved` | Group manager removed | `group` | `account`, `system` | organization | `accountId` |
| `group.memberAdded` | Group member added | `group` | `account`, `system` | organization | `accountId`, `expiresAt` |
| `group.memberRemoved` | Group member removed | `group` | `account`, `system` | organization | `accountId`, `reason` |
| `group.selfAdded` | Added themselves to the group | `group` | `account` | organization | `accountId`, `source`, `importId`, `expiresAt` |
| `group.updated` | Group changed | `group` | `account`, `system` | organization | `name`, `description`, `previous` |

## guest

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `guest.responsibleChanged` | Responsible person changed | `account` | `account`, `system` | organization | `responsibleAccountId` |

## identity

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `identity.linked` | Identity linked | `account` | `account`, `system` | organization | `providerId`, `via` |
| `identity.unlinked` | Identity unlinked | `account` | `account`, `system` | organization | `providerId`, `endedSessions` |

## identityProvider

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `identityProvider.activated` | Identity provider activated | `identityProvider` | `account`, `system` | instance | `name` |
| `identityProvider.caCertificateChanged` | CA certificate of the directory changed | `identityProvider` | `account`, `system` | instance | `action`, `fingerprint`, `subject`, `expiresAt`, `previousFingerprint` |
| `identityProvider.created` | Identity provider set up | `identityProvider` | `account`, `system` | instance | `name`, `type`, `preset` |
| `identityProvider.credentialAdded` | Provider credential added | `identityProvider` | `account`, `system` | instance | `credentialId`, `kind`, `expiresAt` |
| `identityProvider.credentialChosen` | Provider credential in use changed | `identityProvider` | `account`, `system` | instance | `credentialId`, `kind`, `automatic` |
| `identityProvider.credentialRemoved` | Provider credential removed | `identityProvider` | `account`, `system` | instance | `credentialId`, `kind` |
| `identityProvider.deactivated` | Identity provider deactivated | `identityProvider` | `account`, `system` | instance | `name`, `endedSessions` |
| `identityProvider.directoryKeyChanged` | Directory key changed | `identityProvider` | `account`, `system` | instance | `action`, `serviceAccount` |
| `identityProvider.logoChanged` | Provider logo changed | `identityProvider` | `account`, `system` | organization | `removed` |
| `identityProvider.metadataChanged` | SAML metadata changed | `identityProvider` | `account`, `system` | instance | `source`, `entityId`, `certificates`, `previousCertificates` |
| `identityProvider.metadataRefreshFailed` | SAML metadata could not be refreshed | `identityProvider` | `system` | instance | `url`, `error` |
| `identityProvider.removed` | Identity provider removed | `identityProvider` | `account`, `system` | instance | `name`, `endedSessions`, `releasedGroups` |
| `identityProvider.scimTokenCreated` | SCIM token created | `identityProvider` | `account`, `system` | instance | `credentialId`, `prefix` |
| `identityProvider.scimTokenRemoved` | SCIM token removed | `identityProvider` | `account`, `system` | instance | `credentialId`, `prefix` |
| `identityProvider.scimTokenRenewed` | SCIM token renewed | `identityProvider` | `account`, `system` | instance | `credentialId`, `prefix`, `previousCredentialId`, `previousExpiresAt` |
| `identityProvider.setupCompleted` | Identity provider setup finished | `identityProvider` | `account`, `system` | instance | `name` |
| `identityProvider.syncCancelled` | Synchronization cancelled | `identityProvider` | `account` | instance | `runId` |
| `identityProvider.syncConfirmed` | Held deactivations confirmed | `identityProvider` | `account` | instance | `runId`, `deactivations` |
| `identityProvider.synchronized` | Provider synchronized | `identityProvider` | `account`, `system` | instance | `runId`, `trigger`, `status`, `changes`, `warnings`, `durationMs` |
| `identityProvider.updated` | Identity provider changed | `identityProvider` | `account`, `system` | instance | `name`, `config`, `previous` |

## import

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `import.accepted` | Import accepted | `import` | `account` | organization | `spaceId`, `spaceKey`, `archived`, `grants` |
| `import.conflictsDecided` | Re-import decisions made | `import` | `account` | organization | `decision`, `conflicts`, `deletions`, `bulk` |
| `import.discarded` | Import discarded | `import` | `account` | organization | `spaceId` |
| `import.failed` | Import failed | `import` | `system` | organization | `phase`, `reason` |
| `import.groupMapped` | Group from an import mapped | `group` | `account` | organization | `importId`, `name`, `created` |
| `import.permissionDifferenceApplied` | Permission difference from a re-import applied | `import` | `account` | organization | `spaceId`, `scope`, `action`, `itemId`, `principalKind`, `principalId`, `role` |
| `import.permissionsApplied` | Imported permissions applied | `import` | `account` | organization | `spaceId`, `via`, `imported`, `applied`, `changed` |
| `import.placeholderCreated` | Placeholder created by an import | `account` | `system` | organization | `importId` |
| `import.placeholderMapped` | Placeholder of an import mapped to an account | `account` | `account`, `system` | organization | `importId`, `placeholderId`, `via`, `bulk`, `items`, `comments`, `mentions`, `tasks`, `reactions`, `restrictions`, `spaceRoles` |
| `import.reimportApplied` | Re-import applied | `import` | `account` | organization | `spaceId`, `created`, `updated`, `keptLunedo`, `tookSource`, `keptBoth`, `trashed`, `keptDeleted`, `moved`, `stayed`, `labels`, `waiting` |
| `import.reimportRefused` | Re-import refused for another space | `import` | `system` | organization | `spaceId`, `sourceSpaceKey` |
| `import.reimportStarted` | Re-import started | `import` | `account` | organization | `source`, `spaceId`, `file`, `replaced` |
| `import.reviewersChanged` | Import reviewers changed | `import` | `account` | organization | `added`, `removed` |
| `import.started` | Import started | `import` | `account` | organization | `source`, `spaceId`, `spaceKey`, `archived`, `reviewers`, `file` |
| `import.stopped` | Import stopped | `import` | `account` | organization | `spaceId`, `phase` |
| `import.takenOver` | Import taken over | `import` | `account` | organization | `previousImporterId` |
| `import.tokenDeleted` | Atlassian API token of an import deleted | `import` | `system`, `account` | organization | `reason` |
| `import.tokenUsed` | Atlassian API token of an import used | `import` | `system`, `account` | organization | `site`, `purpose` |

## instance

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `instance.addressChanged` | Instance address changed | `instance` | `account`, `system` | instance | `url`, `previousUrl`, `endedSessions` |
| `instance.ownershipTransferred` | Instance ownership transferred | `account` | `account`, `system` | instance | `previousOwnerId` |

## invitation

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `invitation.accepted` | Invitation accepted | `invitation` | `anonymous`, `account` | organization | `accountId`, `accountCreated` |
| `invitation.created` | Invitation sent | `invitation` | `account`, `system` | organization | `email`, `kind`, `expiresAt` |
| `invitation.revoked` | Invitation revoked | `invitation` | `account`, `system` | organization | no further fields |

## knowledgeBase

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `knowledgeBase.audienceChanged` | Readers of a knowledge base changed | `space` | `account`, `system` | organization | `name`, `audience`, `previousAudience`, `groupIds`, `previousGroupIds`, `widened`, `articles` |
| `knowledgeBase.categoryAccessChanged` | Access to a knowledge base category changed | `page` | `account` | organization | `spaceId`, `title`, `responsibleGroupIds`, `previousResponsibleGroupIds`, `visibleGroupIds`, `previousVisibleGroupIds`, `widened`, `articles` |
| `knowledgeBase.languagesChanged` | Languages of a knowledge base changed | `space` | `account`, `system` | organization | `name`, `defaultLanguage`, `previousDefaultLanguage`, `languages`, `previousLanguages` |
| `knowledgeBase.portalAddressChanged` | Portal address of a knowledge base changed | `space` | `account`, `system` | organization | `name`, `path`, `previousPath`, `domain`, `previousDomain` |
| `knowledgeBase.reviewSettingsChanged` | Review settings of a knowledge base changed | `space` | `account` | organization | `name`, `intervalMonths`, `previousIntervalMonths`, `leadDays`, `previousLeadDays`, `recipients`, `previousRecipients` |

## mail

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `mail.credentialAdded` | E-mail credential added | `instance` | `account`, `system` | instance | `credentialId`, `kind`, `expiresAt` |
| `mail.credentialRemoved` | E-mail credential removed | `instance` | `account`, `system` | instance | `credentialId`, `kind` |
| `mail.graphChanged` | Microsoft Graph e-mail settings changed | `instance` | `account`, `system` | instance | `tenantId`, `clientId`, `sender`, `senderName`, `saveToSentItems`, `previous` |
| `mail.methodChanged` | Sending method changed | `instance` | `account`, `system` | instance | `method`, `previousMethod` |
| `mail.smtpChanged` | Mail server changed | `instance` | `account`, `anonymous`, `system` | instance | `host`, `port`, `security`, `username`, `passwordChanged`, `from`, `oauth2Provider`, `oauth2ClientId`, `oauth2CredentialChanged` |
| `mail.testSent` | Test mail sent | `instance` | `account`, `anonymous` | instance | `recipient`, `delivered`, `method` |

## maintenance

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `maintenance.changed` | Maintenance mode changed | `instance` | `account`, `system` | instance | `message`, `blockSignIn` |
| `maintenance.ended` | Maintenance mode switched off | `instance` | `account`, `system` | instance | `minutes` |
| `maintenance.started` | Maintenance mode switched on | `instance` | `account`, `system` | instance | `message`, `blockSignIn` |

## mappingRule

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `mappingRule.created` | Mapping rule created | `mappingRule` | `account`, `system` | organization | `providerId`, `group`, `groupName`, `target`, `organizationId`, `role`, `synchronizedGroupId`, `homeOrganization` |
| `mappingRule.removed` | Mapping rule removed | `mappingRule` | `account`, `system` | organization | `providerId`, `group`, `groupName`, `target`, `organizationId`, `role`, `synchronizedGroupId`, `homeOrganization` |
| `mappingRule.updated` | Mapping rule changed | `mappingRule` | `account`, `system` | organization | `providerId`, `group`, `groupName`, `target`, `organizationId`, `role`, `synchronizedGroupId`, `homeOrganization`, `previous` |

## membership

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `membership.added` | Member added | `account` | `account`, `anonymous`, `system` | organization | `kind`, `expiresAt` |
| `membership.removed` | Member removed | `account` | `account`, `system` | organization | `kind`, `reason` |
| `membership.updated` | Membership changed | `account` | `account`, `system` | organization | `expiresAt`, `responsibleAccountId` |

## organization

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `organization.created` | Organization created | `organization` | `account`, `anonymous`, `system` | organization | `name`, `slug`, `language`, `timeZone` |
| `organization.domainAdded` | Domain added | `organization` | `account`, `system` | organization | `domain` |
| `organization.domainRemoved` | Domain removed | `organization` | `account`, `system` | organization | `domain` |
| `organization.portalDomainAllowed` | Portal domain allowed | `organization` | `account`, `system` | organization | `domain` |
| `organization.portalDomainRemoved` | Portal domain removed | `organization` | `account`, `system` | organization | `domain`, `spaceId` |
| `organization.updated` | Organization changed | `organization` | `account`, `system` | organization | `name`, `slug`, `logoRef`, `previous` |

## page

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `page.archived` | Page archived | `page` | `account` | organization | `spaceId`, `title`, `itemKind`, `descendants` |
| `page.copied` | Page copied | `page` | `account` | organization | `spaceId`, `title`, `itemKind`, `itemId`, `sourceSpaceId`, `descendants`, `copied`, `hidden`, `skipped`, `widerAccess` |
| `page.draftDiscarded` | Draft discarded | `page` | `account` | organization | `spaceId`, `title`, `discardedDraftId` |
| `page.guestInvited` | Guest invited to a page | `page` | `account` | organization | `spaceId`, `title`, `invitationId`, `role`, `includeDescendants` |
| `page.modeChanged` | Editing mode changed | `page` | `account` | organization | `spaceId`, `title`, `mode`, `previousMode` |
| `page.ownerTransferred` | Owner changed | `page` | `account`, `system` | organization | `spaceId`, `title`, `previousOwnerId`, `ownerId` |
| `page.published` | Page published | `page` | `account`, `system` | organization | `spaceId`, `title`, `version`, `note`, `credentialId` |
| `page.publishedWithToken` | Page published with an API token | `page` | `account` | organization | `spaceId`, `title`, `version`, `note`, `credentialId` |
| `page.restrictionHolderAdded` | Person or group added to a page restriction | `page` | `account`, `system` | organization | `spaceId`, `title`, `kind`, `principalKind`, `principalId`, `name` |
| `page.restrictionHolderRemoved` | Person or group removed from a page restriction | `page` | `account`, `system` | organization | `spaceId`, `title`, `kind`, `principalKind`, `principalId`, `name` |
| `page.restrictionRemoved` | Page restriction removed | `page` | `account`, `system` | organization | `spaceId`, `title`, `kind`, `byAdministrator` |
| `page.restrictionSet` | Page restricted | `page` | `account`, `system` | organization | `spaceId`, `title`, `kind` |
| `page.shareChanged` | Page access changed | `page` | `account`, `system` | organization | `spaceId`, `title`, `principalKind`, `principalId`, `name`, `role`, `includeDescendants`, `previousRole`, `previousIncludeDescendants` |
| `page.shared` | Page shared | `page` | `account`, `system` | organization | `spaceId`, `title`, `principalKind`, `principalId`, `name`, `role`, `includeDescendants` |
| `page.subtreeExported` | Page exported with its subpages | `page` | `account` | organization | `spaceId`, `title`, `exportId`, `format` |
| `page.unarchived` | Page brought back from the archive | `page` | `account` | organization | `spaceId`, `title`, `itemKind`, `parentId` |
| `page.unshared` | Page access removed | `page` | `account`, `system` | organization | `spaceId`, `title`, `principalKind`, `principalId`, `name`, `role`, `includeDescendants` |
| `page.updateRejected` | Page change rejected | `page` | `account` | organization | `spaceId`, `reason`, `problems`, `bytes` |
| `page.versionRestored` | Version restored | `page` | `account` | organization | `spaceId`, `title`, `version`, `mode`, `newVersion` |

## portalAccount

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `portalAccount.invited` | Portal account invited | `invitation` | `account` | organization | `email`, `spaceId`, `spaceName`, `membershipExpiresAt` |

## portalHandoff

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `portalHandoff.consented` | Signing in on a portal domain allowed | `account` | `account` | organization | `domain`, `spaceId`, `spaceName` |

## role

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `role.assigned` | Role given | `roleAssignment` | `account`, `anonymous`, `system` | organization | `role`, `customRoleId`, `principalKind`, `principalId`, `expiresAt` |
| `role.created` | Role created | `role` | `account`, `system` | organization | `name`, `areas` |
| `role.deleted` | Role deleted | `role` | `account`, `system` | organization | `name` |
| `role.unassigned` | Role removed | `roleAssignment` | `account`, `system` | organization | `role`, `principalKind`, `principalId`, `reason` |
| `role.updated` | Role changed | `role` | `account`, `system` | organization | `name`, `areas`, `previous` |

## scim

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `scim.groupChanged` | Group changed through SCIM | `identityProvider` | `system` | instance | `groupId`, `externalId`, `name`, `operation`, `membersAdded`, `membersRemoved` |
| `scim.userChanged` | Account changed through SCIM | `account` | `system` | organization | `providerId`, `operation`, `attributes` |

## serviceAccount

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `serviceAccount.created` | Service account created | `account` | `account`, `system` | organization | `name`, `responsibleAccountIds` |
| `serviceAccount.deactivated` | Service account deactivated | `account` | `account`, `system` | organization | `revokedCount` |
| `serviceAccount.responsiblesChanged` | Responsible people changed | `account` | `account`, `system` | organization | `responsibleAccountIds` |
| `serviceAccount.unattended` | Service account without responsible person | `account` | `system` | organization | `notifiedCount` |
| `serviceAccount.updated` | Service account changed | `account` | `account`, `system` | organization | `name`, `description`, `previous` |

## settings

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `settings.changed` | Setting changed | `setting` | `account`, `anonymous`, `system` | organization | `level`, `scopeId`, `action`, `value`, `previousValue`, `previousLocked` |

## setup

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `setup.completed` | Setup completed | `instance` | `account`, `system` | instance | `through` |
| `setup.keyBackupDownloaded` | Keys downloaded | `instance` | `account` | instance | `masterKeyVersions`, `backupKeyVersions` |
| `setup.sessionStarted` | Setup started | `instance` | `account`, `system` | instance | no further fields |
| `setup.stepCompleted` | Setup step completed | `setupStep` | `account`, `system` | instance | no further fields |

## shareLink

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `shareLink.changed` | Share link changed | `shareLink` | `account` | organization | `spaceId`, `itemId`, `title`, `scope`, `expiresAt`, `unlockRequired`, `changes` |
| `shareLink.created` | Share link created | `shareLink` | `account` | organization | `spaceId`, `itemId`, `title`, `scope`, `expiresAt`, `unlockRequired` |
| `shareLink.opened` | Share link opened | `shareLink` | `account`, `anonymous` | organization | `spaceId`, `itemId`, `title`, `scope`, `expiresAt`, `unlockRequired` |
| `shareLink.revoked` | Share link revoked | `shareLink` | `account`, `system` | organization | `spaceId`, `itemId`, `title`, `scope`, `expiresAt`, `unlockRequired` |

## space

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `space.administratorAppointed` | Space admin appointed | `space` | `account` | organization | `name`, `accountId` |
| `space.administratorTaken` | Administrator became space admin | `space` | `account` | organization | `name`, `key`, `reason` |
| `space.archived` | Space archived | `space` | `account` | organization | `name` |
| `space.cleanupDeleted` | Space without members deleted | `space` | `account` | organization | `key`, `kind`, `reason` |
| `space.confidentialAdministratorAppointed` | Space admin of a confidential space appointed | `space` | `account` | organization | `key`, `accountId` |
| `space.confidentialDeleted` | Confidential space deleted | `space` | `account` | organization | `key`, `reason` |
| `space.created` | Space created | `space` | `account`, `system` | organization | `name`, `key`, `visibility`, `personal`, `ownerId`, `confidential`, `type`, `audience` |
| `space.deleted` | Space deleted | `space` | `account` | organization | `name`, `key`, `personal` |
| `space.exported` | Space exported | `space` | `account` | organization | `name`, `key`, `exportId`, `format` |
| `space.memberAddedByAdministration` | Person added to a space by the administration | `space` | `account` | organization | `name`, `key`, `accountId`, `role` |
| `space.memberRemovedByAdministration` | Person removed from a space by the administration | `space` | `account` | organization | `name`, `key`, `accountId`, `role` |
| `space.pageStatusValuesChanged` | Page status values changed | `space` | `account` | organization | `operation`, `valueId`, `name`, `pages` |
| `space.permissionChanged` | Space permission changed | `space` | `account`, `system` | organization | `name`, `principalKind`, `principalId`, `role`, `previousRole` |
| `space.permissionGranted` | Space permission granted | `space` | `account`, `system` | organization | `name`, `principalKind`, `principalId`, `role` |
| `space.permissionRemoved` | Space permission removed | `space` | `account`, `system` | organization | `name`, `principalKind`, `principalId`, `role` |
| `space.personalAdministratorAppointed` | Space admin of a personal space appointed | `space` | `account` | organization | `key`, `accountId` |
| `space.personalTransferred` | Personal space transferred | `space` | `account` | instance | `previousOwnerId`, `ownerId` |
| `space.privateGrantsRemoved` | Roles for everyone removed from a private space | `space` | `system` | organization | `name`, `grants` |
| `space.restored` | Space restored | `space` | `account` | organization | `name`, `key`, `personal` |
| `space.shortcutsChanged` | Space shortcuts changed | `space` | `account` | organization | `operation`, `shortcutId`, `name`, `url`, `itemId` |
| `space.unarchived` | Space brought back from the archive | `space` | `account` | organization | `name` |
| `space.updated` | Space settings changed | `space` | `account`, `system` | organization | `name`, `setting`, `value`, `previousValue` |

## storage

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `storage.contactsChanged` | Operations contacts changed | `instance` | `account` | instance | `addresses`, `teamsWebhook` |

## template

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `template.created` | Template created | `template` | `account` | organization | `name`, `level`, `organizationId` |
| `template.createdFromRestrictedPage` | Restricted page saved as a template | `page` | `account` | organization | `spaceId`, `title`, `templateId`, `templateName` |
| `template.deleted` | Template deleted | `template` | `account` | organization | `name`, `level`, `organizationId` |
| `template.exported` | Templates exported | `template` | `account` | organization | `level`, `organizationId`, `spaceId`, `templates`, `builtIn`, `removed` |
| `template.filesDropped` | Template images left out | `template` | `system`, `account` | organization | `name`, `level`, `organizationId`, `dropped` |
| `template.imported` | Templates imported | `template` | `account` | organization | `level`, `organizationId`, `spaceId`, `fileName`, `created`, `replaced` |
| `template.updated` | Template changed | `template` | `account` | organization | `name`, `level`, `organizationId`, `changes` |

## trash

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `trash.deletedImmediately` | Deleted permanently at once | `trashEntry` | `account` | organization | `spaceId`, `title`, `kind`, `itemKind`, `descendants`, `reason` |
| `trash.deletedPermanently` | Deleted permanently | `trashEntry` | `system` | organization | `spaceId`, `title`, `kind`, `itemKind`, `descendants` |
| `trash.emptied` | Trash emptied | `space` | `account` | organization | `name`, `entries` |
| `trash.itemsDeleted` | Moved to the trash | `trashEntry` | `account` | organization | `spaceId`, `title`, `kind`, `itemKind`, `descendants`, `itemId` |
| `trash.itemsRestored` | Restored from the trash | `trashEntry` | `account` | organization | `spaceId`, `title`, `kind`, `itemKind`, `descendants`, `stage`, `parentId` |
| `trash.movedToStageTwo` | Moved to second-stage recovery | `trashEntry` | `account`, `system` | organization | `spaceId`, `title`, `kind`, `itemKind`, `descendants`, `cause` |

## twoFactor

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `twoFactor.passkeyAdded` | Passkey added | `account` | `account` | organization | `credentialId`, `name` |
| `twoFactor.passkeyRemoved` | Passkey removed | `account` | `account` | organization | `credentialId`, `name` |
| `twoFactor.recoveryCodesGenerated` | Recovery codes created | `account` | `account`, `anonymous` | organization | `count` |
| `twoFactor.recoveryCodeUsed` | Recovery code used | `account` | `anonymous`, `account` | organization | `remaining` |
| `twoFactor.totpAdded` | Authenticator app added | `account` | `account`, `anonymous` | organization | no further fields |
| `twoFactor.totpRemoved` | Authenticator app removed | `account` | `account` | organization | no further fields |

## whiteboard

| Event | What it records | Target | Actor | Level | Fields |
|---|---|---|---|---|---|
| `whiteboard.updateRejected` | Whiteboard change rejected | `page` | `account` | organization | `spaceId`, `reason`, `problems`, `bytes` |
| `whiteboard.versionRestored` | Whiteboard version restored | `page` | `account` | organization | `spaceId`, `title`, `version`, `newVersion` |
