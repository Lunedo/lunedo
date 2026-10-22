import {
  defaultEmbedServices,
  EMBED_ID_PATTERN,
  type EmbedService,
  embedServicesValue,
} from "@lunedo/editor-schema";
import { z } from "zod";
import { defineSetting } from "../settings/definition.js";

export const embedServicesSetting = defineSetting<EmbedService[]>({
  key: "embeds.services",
  schema: embedServicesValue as z.ZodType<EmbedService[]>,
  default: defaultEmbedServices.map((service) => ({ ...service, rules: [...service.rules] })),
  levels: ["instance"],
  lockable: false,
});

export const allowedEmbedServicesSetting = defineSetting<string[] | null>({
  key: "embeds.allowedServices",
  schema: z
    .array(z.string().regex(EMBED_ID_PATTERN))
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, "Each service may appear only once")
    .nullable(),
  default: null,
  levels: ["organization"],
  lockable: false,
});

export const embedSettings = [embedServicesSetting, allowedEmbedServicesSetting];
