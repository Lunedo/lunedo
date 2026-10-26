import type { ColorMode } from "@lunedo/shared";
import { Menu, type MenuItem } from "@lunedo/ui";
import { Globe, type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  isLanguage,
  rememberChosenLanguage,
  rememberLanguage,
  supportedLanguages,
} from "../../i18n/index.js";
import {
  chooseSignedOutColorMode,
  currentSignedOutColorMode,
  subscribeSignedOutColorMode,
} from "../../preferences/preferences.js";
import { languageLabel } from "../../settings/locale-options.js";

const COLOR_MODE_ICONS: Record<ColorMode, LucideIcon> = { system: Monitor, light: Sun, dark: Moon };
const COLOR_MODES: ColorMode[] = ["system", "light", "dark"];

const CORNER_BUTTON =
  "inline-flex min-h-hit min-w-hit items-center justify-center gap-1 rounded-md px-2 text-sm text-text-muted hover:bg-hover hover:text-text focus-visible:focus-ring";

export function CornerControls({
  languageLabelKey = "auth.language",
  ownLanguage = false,
}: {
  languageLabelKey?: "auth.language" | "setup.language";
  ownLanguage?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const colorMode = useSyncExternalStore(
    subscribeSignedOutColorMode,
    currentSignedOutColorMode,
    currentSignedOutColorMode,
  );
  const current = isLanguage(i18n.language) ? i18n.language : "en";
  const languageName = languageLabel(t, current);
  const label = t(languageLabelKey);
  const languages: MenuItem[] = supportedLanguages.map((language) => ({
    label: languageLabel(t, language),
    icon: Globe,
    checked: language === current,
    onSelect: () => {
      rememberLanguage(language);
      if (ownLanguage) rememberChosenLanguage(language);
      void i18n.changeLanguage(language);
    },
  }));
  const appearances: MenuItem[] = COLOR_MODES.map((mode) => ({
    label: t(`auth.appearance.${mode}`),
    icon: COLOR_MODE_ICONS[mode],
    checked: mode === colorMode,
    onSelect: () => chooseSignedOutColorMode(mode),
  }));
  const ModeIcon = COLOR_MODE_ICONS[colorMode];
  return (
    <div className="absolute top-3 right-4 z-10 flex gap-1">
      <Menu
        trigger={
          <button type="button" className={CORNER_BUTTON} title={label}>
            <Globe aria-hidden="true" className="size-icon-md" />
            <span className="sr-only">
              {t("auth.corner.languageCurrent", { label, language: languageName })}
            </span>
            <span className="font-medium">{current.toUpperCase()}</span>
          </button>
        }
        items={languages}
      />
      <Menu
        trigger={
          <button
            type="button"
            className={CORNER_BUTTON}
            aria-label={t("auth.corner.appearanceCurrent", { mode: t(`auth.appearance.${colorMode}`) })}
            title={t("auth.corner.appearance")}
          >
            <ModeIcon aria-hidden="true" className="size-icon-md" />
          </button>
        }
        items={appearances}
      />
    </div>
  );
}
