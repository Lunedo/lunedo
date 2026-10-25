import i18next, { type BackendModule, type i18n } from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";

const translations = {
  en: () => import("./locales/en.json"),
  de: () => import("./locales/de.json"),
};

export type Language = keyof typeof translations;

export const supportedLanguages = Object.keys(translations) as Language[];

const lazyTranslations: BackendModule = {
  type: "backend",
  init() {},
  read(language, _namespace, callback) {
    if (!isLanguage(language)) {
      callback(null, {});
      return;
    }
    translations[language]().then(
      (module) => callback(null, module.default),
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), null),
    );
  },
};

const STORAGE_KEY = "lunedo.language";
const CHOICE_KEY = "lunedo.chosenLanguage";

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

export function rememberChosenLanguage(language: Language): void {
  try {
    globalThis.localStorage?.setItem(CHOICE_KEY, language);
  } catch {
    return;
  }
}

export function takeChosenLanguage(): Language | null {
  try {
    const value = globalThis.localStorage?.getItem(CHOICE_KEY);
    globalThis.localStorage?.removeItem(CHOICE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

export function initialLanguage(preferred: readonly string[]): Language {
  return storedLanguage() ?? detectLanguage(preferred);
}

export async function initI18n(preferred: readonly string[], instance: i18n = i18next.createInstance()) {
  const language = initialLanguage(preferred);
  await instance
    .use(lazyTranslations)
    .use(ICU)
    .use(initReactI18next)
    .init({
      lng: language,
      fallbackLng: false,
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
