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
