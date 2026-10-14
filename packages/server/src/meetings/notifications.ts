import { contentNotificationParamSchemas } from "@pagehall/shared";
import { defineNotificationType } from "../notifications/registry.js";

const notesAvailable = defineNotificationType({
  type: "meeting.notesAvailable",
  targetType: "item",
  params: contentNotificationParamSchemas["meeting.notesAvailable"],
  async visible(context) {
    return context.targetId !== null && context.can("item.view", { type: "item", id: context.targetId });
  },
});

const meetingReminder = defineNotificationType({
  type: "meeting.reminder",
  targetType: "item",
  params: contentNotificationParamSchemas["meeting.reminder"],
  async visible(context) {
    return context.targetId !== null && context.can("item.view", { type: "item", id: context.targetId });
  },
});

const oneOnOneStarted = defineNotificationType({
  type: "oneOnOne.started",
  targetType: "item",
  params: contentNotificationParamSchemas["oneOnOne.started"],
  async visible(context) {
    return context.targetId !== null && context.can("item.view", { type: "item", id: context.targetId });
  },
});

const confidentialWithoutAdministrator = defineNotificationType({
  type: "space.confidentialWithoutAdministrator",
  targetType: "space",
  params: contentNotificationParamSchemas["space.confidentialWithoutAdministrator"],
  async visible(context) {
    return (
      context.organizationId !== null &&
      context.can("organization.spaces.manage", { type: "organization", id: context.organizationId })
    );
  },
});

export const meetingNotificationTypes = [
  notesAvailable,
  meetingReminder,
  oneOnOneStarted,
  confidentialWithoutAdministrator,
];
