import { useEffect } from "react";
import { type ColorModePreference, resolveColorMode } from "./color-mode.js";

export interface Appearance {
  colorMode: ColorModePreference;
  highContrast: boolean;
  textSize: number;
  density: "default" | "compact";
  font: "default" | "readable";
  accent?: string | null | undefined;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";
const DEFAULT_ACCENT = "petrol";

function toggleAttribute(root: HTMLElement, name: string, value: string | null) {
  if (value === null) root.removeAttribute(name);
  else root.setAttribute(name, value);
}

export function applyAppearance(
  root: HTMLElement,
  appearance: Appearance,
  systemPrefersDark: boolean = window.matchMedia(DARK_QUERY).matches,
): void {
  root.dataset.theme = resolveColorMode(appearance.colorMode, systemPrefersDark);
  toggleAttribute(root, "data-contrast", appearance.highContrast ? "high" : null);
  toggleAttribute(root, "data-density", appearance.density === "compact" ? "compact" : null);
  toggleAttribute(root, "data-font", appearance.font === "readable" ? "readable" : null);
  toggleAttribute(
    root,
    "data-accent",
    appearance.accent && appearance.accent !== DEFAULT_ACCENT ? appearance.accent : null,
  );
  root.style.setProperty("--ld-text-scale", String(appearance.textSize));
}

export function useAppearance(appearance: Appearance, root: HTMLElement = document.documentElement): void {
  const { colorMode, highContrast, textSize, density, font, accent } = appearance;
  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const apply = () =>
      applyAppearance(root, { colorMode, highContrast, textSize, density, font, accent }, query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [colorMode, highContrast, textSize, density, font, accent, root]);
}
