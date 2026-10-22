import { chatChannelKinds, chatChannelStates, chatDeliveryStates } from "@lunedo/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { encrypted } from "../crypto/encrypted-column.js";
import { primaryId, timestamps } from "../database/columns.js";
import { organizations } from "../organizations/schema.js";
import { spaces } from "../spaces/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const chatChannelKind = pgEnum("chat_channel_kind", chatChannelKinds);
export const chatChannelState = pgEnum("chat_channel_state", chatChannelStates);
export const chatDeliveryState = pgEnum("chat_delivery_state", chatDeliveryStates);

export const chatChannels = pgTable(
  "chat_channels",
  {
    id: primaryId(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    spaceId: uuid().references(() => spaces.id, { onDelete: "cascade" }),
    kind: chatChannelKind().notNull(),
    name: text().notNull(),
    events: text().array().notNull(),
    target: encrypted().notNull(),
    signingSecret: encrypted(),
    state: chatChannelState().notNull().default("working"),
    failureReason: text(),
    failureStatus: integer(),
    failureCode: text(),
    failedAt: timestampColumn(),
    failureAnnounced: boolean().notNull().default(false),
    lastAttemptAt: timestampColumn(),
    lastDeliveredAt: timestampColumn(),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    index().on(table.organizationId),
    index().on(table.spaceId),
    index().on(table.createdBy),
    check("chat_channels_name_length", sql`length(${table.name}) between 1 and 80`),
  ],
);

export const chatDeliveries = pgTable(
  "chat_deliveries",
  {
    id: primaryId(),
    channelId: uuid().references(() => chatChannels.id, { onDelete: "cascade" }),
    event: text().notNull(),
    subjectId: uuid(),
    data: jsonb().notNull().default({}),
    combineKey: text(),
    count: integer().notNull().default(1),
    state: chatDeliveryState().notNull().default("pending"),
    notBefore: timestampColumn().notNull().defaultNow(),
    queuedAt: timestampColumn(),
    attempts: integer().notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    index().on(table.channelId),
    index().on(table.state, table.queuedAt),
    index().on(table.updatedAt),
    uniqueIndex("chat_deliveries_pending_combine_index")
      .on(table.channelId, table.combineKey)
      .where(sql`${table.state} = 'pending' and ${table.combineKey} is not null`),
  ],
);
