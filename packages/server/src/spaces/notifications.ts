import { contentNotificationParamSchemas } from "@pagehall/shared";
import { defineNotificationType } from "../notifications/registry.js";

const ownershipOrphaned = defineNotificationType({
  type: "ownership.orphaned",
  targetType: "space",
  params: contentNotificationParamSchemas["ownership.orphaned"],
  subject: async (context) => ({ spaceId: context.params.spaceId, itemId: null }),
  async visible(context) {
    return context.can("space.manage", { type: "space", id: context.params.spaceId });
  },
});

const ownershipTransferred = defineNotificationType({
  type: "ownership.transferred",
  targetType: "item",
  params: contentNotificationParamSchemas["ownership.transferred"],
  async visible(context) {
    return context.targetId !== null && context.can("item.view", { type: "item", id: context.targetId });
  },
});

const statusChanged = defineNotificationType({
  type: "page.statusChanged",
  targetType: "item",
  params: contentNotificationParamSchemas["page.statusChanged"],
  async visible(context) {
    return context.targetId !== null && context.can("item.view", { type: "item", id: context.targetId });
  },
});

export const spaceNotificationTypes = [ownershipOrphaned, ownershipTransferred, statusChanged];
