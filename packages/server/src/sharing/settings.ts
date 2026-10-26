import { z } from "zod";
import { defineSetting } from "../settings/definition.js";

export const shareLinksSetting = defineSetting({
  key: "sharing.shareLinks",
  schema: z.boolean(),
  default: true,
  levels: ["organization"],
  lockable: true,
});

export const anyoneLinksSetting = defineSetting({
  key: "sharing.anyoneLinks",
  schema: z.boolean(),
  default: false,
  levels: ["instance", "organization"],
  lockable: true,
});

export const anyoneLinkMaxDaysSetting = defineSetting({
  key: "sharing.anyoneLinkMaxDays",
  schema: z.number().int().min(1).max(3650),
  default: 30,
  levels: ["instance", "organization"],
  lockable: true,
  stricterOnly: "lower",
});

export const membersInviteGuestsSetting = defineSetting({
  key: "sharing.membersInviteGuests",
  schema: z.boolean(),
  default: false,
  levels: ["organization"],
  lockable: true,
});

export const sharingSettings = [
  shareLinksSetting,
  anyoneLinksSetting,
  anyoneLinkMaxDaysSetting,
  membersInviteGuestsSetting,
];
