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
  fonts,
  type NumberFormat,
  numberFormats,
  type TextSize,
  type TimeFormat,
  textSizes,
  timeFormats,
  type WeekStart,
  weekStarts,
} from "@pagehall/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { type Preference, preferencesQuery, queryKeys, sessionQuery } from "../api/queries.js";
import { request } from "../api/request.js";
import { isLanguage, type Language } from "../i18n/index.js";

export interface PreferenceValues {
  language: Language;
  timeZone: string;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  numberFormat: NumberFormat;
  firstDayOfWeek: WeekStart;
  colorMode: ColorMode;
  highContrast: boolean;
  textSize: TextSize;
  density: Density;
  font: Font;
  sidebarCollapsed: boolean;
  editorToolbar: boolean;
}

export const preferenceKeys: Record<keyof PreferenceValues, string> = {
  language: "locale.language",
  timeZone: "locale.timeZone",
  dateFormat: "locale.dateFormat",
  timeFormat: "locale.timeFormat",
  numberFormat: "locale.numberFormat",
  firstDayOfWeek: "locale.firstDayOfWeek",
  colorMode: "appearance.colorMode",
  highContrast: "appearance.highContrast",
  textSize: "appearance.textSize",
  density: "appearance.density",
  font: "appearance.font",
  sidebarCollapsed: "appearance.sidebarCollapsed",
  editorToolbar: "appearance.editorToolbar",
};

const STORAGE_KEY = "pagehall.appearance";

function oneOf<T extends string | number>(values: readonly T[], value: unknown, fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

export function defaultPreferences(language: Language): PreferenceValues {
  return {
    language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    ...defaultFormats,
    colorMode: "system",
    highContrast: false,
    textSize: 1,
    density: "default",
    font: "default",
    sidebarCollapsed: false,
    editorToolbar: true,
  };
}

export function toPreferenceValues(
  list: readonly Preference[],
  fallback: PreferenceValues,
): PreferenceValues {
  const value = (key: keyof PreferenceValues) =>
    list.find((entry) => entry.key === preferenceKeys[key])?.value;
  const language = value("language");
  const timeZone = value("timeZone");
  return {
    language: isLanguage(language) ? language : fallback.language,
    timeZone: typeof timeZone === "string" && timeZone ? timeZone : fallback.timeZone,
    dateFormat: oneOf(dateFormats, value("dateFormat"), fallback.dateFormat),
    timeFormat: oneOf(timeFormats, value("timeFormat"), fallback.timeFormat),
    numberFormat: oneOf(numberFormats, value("numberFormat"), fallback.numberFormat),
    firstDayOfWeek: oneOf(weekStarts, value("firstDayOfWeek"), fallback.firstDayOfWeek),
    colorMode: oneOf(colorModes, value("colorMode"), fallback.colorMode),
    highContrast: value("highContrast") === true,
    textSize: oneOf(textSizes, value("textSize"), fallback.textSize),
    density: oneOf(densities, value("density"), fallback.density),
    font: oneOf(fonts, value("font"), fallback.font),
    sidebarCollapsed: value("sidebarCollapsed") === true,
    editorToolbar: value("editorToolbar") !== false,
  };
}

type Appearance = Pick<PreferenceValues, "colorMode" | "highContrast" | "textSize" | "density" | "font">;

export function storedAppearance(): Partial<Appearance> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      colorMode: oneOf(colorModes, parsed.colorMode, "system"),
      highContrast: parsed.highContrast === true,
      textSize: oneOf(textSizes, parsed.textSize, 1),
      density: oneOf(densities, parsed.density, "default"),
      font: oneOf(fonts, parsed.font, "default"),
    };
  } catch {
    return {};
  }
}

export function rememberAppearance(values: PreferenceValues): void {
  const appearance: Appearance = {
    colorMode: values.colorMode,
    highContrast: values.highContrast,
    textSize: values.textSize,
    density: values.density,
    font: values.font,
  };
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    return;
  }
}

export function isAccentColor(value: unknown): value is AccentColor {
  return accentColors.includes(value as AccentColor);
}

export function usePreferenceList() {
  const session = useQuery({ ...sessionQuery, throwOnError: false });
  return useQuery({
    ...preferencesQuery,
    enabled: session.data?.sessionKind === "full",
    throwOnError: false,
  });
}

export function useUpdatePreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      await request(() =>
        api.PUT("/api/v1/account/preferences/{key}", {
          params: { path: { key } },
          body: value === undefined ? { clear: true } : { value: value as never },
        }),
      );
    },
    onMutate: async ({ key, value }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.preferences });
      const previous = queryClient.getQueryData<Preference[]>(queryKeys.preferences);
      if (previous && value !== undefined) {
        queryClient.setQueryData<Preference[]>(
          queryKeys.preferences,
          previous.map((entry) =>
            entry.key === key ? { ...entry, value: value as never, source: "user" } : entry,
          ),
        );
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.preferences, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.preferences }),
  });
}
