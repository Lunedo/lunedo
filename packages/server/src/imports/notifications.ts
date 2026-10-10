import { contentNotificationParamSchemas } from "@pagehall/shared";
import { defineNotificationType } from "../notifications/registry.js";

const importFinished = defineNotificationType({
  type: "import.finished",
  targetType: "import",
  params: contentNotificationParamSchemas["import.finished"],
  async visible(context) {
    return context.targetId !== null && context.can("import.view", { type: "import", id: context.targetId });
  },
});

const importFailed = defineNotificationType({
  type: "import.failed",
  targetType: "import",
  params: contentNotificationParamSchemas["import.failed"],
  async visible(context) {
    return context.targetId !== null && context.can("import.view", { type: "import", id: context.targetId });
  },
});

const importHeld = defineNotificationType({
  type: "import.held",
  targetType: "import",
  params: contentNotificationParamSchemas["import.held"],
  async visible(context) {
    return (
      context.targetId !== null && context.can("import.takeOver", { type: "import", id: context.targetId })
    );
  },
});

export const importNotificationTypes = [importFinished, importFailed, importHeld];
