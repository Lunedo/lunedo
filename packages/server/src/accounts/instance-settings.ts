import { z } from "zod";
import { defineSetting } from "../settings/definition.js";

/** An origin such as `https://wiki.example.org`, without path, query or trailing slash. */
export const instanceUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
    } catch {
      return false;
    }
  }, "must be an http or https origin without a path, for example https://wiki.example.org");

export const instanceUrlSetting = defineSetting({
  key: "instance.url",
  schema: z.union([z.literal(""), instanceUrlSchema]),
  default: "",
  levels: ["instance"],
  lockable: false,
});

export const instanceNameSchema = z.string().trim().min(1).max(100);

export const instanceNameSetting = defineSetting({
  key: "instance.name",
  schema: instanceNameSchema,
  default: "Pagehall",
  levels: ["instance"],
  lockable: false,
});

export const instanceSettings = [instanceUrlSetting, instanceNameSetting];
