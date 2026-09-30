import i18next, { type i18n } from "i18next";
import { initReactI18next } from "react-i18next";
import de from "./locales/de.json" with { type: "json" };
import en from "./locales/en.json" with { type: "json" };

export const resources = {
  en: { translation: en },
  de: { translation: de },
} as const;

export type Language = keyof typeof resources;

export const supportedLanguages = Object.keys(resources) as Language[];

export function detectLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split("-")[0];
    const match = supportedLanguages.find((language) => language === base);
    if (match) return match;
  }
  return "en";
}

export async function initI18n(preferred: readonly string[], instance: i18n = i18next.createInstance()) {
  const language = detectLanguage(preferred);
  await instance.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
  document.documentElement.lang = language;
  return instance;
}
