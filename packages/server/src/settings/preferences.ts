import {
  accentColors,
  colorModes,
  dateFormats,
  densities,
  fonts,
  numberFormats,
  textSizes,
  timeFormats,
  weekStarts,
} from "@pagehall/shared";
import { z } from "zod";
import { defineSetting } from "./definition.js";

const localeLevels = ["instance", "organization", "user"] as const;

export const dateFormatSetting = defineSetting({
  key: "locale.dateFormat",
  schema: z.enum(dateFormats),
  default: "auto",
  levels: localeLevels,
  lockable: false,
});

export const timeFormatSetting = defineSetting({
  key: "locale.timeFormat",
  schema: z.enum(timeFormats),
  default: "auto",
  levels: localeLevels,
  lockable: false,
});

export const numberFormatSetting = defineSetting({
  key: "locale.numberFormat",
  schema: z.enum(numberFormats),
  default: "auto",
  levels: localeLevels,
  lockable: false,
});

export const firstDayOfWeekSetting = defineSetting({
  key: "locale.firstDayOfWeek",
  schema: z.enum(weekStarts),
  default: "auto",
  levels: localeLevels,
  lockable: false,
});

export const colorModeSetting = defineSetting({
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

export const textSizeSetting = defineSetting({
  key: "appearance.textSize",
  schema: z.union(textSizes.map((size) => z.literal(size))),
  default: 1,
  levels: ["user"],
  lockable: false,
});

export const densitySetting = defineSetting({
  key: "appearance.density",
  schema: z.enum(densities),
  default: "default",
  levels: ["user"],
  lockable: false,
});

export const fontSetting = defineSetting({
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

export const accentColorSetting = defineSetting({
  key: "branding.accentColor",
  schema: z.enum(accentColors),
  default: "petrol",
  levels: ["instance", "organization"],
  lockable: false,
});

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
  accentColorSetting,
];
