import { instanceSettings } from "../accounts/instance-settings.js";
import { auditRetentionSetting } from "../audit/retention.js";
import { authSettings } from "../auth/settings.js";
import { collaborationSettings } from "../collaboration/settings.js";
import { embedSettings } from "../embeds/settings.js";
import { fileSettings } from "../files/settings.js";
import { syncLogRetentionDaysSetting } from "../identity/sync.js";
import { importSettings } from "../imports/settings.js";
import {
  graphMailSetting,
  mailMethodSetting,
  mailSendRateSetting,
  smtpSetting,
} from "../mail/mail-service.js";
import { notificationSettings } from "../notifications/types.js";
import { operationsSettings } from "../operations/settings.js";
import { organizationSettings } from "../organizations/settings.js";
import { portalSettings } from "../portal/settings.js";
import { searchSettings } from "../search/languages.js";
import { sharingSettings } from "../sharing/settings.js";
import { spaceSettings } from "../spaces/settings.js";
import { storageSettings } from "../storage/settings.js";
import { tokenSettings } from "../tokens/settings.js";
import { builtinSettings } from "./builtin.js";
import type { SettingDefinition } from "./definition.js";
import { preferenceSettings } from "./preferences.js";

export const settingDefinitions = [
  ...builtinSettings,
  ...instanceSettings,
  ...authSettings,
  ...organizationSettings,
  ...tokenSettings,
  ...preferenceSettings,
  ...notificationSettings,
  ...spaceSettings,
  ...portalSettings,
  ...collaborationSettings,
  ...sharingSettings,
  ...fileSettings,
  ...storageSettings,
  ...operationsSettings,
  ...importSettings,
  ...embedSettings,
  ...searchSettings,
  auditRetentionSetting,
  smtpSetting,
  mailMethodSetting,
  graphMailSetting,
  mailSendRateSetting,
  syncLogRetentionDaysSetting,
] as SettingDefinition<never>[];
