import i18next, { type i18n } from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
import de from "./locales/de.json" with { type: "json" };
import en from "./locales/en.json" with { type: "json" };

export const resources = {
  en: { translation: en },
  de: { translation: de },
} as const;

export type Language = keyof typeof resources;

export const supportedLanguages = Object.keys(resources) as Language[];

const STORAGE_KEY = "pagehall.language";

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (supportedLanguages as string[]).includes(value);
}

export function detectLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split("-")[0];
    const match = supportedLanguages.find((language) => language === base);
    if (match) return match;
  }
  return "en";
}

export function storedLanguage(): Language | null {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberLanguage(language: Language): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, language);
  } catch {
    return;
  }
}

export function initialLanguage(preferred: readonly string[]): Language {
  return storedLanguage() ?? detectLanguage(preferred);
}

export async function initI18n(preferred: readonly string[], instance: i18n = i18next.createInstance()) {
  const language = initialLanguage(preferred);
  await instance
    .use(ICU)
    .use(initReactI18next)
    .init({
      resources,
      lng: language,
      fallbackLng: "en",
      supportedLngs: supportedLanguages,
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  document.documentElement.lang = language;
  instance.on("languageChanged", (next) => {
    document.documentElement.lang = next;
  });
  return instance;
}
