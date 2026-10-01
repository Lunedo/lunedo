import { z } from "zod";
import { defineSetting } from "./definition.js";

export const supportedLanguages = ["en", "de"] as const;

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

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
