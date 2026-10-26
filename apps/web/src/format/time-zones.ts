import { shortTimeZoneOffset } from "@lunedo/ui";
import type { TFunction } from "i18next";
import { translateKey } from "../i18n/translate.js";

let cached: string[] | null = null;

export function timeZones(): string[] {
  if (cached) return cached;
  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : ["Europe/Vienna", "Europe/Berlin"];
  cached = ["UTC", ...supported.filter((zone) => zone !== "UTC")];
  return cached;
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function timeZoneOptions() {
  return timeZones().map((zone) => ({
    value: zone,
    label: zone.replaceAll("_", " "),
    group: zone.split("/")[0],
  }));
}

export function timeZoneName(t: TFunction, timeZone: string, now = new Date()): string {
  if (timeZone === "UTC") return "UTC";
  const name = timeZone
    .split("/")
    .map((part) => translateKey(t, `timeZones.names.${part}`, { defaultValue: part.replaceAll("_", " ") }))
    .join("/");
  return `${name} (${shortTimeZoneOffset(timeZone, now)})`;
}
