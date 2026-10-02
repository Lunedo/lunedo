import designTokens from "./design-tokens.json" with { type: "json" };

export type DesignTokens = typeof designTokens;
export type ColorMode = "light" | "dark";
export type AccentKey = keyof DesignTokens["color"]["palette"]["light"];

export const tokens: DesignTokens = designTokens;
export const colorModes: readonly ColorMode[] = ["light", "dark"];
export const accentKeys = Object.keys(designTokens.color.palette.light) as AccentKey[];

export { accentDeclarations, generateThemeCss } from "./theme.js";
