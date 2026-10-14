import { contentNotificationParamSchemas } from "@pagehall/shared";
import { defineNotificationType } from "../notifications/registry.js";

const ownershipOrphaned = defineNotificationType({
  type: "ownership.orphaned",
  targetType: "space",
  params: contentNotificationParamSchemas["ownership.orphaned"],
  async visible(context) {
    return context.can("space.manage", { type: "space", id: context.params.spaceId });
  },
});

export const spaceNotificationTypes = [ownershipOrphaned];
