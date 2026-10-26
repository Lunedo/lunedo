import type { Language } from "./index.js";
import de from "./locales/de.json" with { type: "json" };
import en from "./locales/en.json" with { type: "json" };

export const resources: Record<Language, { translation: typeof en }> = {
  en: { translation: en },
  de: { translation: de },
};
