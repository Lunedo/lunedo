import { useEffect } from "react";

export type ColorModePreference = "system" | "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveColorMode(
  preference: ColorModePreference,
  systemPrefersDark: boolean,
): "light" | "dark" {
  if (preference !== "system") return preference;
  return systemPrefersDark ? "dark" : "light";
}

/**
 * Sets `data-theme` on the root element so that the token variables and the
 * `dark` variant follow the preference, and tracks system changes.
 */
export function useColorMode(preference: ColorModePreference, root: HTMLElement = document.documentElement) {
  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const apply = () => {
      root.dataset.theme = resolveColorMode(preference, query.matches);
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [preference, root]);
}
