import { z } from "zod";
import { defineSetting } from "../settings/definition.js";

export const portalAppLinkNameSetting = defineSetting({
  key: "portal.appLinkName",
  schema: z.string().trim().max(60),
  default: "",
  levels: ["instance"],
  lockable: false,
});

export const helpKnowledgeBaseSetting = defineSetting({
  key: "help.knowledgeBase",
  schema: z.union([z.literal(""), z.uuid()]),
  default: "",
  levels: ["organization"],
  lockable: false,
});

export const portalSettings = [portalAppLinkNameSetting, helpKnowledgeBaseSetting];
