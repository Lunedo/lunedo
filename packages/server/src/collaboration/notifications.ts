import { contentNotificationParamSchemas } from "@pagehall/shared";
import { defineNotificationType } from "../notifications/registry.js";

const contentMentioned = defineNotificationType({
  type: "content.mentioned",
  targetType: "item",
  params: contentNotificationParamSchemas["content.mentioned"],
  async visible(context) {
    if (!context.targetId || !(await context.can("item.view", { type: "item", id: context.targetId }))) {
      return false;
    }
    const commentId = context.params.commentId;
    return commentId === null || context.can("comment.view", { type: "comment", id: commentId });
  },
});

const taskAssigned = defineNotificationType({
  type: "task.assigned",
  targetType: "item",
  params: contentNotificationParamSchemas["task.assigned"],
  async visible(context) {
    return context.targetId !== null && context.can("item.view", { type: "item", id: context.targetId });
  },
});

export const collaborationNotificationTypes = [contentMentioned, taskAssigned];
