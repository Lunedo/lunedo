import { contentNotificationParamSchemas } from "@pagehall/shared";
import { defineNotificationType } from "../notifications/registry.js";

const reviewDue = defineNotificationType({
  type: "article.reviewDue",
  targetType: "item",
  params: contentNotificationParamSchemas["article.reviewDue"],
  async visible(context) {
    return context.targetId !== null && context.can("item.view", { type: "item", id: context.targetId });
  },
});

const sourceChanged = defineNotificationType({
  type: "article.sourceChanged",
  targetType: "item",
  params: contentNotificationParamSchemas["article.sourceChanged"],
  async visible(context) {
    return context.targetId !== null && context.can("item.view", { type: "item", id: context.targetId });
  },
});

export const knowledgeBaseNotificationTypes = [reviewDue, sourceChanged];
