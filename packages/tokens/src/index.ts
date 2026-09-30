import designTokens from "./design-tokens.json" with { type: "json" };

export type DesignTokens = typeof designTokens;
export type ColorMode = "light" | "dark";

export const tokens: DesignTokens = designTokens;
export const colorModes: readonly ColorMode[] = ["light", "dark"];

export { generateThemeCss } from "./theme.js";
