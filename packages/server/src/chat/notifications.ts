import { contentNotificationParamSchemas } from "@pagehall/shared";
import { defineNotificationType } from "../notifications/registry.js";

const chatChannelFailing = defineNotificationType({
  type: "chatChannel.failing",
  targetType: "chatChannel",
  params: contentNotificationParamSchemas["chatChannel.failing"],
  visible: async (context) =>
    context.params.spaceId
      ? context.can("space.manage", { type: "space", id: context.params.spaceId })
      : context.can("organization.integrations.manage", {
          type: "organization",
          id: context.params.organizationId,
        }),
});

export const chatNotificationTypes = [chatChannelFailing];
