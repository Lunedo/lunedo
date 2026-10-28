import { slug } from "./docs-check.ts";
import { code, defineReference, table } from "./docs-reference.ts";
import { allowedValues, type JsonSchema } from "./docs-schema.ts";

export interface SettingEntry {
  readonly key: string;
  readonly levels: readonly string[];
  readonly lockable: boolean;
  readonly default: unknown;
  readonly schema: JsonSchema;
  readonly format: string | null;
}

export interface IndexEntry {
  readonly id: string;
  readonly labelKey: string;
  readonly descriptionKey?: string;
}

export interface IndexSection {
  readonly titleKey: string;
  readonly entries: readonly IndexEntry[];
}

export interface SettingsSource {
  readonly settings: readonly SettingEntry[];
  readonly index: Readonly<Record<string, readonly IndexSection[]>>;
  readonly messages: unknown;
  readonly pages: readonly SettingsPageEntry[];
}

export interface SettingsPageEntry {
  readonly id: string;
  readonly section: string;
  readonly order: number;
  readonly labelKey: string;
  readonly groupKey?: string;
}

const SETTINGS = "packages/server/src/settings/catalog.ts";
const INDEX = "apps/web/src/settings/settings-index.ts";
const PAGES = "apps/web/src/shell/settings-pages.ts";
const MESSAGES = "apps/web/src/i18n/locales/en.json";
const AREA_KEYS: Readonly<Record<string, string>> = {
  account: "navigation.myAccount",
  organization: "navigation.organization",
  instance: "navigation.instance",
};

