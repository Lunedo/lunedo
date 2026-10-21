import { formatDate, notificationParamSchemas } from "@pagehall/shared";
import { defineNotificationType } from "../notifications/registry.js";

const visible = (context: { can(action: string, resource: { type: string }): Promise<boolean> }) =>
  context.can("instance.operations.manage", { type: "instance" });

const failed = defineNotificationType({
  type: "backup.failed",
  targetType: "instance",
  params: notificationParamSchemas["backup.failed"],
  visible,
  mail: (params) => ({
    template: "backupFailed",
    params: { reason: params.reason, reminder: params.reminder, link: params.link },
  }),
});

const missing = defineNotificationType({
  type: "backup.missing",
  targetType: "instance",
  params: notificationParamSchemas["backup.missing"],
  visible,
  mail: (params, locale) => ({
    template: "backupMissing",
    params: {
      days: params.days,
      lastSuccess: params.lastSuccessAt
        ? formatDate(new Date(params.lastSuccessAt), locale.dateFormat, locale.timeZone, locale.language)
        : null,
      reminder: params.reminder,
      link: params.link,
    },
  }),
});

const recovered = defineNotificationType({
  type: "backup.recovered",
  targetType: "instance",
  params: notificationParamSchemas["backup.recovered"],
  visible,
  mail: (params) => ({ template: "backupRecovered", params: { link: params.link } }),
});

const testRestoreFailed = defineNotificationType({
  type: "backup.testRestoreFailed",
  targetType: "instance",
  params: notificationParamSchemas["backup.testRestoreFailed"],
  visible,
  mail: (params) => ({
    template: "backupTestRestoreFailed",
    params: { backupName: params.backupName, reason: params.reason, link: params.link },
  }),
});

export const backupNotificationTypes = [failed, missing, recovered, testRestoreFailed];
