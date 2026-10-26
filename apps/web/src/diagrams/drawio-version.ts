export const DRAWIO_VERSION = "31.4.6";
export const DRAWIO_PATH = `/drawio/${DRAWIO_VERSION}/`;
export const DRAWIO_LANGUAGES = ["en", "de"] as const;

export function drawioLanguage(language: string): (typeof DRAWIO_LANGUAGES)[number] {
  return DRAWIO_LANGUAGES.find((candidate) => language.startsWith(candidate)) ?? "en";
}
