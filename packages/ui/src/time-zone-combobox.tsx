import { useMemo } from "react";
import { Combobox, type ComboboxItem } from "./combobox.js";
import { useUiLabels } from "./labels.js";

export interface TimeZoneComboboxProps {
  value: string | null;
  onValueChange: (value: string | null) => void;
  locale?: string;
  browserTimeZone?: string;
  inheritedTimeZone?: string;
  now?: Date;
  disabled?: boolean;
  invalid?: boolean;
  muted?: boolean;
  "aria-label"?: string;
}

export function supportedTimeZones(): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

export function timeZoneOffset(timeZone: string, now: Date): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(now)
    .find((entry) => entry.type === "timeZoneName")?.value;
  const offset = (part ?? "GMT").replace(/^GMT/, "");
  return `UTC${offset === "" ? "+00:00" : offset}`;
}

function offsetKeywords(offset: string): string[] {
  const match = /^UTC([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) return [offset];
  const [, sign, hours, minutes] = match;
  const short = `${sign}${Number(hours)}${minutes === "00" ? "" : `:${minutes}`}`;
  return [offset, `UTC${short}`, `GMT${short}`, short, `${sign}${hours}:${minutes}`];
}

const RENAMED_ZONES: Record<string, readonly string[]> = {
  "Asia/Calcutta": ["Asia/Kolkata", "Kolkata"],
  "Asia/Kolkata": ["Asia/Calcutta", "Calcutta"],
  "Europe/Kiev": ["Europe/Kyiv", "Kyiv"],
  "Europe/Kyiv": ["Europe/Kiev", "Kiev"],
  "Asia/Saigon": ["Asia/Ho_Chi_Minh", "Ho Chi Minh"],
  "Asia/Ho_Chi_Minh": ["Asia/Saigon", "Saigon"],
  "Asia/Rangoon": ["Asia/Yangon", "Yangon"],
  "Asia/Yangon": ["Asia/Rangoon", "Rangoon"],
  "Asia/Katmandu": ["Asia/Kathmandu", "Kathmandu"],
  "Asia/Kathmandu": ["Asia/Katmandu", "Katmandu"],
};

function cityOf(timeZone: string): string {
  return (timeZone.split("/").at(-1) ?? timeZone).replaceAll("_", " ");
}

function regionOf(timeZone: string): string {
  const parts = timeZone.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/").replaceAll("_", " ") : "";
}

export function timeZoneItem(timeZone: string, now: Date, locale?: string): ComboboxItem {
  const offset = timeZoneOffset(timeZone, now);
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(now);
  const region = regionOf(timeZone);
  return {
    value: timeZone,
    label: cityOf(timeZone),
    description: [region, offset, time].filter(Boolean).join(" · "),
    keywords: [timeZone, region, ...(RENAMED_ZONES[timeZone] ?? []), ...offsetKeywords(offset)],
  };
}

export function timeZoneItems(options: {
  now: Date;
  locale?: string;
  browserTimeZone?: string;
  inheritedTimeZone?: string;
  suggestedLabel: string;
  allLabel: string;
  browserMarker: string;
  defaultMarker: string;
}): ComboboxItem[] {
  const zones = supportedTimeZones();
  const pinned = [options.inheritedTimeZone, options.browserTimeZone].filter(
    (zone, index, list): zone is string =>
      zone !== undefined && zones.includes(zone) && list.indexOf(zone) === index,
  );
  const suggested = pinned.map((zone) => {
    const markers = [
      zone === options.inheritedTimeZone ? options.defaultMarker : null,
      zone === options.browserTimeZone ? options.browserMarker : null,
    ].filter((marker): marker is string => marker !== null);
    return {
      ...timeZoneItem(zone, options.now, options.locale),
      group: options.suggestedLabel,
      marker: markers.join(" · "),
    };
  });
  const rest = zones
    .filter((zone) => !pinned.includes(zone))
    .map((zone) => ({ ...timeZoneItem(zone, options.now, options.locale), group: options.allLabel }));
  return [...suggested, ...rest];
}

export function TimeZoneCombobox({
  value,
  onValueChange,
  locale,
  browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  inheritedTimeZone,
  now,
  disabled,
  invalid,
  muted,
  ...props
}: TimeZoneComboboxProps) {
  const labels = useUiLabels();
  const minute = Math.floor((now ?? new Date()).getTime() / 60_000);
  const items = useMemo(
    () =>
      timeZoneItems({
        now: new Date(minute * 60_000),
        ...(locale ? { locale } : {}),
        ...(browserTimeZone ? { browserTimeZone } : {}),
        ...(inheritedTimeZone ? { inheritedTimeZone } : {}),
        suggestedLabel: labels.suggested,
        allLabel: labels.allTimeZones,
        browserMarker: labels.browserTimeZone,
        defaultMarker: labels.defaultMarker,
      }),
    [minute, locale, browserTimeZone, inheritedTimeZone, labels],
  );
  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={onValueChange}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(invalid !== undefined ? { invalid } : {})}
      {...(muted !== undefined ? { muted } : {})}
      {...(props["aria-label"] ? { "aria-label": props["aria-label"] } : {})}
    />
  );
}
