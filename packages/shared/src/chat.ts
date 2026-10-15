export const chatChannelKinds = ["teams", "slack", "matrix", "discord", "webhook"] as const;
export type ChatChannelKind = (typeof chatChannelKinds)[number];

export const chatChannelStates = ["working", "failing"] as const;
export type ChatChannelState = (typeof chatChannelStates)[number];

export const chatDeliveryStates = ["pending", "delivered", "failed", "skipped"] as const;
export type ChatDeliveryState = (typeof chatDeliveryStates)[number];

export const spaceChatEvents = [
  "pagePublished",
  "pageChanged",
  "blogPostPublished",
  "decisionRecorded",
  "pageStatusChanged",
  "commentCreated",
] as const;
export type SpaceChatEvent = (typeof spaceChatEvents)[number];

export const organizationChatEvents = ["announcementPublished"] as const;
export type OrganizationChatEvent = (typeof organizationChatEvents)[number];

export type ChatEvent = SpaceChatEvent | OrganizationChatEvent;

export const chatFailureReasons = [
  "addressGone",
  "unauthorized",
  "rejected",
  "unavailable",
  "unreachable",
  "blockedAddress",
  "insecureAddress",
] as const;
export type ChatFailureReason = (typeof chatFailureReasons)[number];
