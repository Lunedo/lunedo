import { type ContentLanguage, contentLanguages, OTHER_CONTENT_LANGUAGE } from "@lunedo/shared";
import type { TFunction } from "i18next";

export function contentLanguageLabel(t: TFunction, value: unknown, uiLanguage: string): string {
  if (typeof value !== "string") return "";
  if (value === OTHER_CONTENT_LANGUAGE) return t("contentLanguage.other");
  try {
    return new Intl.DisplayNames([uiLanguage], { type: "language" }).of(value) ?? value;
  } catch {
    return value;
  }
}

export function contentLanguageItems(
  t: TFunction,
  uiLanguage: string,
): { value: ContentLanguage; label: string; keywords: string[] }[] {
  const named = contentLanguages
    .filter((language) => language !== OTHER_CONTENT_LANGUAGE)
    .map((language) => ({
      value: language,
      label: contentLanguageLabel(t, language, uiLanguage),
      keywords: [language, contentLanguageLabel(t, language, "en")],
    }))
    .sort((left, right) => left.label.localeCompare(right.label, uiLanguage));
  return [
    ...named,
    { value: OTHER_CONTENT_LANGUAGE, label: t("contentLanguage.other"), keywords: [OTHER_CONTENT_LANGUAGE] },
  ];
}
