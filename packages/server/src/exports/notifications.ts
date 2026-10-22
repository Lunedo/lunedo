import { contentNotificationParamSchemas } from "@lunedo/shared";
import { defineNotificationType } from "../notifications/registry.js";

const exportReady = defineNotificationType({
  type: "export.ready",
  targetType: "export",
  params: contentNotificationParamSchemas["export.ready"],
  async visible(context) {
    return (
      context.targetId !== null && context.can("export.download", { type: "export", id: context.targetId })
    );
  },
});

const exportFailed = defineNotificationType({
  type: "export.failed",
  targetType: "export",
  params: contentNotificationParamSchemas["export.failed"],
  async visible(context) {
    return context.targetId !== null && context.can("export.view", { type: "export", id: context.targetId });
  },
});

export const exportNotificationTypes = [exportReady, exportFailed];
