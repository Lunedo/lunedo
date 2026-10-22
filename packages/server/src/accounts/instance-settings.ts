import { instanceNameSchema, instanceUrlSchema } from "@lunedo/shared";
import { z } from "zod";
import { defineSetting } from "../settings/definition.js";

export { instanceNameSchema, instanceUrlSchema };

export const instanceUrlSetting = defineSetting({
  key: "instance.url",
  schema: z.union([z.literal(""), instanceUrlSchema]),
  default: "",
  levels: ["instance"],
  lockable: false,
});

export const instanceNameSetting = defineSetting({
  key: "instance.name",
  schema: instanceNameSchema,
  default: "Lunedo",
  levels: ["instance"],
  lockable: false,
});

export const instanceSettings = [instanceUrlSetting, instanceNameSetting];
