import { contentNotificationParamSchemas } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import { defineNotificationType } from "../notifications/registry.js";

const pageShared = defineNotificationType({
  type: "page.shared",
  targetType: "item",
  params: contentNotificationParamSchemas["page.shared"],
  async visible(context) {
    return context.targetId !== null && context.can("item.view", { type: "item", id: context.targetId });
  },
});

const accessRequested = defineNotificationType({
  type: "access.requested",
  targetType: "accessRequest",
  params: contentNotificationParamSchemas["access.requested"],
  async visible(context) {
    if (!context.targetId) return false;
    const request = await context.executor.execute<{ space_id: string; item_id: string | null }>(sql`
      select space_id, item_id from access_requests where id = ${context.targetId}`);
    const row = request.rows[0];
    if (!row) return false;
    if (await context.can("space.manage", { type: "space", id: row.space_id })) return true;
    return row.item_id !== null && context.can("item.share", { type: "item", id: row.item_id });
  },
});

const accessRequestDecided = defineNotificationType({
  type: "access.requestDecided",
  targetType: "accessRequest",
  params: contentNotificationParamSchemas["access.requestDecided"],
  async visible(context) {
    if (!context.targetId) return false;
    const request = await context.executor.execute<{ requester_id: string }>(
      sql`select requester_id from access_requests where id = ${context.targetId}`,
    );
    return request.rows[0]?.requester_id === context.recipientId;
  },
});

const restrictionOrphaned = defineNotificationType({
  type: "restriction.orphaned",
  targetType: "item",
  params: contentNotificationParamSchemas["restriction.orphaned"],
  async visible(context) {
    return context.can("space.manage", { type: "space", id: context.params.spaceId });
  },
});

export const sharingNotificationTypes = [
  pageShared,
  accessRequested,
  accessRequestDecided,
  restrictionOrphaned,
];