export function message(messages: unknown, key: string): string | undefined {
  let value: unknown = messages;
  for (const part of key.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === "string" ? value : undefined;
}

export function settingLabelKey(key: string): string {
  return `settings.keys.${key.replaceAll(".", "_")}.label`;
}

export function settingHintKey(key: string): string {
  return `settings.keys.${key.replaceAll(".", "_")}.description`;
}

function text(messages: unknown, key: string): string {
  const value = message(messages, key);
  if (value === undefined) throw new Error(`${MESSAGES} has no text ${key}`);
  return value;
}

const LONG_DEFAULT = 80;
const CHILD_LABELS: Readonly<Record<string, string>> = { notifications: "notifications.channels" };

export function formatDefault(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (typeof value === "string") return value === "" ? "empty" : code(value);
  if (Array.isArray(value) && value.length === 0) return "empty";
  const json = JSON.stringify(value);
  if (json.length <= LONG_DEFAULT) return code(json);
  return Array.isArray(value) ? `a list of ${value.length} entries` : "a structured value";
}

export interface SettingText {
  readonly label: string;
  readonly hint: string;
}

function translated(source: SettingsSource, key: string | undefined): string {
  return (key === undefined ? undefined : message(source.messages, key)) ?? "";
}

export function settingText(source: SettingsSource, key: string, entry?: IndexEntry): SettingText {
  if (entry?.id === key) {
    return { label: translated(source, entry.labelKey), hint: translated(source, entry.descriptionKey) };
  }
  if (entry && key.startsWith(`${entry.id}.`)) {
    const child = key.slice(entry.id.length + 1);
    const prefix = CHILD_LABELS[entry.id.split(".")[0] ?? ""];
    const childLabel = prefix ? translated(source, `${prefix}.${child}`) : "";
    const label = translated(source, entry.labelKey);
    return { label: label && childLabel ? `${label}: ${childLabel}` : "", hint: "" };
  }
  return { label: translated(source, settingLabelKey(key)), hint: translated(source, settingHintKey(key)) };
}

function settingsOf(entry: IndexEntry, settings: readonly SettingEntry[]): SettingEntry[] {
  const own = settings.filter((setting) => setting.key === entry.id);
  return own.length > 0 ? own : settings.filter((setting) => setting.key.startsWith(`${entry.id}.`));
}

function row(source: SettingsSource, setting: SettingEntry, entry?: IndexEntry): string[] {
  const levels = setting.levels.map((level) => message(source.messages, `settings.levels.${level}`) ?? level);
  const { label, hint } = settingText(source, setting.key, entry);
  return [
    code(setting.key),
    label,
    levels.join(", "),
    formatDefault(setting.default),
    setting.format ?? allowedValues(setting.schema),
    setting.lockable ? "yes" : "no",
    hint,
  ];
}

const HEADER = ["Key", "Label", "Levels", "Default", "Allowed values", "Lockable", "Hint"];

function pageTitle(source: SettingsSource, item: SettingsPageEntry): string {
  const area = AREA_KEYS[item.section];
  return [
    area ? text(source.messages, area) : item.section,
    ...(item.groupKey ? [text(source.messages, item.groupKey)] : []),
    text(source.messages, item.labelKey),
  ].join(" › ");
}

function settingsPages(source: SettingsSource): SettingsPageEntry[] {
  const areas = Object.keys(AREA_KEYS);
  const items = [...source.pages]
    .filter((item) => source.index[item.id] !== undefined)
    .sort(
      (a, b) =>
        areas.indexOf(a.section) - areas.indexOf(b.section) || a.order - b.order || a.id.localeCompare(b.id),
    );
  const missing = Object.keys(source.index).filter((id) => !items.some((item) => item.id === id));
  if (missing.length > 0) throw new Error(`${PAGES} has no page ${missing.join(", ")}`);
  return items;
}

export function describedSettings(source: SettingsSource): Map<string, SettingText> {
  const texts = new Map<string, SettingText>();
  for (const item of settingsPages(source)) {
    for (const section of source.index[item.id] ?? []) {
      for (const entry of section.entries) {
        for (const setting of settingsOf(entry, source.settings)) {
          if (!texts.has(setting.key)) texts.set(setting.key, settingText(source, setting.key, entry));
        }
      }
    }
  }
  for (const setting of source.settings) {
    if (!texts.has(setting.key)) texts.set(setting.key, settingText(source, setting.key));
  }
  return texts;
}

export function renderSettings(source: SettingsSource): string {
  const shown = new Set<string>();
  const sectionsSeen = new Map<string, string>();
  const pages = settingsPages(source).flatMap((item) => {
    const title = pageTitle(source, item);
    const sections = (source.index[item.id] ?? []).flatMap((section) => {
      const settings = section.entries.flatMap((entry) =>
        settingsOf(entry, source.settings).map((setting) => ({ setting, entry })),
      );
      if (settings.length === 0) return [];
      const heading = `### ${text(source.messages, section.titleKey)}`;
      const signature = JSON.stringify([section.titleKey, settings.map(({ setting }) => setting.key)]);
      const earlier = sectionsSeen.get(signature);
      if (earlier !== undefined) {
        return [`${heading}\n\nThe same settings as in [${earlier}](#${slug(earlier)}).`];
      }
      sectionsSeen.set(signature, title);
      for (const { setting } of settings) shown.add(setting.key);
      return [
        `${heading}\n\n${table(
          HEADER,
          settings.map(({ setting, entry }) => row(source, setting, entry)),
        )}`,
      ];
    });
    return sections.length === 0 ? [] : [`## ${title}\n\n${sections.join("\n\n")}`];
  });

  const others = source.settings
    .filter((setting) => !shown.has(setting.key))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((setting) => row(source, setting));
  const rest =
    others.length === 0
      ? []
      : [
          `## Other settings\n\nSettings that have no entry in the settings search.\n\n${table(HEADER, others)}`,
        ];

  return [
    "Every setting stored in the database, grouped as in the settings navigation, with its English label and hint. **Levels** names where it can be set: a value set at a level applies to the levels below it unless they set their own. **Allowed values** comes from the schema the server checks values against. **Lockable** settings can be locked at a level so that the levels below cannot change them.",
    ...pages,
    ...rest,
  ].join("\n\n");
}

export const settingsReference = defineReference<SettingsSource>({
  page: "admin/settings-reference.md",
  title: "Settings reference",
  sources: [SETTINGS, INDEX, PAGES, MESSAGES],
  entry: `
import { z } from "zod";
import { settingDefinitions } from "./${SETTINGS}";
import { settingsPages } from "./${PAGES}";
import { SETTINGS_INDEX } from "./${INDEX}";
import messages from "./${MESSAGES}";

export default {
  settings: settingDefinitions.map((definition) => ({
    key: definition.key,
    levels: definition.levels,
    lockable: definition.lockable,
    default: definition.default,
    format: definition.format ?? null,
    schema: z.toJSONSchema(definition.schema, { io: "input", unrepresentable: "any" }),
  })),
  index: SETTINGS_INDEX,
  messages,
  pages: settingsPages,
};
`,
  render: renderSettings,
});
