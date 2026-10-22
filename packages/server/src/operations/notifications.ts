import { notificationParamSchemas } from "@pagehall/shared";
import { defineNotificationType } from "../notifications/registry.js";

const updateAvailable = defineNotificationType({
  type: "operations.updateAvailable",
  targetType: "instance",
  params: notificationParamSchemas["operations.updateAvailable"],
  visible: (context) => context.can("instance.operations.view", { type: "instance" }),
  mail: (params) => ({
    template: "updateAvailable",
    params: {
      version: params.version,
      current: params.current,
      breaking: params.breaking,
      link: params.link,
    },
  }),
});

export const operationsNotificationTypes = [updateAvailable];
