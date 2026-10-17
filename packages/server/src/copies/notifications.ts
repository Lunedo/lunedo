import { contentNotificationParamSchemas } from "@pagehall/shared";
import { defineNotificationType } from "../notifications/registry.js";

const copyFinished = defineNotificationType({
  type: "copy.finished",
  targetType: "item",
  params: contentNotificationParamSchemas["copy.finished"],
  async visible(context) {
    return context.targetId !== null && context.can("item.view", { type: "item", id: context.targetId });
  },
});

const copyFailed = defineNotificationType({
  type: "copy.failed",
  targetType: "copy",
  params: contentNotificationParamSchemas["copy.failed"],
  async visible(context) {
    return context.targetId !== null && context.can("copy.view", { type: "copy", id: context.targetId });
  },
});

export const copyNotificationTypes = [copyFinished, copyFailed];
