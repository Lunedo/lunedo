import { notificationParamSchemas } from "@pagehall/shared";
import { defineNotificationType } from "../notifications/registry.js";
import { formatBytes, formatPercent } from "./format.js";

const visible = (context: { can(action: string, resource: { type: string }): Promise<boolean> }) =>
  context.can("instance.settings.view", { type: "instance" });

const levelReached = defineNotificationType({
  type: "storage.levelReached",
  targetType: "instance",
  params: notificationParamSchemas["storage.levelReached"],
  visible,
  mail: (params) => ({
    template: "storageLevelReached",
    params: {
      level: params.level as 1 | 2 | 3,
      percent: formatPercent(params.percent),
      used: formatBytes(params.usedBytes),
      total: formatBytes(params.totalBytes),
      store: params.store,
      reminder: params.reminder,
      link: null,
    },
  }),
});

const levelCleared = defineNotificationType({
  type: "storage.levelCleared",
  targetType: "instance",
  params: notificationParamSchemas["storage.levelCleared"],
  visible,
  mail: (params) => ({
    template: "storageLevelCleared",
    params: {
      level: params.level as 0 | 1 | 2,
      percent: formatPercent(params.percent),
      store: params.store,
      link: null,
    },
  }),
});

export const storageNotificationTypes = [levelReached, levelCleared];
