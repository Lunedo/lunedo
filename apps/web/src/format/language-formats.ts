import { proposeFormats } from "@pagehall/shared";

export interface FormatEntry {
  key: string;
  value?: unknown;
  source: string;
}

export function withLanguageNumberFormat<T extends FormatEntry>(list: readonly T[]): T[] {
  const language = list.find((entry) => entry.key === "locale.language");
  const timeZone = list.find((entry) => entry.key === "locale.timeZone")?.value;
  return list.map((entry) => {
    if (
      entry.key !== "locale.numberFormat" ||
      entry.source === "user" ||
      typeof language?.value !== "string"
    ) {
      return entry;
    }
    if (entry.source !== "default" && language.source !== "user") return entry;
    const proposed = proposeFormats(
      language.value,
      typeof timeZone === "string" ? timeZone : "",
    ).numberFormat;
    return proposed === entry.value ? entry : { ...entry, value: proposed, source: "default" };
  });
}
