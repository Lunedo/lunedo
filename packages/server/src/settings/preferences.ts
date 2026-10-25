import {
  type AccentColor,
  accentColors,
  type ColorMode,
  colorModes,
  type DateFormat,
  type Density,
  dateFormats,
  defaultFormats,
  densities,
  type Font,
  type Formats,
  fonts,
  type NumberFormat,
  numberFormats,
  type TextSize,
  type TimeFormat,
  textSizes,
  timeFormats,
  type WeekStart,
  weekStarts,
} from "@lunedo/shared";
import { z } from "zod";
import { defineSetting, type SettingLevel } from "./definition.js";
import type { ScopeChain, SettingsService, WriteOptions } from "./service.js";

const localeLevels = ["instance", "organization", "user"] as const;

export const dateFormatSetting = defineSetting<DateFormat>({
  key: "locale.dateFormat",
  schema: z.enum(dateFormats),
  default: defaultFormats.dateFormat,
  levels: localeLevels,
  lockable: false,
});

export const timeFormatSetting = defineSetting<TimeFormat>({
  key: "locale.timeFormat",
  schema: z.enum(timeFormats),
  default: defaultFormats.timeFormat,
  levels: localeLevels,
  lockable: false,
});

export const numberFormatSetting = defineSetting<NumberFormat>({
  key: "locale.numberFormat",
  schema: z.enum(numberFormats),
  default: defaultFormats.numberFormat,
  levels: localeLevels,
  lockable: false,
});

export const firstDayOfWeekSetting = defineSetting<WeekStart>({
  key: "locale.firstDayOfWeek",
  schema: z.enum(weekStarts),
  default: defaultFormats.firstDayOfWeek,
  levels: localeLevels,
  lockable: false,
});

export const colorModeSetting = defineSetting<ColorMode>({
  key: "appearance.colorMode",
  schema: z.enum(colorModes),
  default: "system",
  levels: ["user"],
  lockable: false,
});

export const highContrastSetting = defineSetting({
  key: "appearance.highContrast",
  schema: z.boolean(),
  default: false,
  levels: ["user"],
  lockable: false,
});

export const textSizeSetting = defineSetting<TextSize>({
  key: "appearance.textSize",
  schema: z.union(textSizes.map((size) => z.literal(size))),
  default: 1,
  levels: ["user"],
  lockable: false,
});

export const densitySetting = defineSetting<Density>({
  key: "appearance.density",
  schema: z.enum(densities),
  default: "default",
  levels: ["user"],
  lockable: false,
});

export const fontSetting = defineSetting<Font>({
  key: "appearance.font",
  schema: z.enum(fonts),
  default: "default",
  levels: ["user"],
  lockable: false,
});

export const sidebarCollapsedSetting = defineSetting({
  key: "appearance.sidebarCollapsed",
  schema: z.boolean(),
  default: false,
  levels: ["user"],
  lockable: false,
});

export const sidebarCollapsedWhileEditingSetting = defineSetting({
  key: "appearance.sidebarCollapsedWhileEditing",
  schema: z.boolean(),
  default: true,
  levels: ["user"],
  lockable: false,
});

export const editorToolbarSetting = defineSetting({
  key: "appearance.editorToolbar",
  schema: z.boolean(),
  default: true,
  levels: ["user"],
  lockable: false,
});

export const folderViewSetting = defineSetting({
  key: "appearance.folderView",
  schema: z.enum(["list", "tiles"]),
  default: "list",
  levels: ["user"],
  lockable: false,
});

export const tablePageSizes = [25, 50, 100] as const;

export const tablePageSizeSetting = defineSetting({
  key: "appearance.tablePageSize",
  schema: z.union([z.literal(25), z.literal(50), z.literal(100)]),
  default: 25,
  levels: ["user"],
  lockable: false,
});

export const accentColorSetting = defineSetting<AccentColor>({
  key: "branding.accentColor",
  schema: z.enum(accentColors),
  default: "petrol",
  levels: ["instance", "organization"],
  lockable: false,
});

export const formatSettings = {
  dateFormat: dateFormatSetting,
  timeFormat: timeFormatSetting,
  numberFormat: numberFormatSetting,
  firstDayOfWeek: firstDayOfWeekSetting,
} as const;

export async function applyFormats(
  settings: SettingsService,
  chain: ScopeChain,
  level: SettingLevel,
  formats: Formats,
  options: WriteOptions = {},
): Promise<void> {
  await settings.set(formatSettings.dateFormat, chain, level, formats.dateFormat, options);
  await settings.set(formatSettings.timeFormat, chain, level, formats.timeFormat, options);
  await settings.set(formatSettings.numberFormat, chain, level, formats.numberFormat, options);
  await settings.set(formatSettings.firstDayOfWeek, chain, level, formats.firstDayOfWeek, options);
}

export const preferenceSettings = [
  dateFormatSetting,
  timeFormatSetting,
  numberFormatSetting,
  firstDayOfWeekSetting,
  colorModeSetting,
  highContrastSetting,
  textSizeSetting,
  densitySetting,
  fontSetting,
  sidebarCollapsedSetting,
  sidebarCollapsedWhileEditingSetting,
  editorToolbarSetting,
  folderViewSetting,
  tablePageSizeSetting,
  accentColorSetting,
];
