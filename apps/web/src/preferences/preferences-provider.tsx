import type { AccentColor } from "@pagehall/shared";
import { useAppearance } from "@pagehall/ui";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { createFormatter, type Formatter } from "../format/format.js";
import { isLanguage, rememberLanguage, takeChosenLanguage } from "../i18n/index.js";
import {
  defaultPreferences,
  type PreferenceValues,
  preferenceKeys,
  rememberAppearance,
  storedAppearance,
  toPreferenceValues,
  usePreferenceList,
  useUpdatePreference,
} from "./preferences.js";

const PreferencesContext = createContext<PreferenceValues | null>(null);
const FormatContext = createContext<Formatter | null>(null);

let accent: AccentColor = "petrol";
const accentListeners = new Set<() => void>();

export function setAccentColor(next: AccentColor): void {
  if (next === accent) return;
  accent = next;
  for (const listener of accentListeners) listener();
}

function useAccentColor(): AccentColor {
  return useSyncExternalStore(
    (listener) => {
      accentListeners.add(listener);
      return () => accentListeners.delete(listener);
    },
    () => accent,
    () => accent,
  );
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const list = usePreferenceList();
  const [fallback] = useState<PreferenceValues>(() => ({
    ...defaultPreferences(isLanguage(i18n.language) ? i18n.language : "en"),
    ...storedAppearance(),
  }));
  const values = useMemo(
    () =>
      list.data
        ? toPreferenceValues(list.data, fallback)
        : { ...fallback, language: currentLanguage(i18n.language) },
    [list.data, fallback, i18n.language],
  );
  const accentColor = useAccentColor();
  const update = useUpdatePreference();
  const { mutate } = update;

  useEffect(() => {
    if (!list.data) return;
    const chosen = takeChosenLanguage();
    const own = list.data.find((entry) => entry.key === preferenceKeys.language);
    if (chosen && own && own.source !== "user" && own.lockedBy === null) {
      mutate({ key: preferenceKeys.language, value: chosen });
    }
  }, [list.data, mutate]);

  useAppearance({
    colorMode: values.colorMode,
    highContrast: values.highContrast,
    textSize: values.textSize,
    density: values.density,
    font: values.font,
    accent: accentColor,
  });

  useEffect(() => {
    if (!list.data) return;
    rememberAppearance(values);
    rememberLanguage(values.language);
    if (i18n.language !== values.language) void i18n.changeLanguage(values.language);
  }, [list.data, values, i18n]);

  const formatter = useMemo(
    () =>
      createFormatter({
        language: values.language,
        timeZone: values.timeZone,
        dateFormat: values.dateFormat,
        timeFormat: values.timeFormat,
        numberFormat: values.numberFormat,
        firstDayOfWeek: values.firstDayOfWeek,
      }),
    [values],
  );

  return (
    <PreferencesContext value={values}>
      <FormatContext value={formatter}>{children}</FormatContext>
    </PreferencesContext>
  );
}

function currentLanguage(language: string) {
  return isLanguage(language) ? language : "en";
}

export function usePreferences(): PreferenceValues {
  const values = useContext(PreferencesContext);
  if (!values) throw new Error("usePreferences needs a PreferencesProvider");
  return values;
}

export function useFormat(): Formatter {
  const formatter = useContext(FormatContext);
  if (!formatter) throw new Error("useFormat needs a PreferencesProvider");
  return formatter;
}
