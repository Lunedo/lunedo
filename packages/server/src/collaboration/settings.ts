import { z } from "zod";
import { defineSetting } from "../settings/definition.js";

export const RECENT_VIEW_DAYS = 90;

export const reactionsEnabledSetting = defineSetting({
  key: "reactions.enabled",
  schema: z.boolean(),
  default: true,
  levels: ["organization", "space"],
  lockable: true,
});

export const organizationHomePageSetting = defineSetting<string | null>({
  key: "home.organizationPage",
  schema: z.uuid().nullable(),
  default: null,
  levels: ["organization"],
  lockable: false,
});

export const startPages = ["forYou", "organizationHome"] as const;
export type StartPage = (typeof startPages)[number];

export const startPageSetting = defineSetting<StartPage>({
  key: "appearance.startPage",
  schema: z.enum(startPages),
  default: "forYou",
  levels: ["user"],
  lockable: false,
});

export const collaborationSettings = [reactionsEnabledSetting, organizationHomePageSetting, startPageSetting];
