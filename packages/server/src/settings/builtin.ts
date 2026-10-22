import { isTimeZone, supportedLanguages } from "@lunedo/shared";
import { z } from "zod";
import { defineSetting } from "./definition.js";

export { supportedLanguages };

/** Interface language. */
export const languageSetting = defineSetting<(typeof supportedLanguages)[number]>({
  key: "locale.language",
  schema: z.enum(supportedLanguages),
  default: "en",
  levels: ["instance", "organization", "user"],
  lockable: true,
});

/** IANA time zone for displaying dates. */
export const timeZoneSetting = defineSetting({
  key: "locale.timeZone",
  schema: z.string().refine(isTimeZone, "must be an IANA time zone"),
  default: "UTC",
  levels: ["instance", "organization", "user"],
  lockable: true,
});

export const builtinSettings = [languageSetting, timeZoneSetting];
