import { describe, expect, it } from "vitest";
import { accentKeys, type DesignTokens, tokens } from "./index.js";
import { generateThemeCss } from "./theme.js";

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const [red = 0, green = 0, blue = 0] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(left: string, right: string): number {
  const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

const colorSets = ["light", "dark", "highContrastLight", "highContrastDark"] as const;

describe("design tokens", () => {
  it("define the same color keys in every set and mode", () => {
    for (const set of colorSets) {
      expect(Object.keys(tokens.color[set]), set).toEqual(Object.keys(tokens.color.light));
    }
    expect(Object.keys(tokens.color.palette.dark)).toEqual(Object.keys(tokens.color.palette.light));
    expect(Object.keys(tokens.color.status.dark)).toEqual(Object.keys(tokens.color.status.light));
    expect(Object.keys(tokens.layout.controlCompact)).toEqual(Object.keys(tokens.layout.control));
  });

  it("use the petrol accent from the visual design decision", () => {
    expect(tokens.color.light.accent).toBe("#0B6F78");
    expect(tokens.color.dark.accent).toBe("#5DB9C2");
  });

  it("keep text readable on every surface, with more contrast in high-contrast mode", () => {
    for (const set of colorSets) {
      const colors = tokens.color[set];
      for (const surface of [colors.bg, colors.surface, colors.sidebar, colors.surfaceSunken]) {
        expect(contrast(colors.text, surface), set).toBeGreaterThanOrEqual(7);
        expect(contrast(colors.textMuted, surface), set).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors.accent, surface), set).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(colors.onAccent, colors.accent), set).toBeGreaterThanOrEqual(4.5);
    }
    for (const set of ["highContrastLight", "highContrastDark"] as const) {
      const colors = tokens.color[set];
      expect(contrast(colors.text, colors.bg), set).toBeGreaterThanOrEqual(19);
      expect(contrast(colors.textMuted, colors.bg), set).toBeGreaterThanOrEqual(7);
      expect(contrast(colors.border, colors.bg), set).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("offer accent colors that work as text and behind text in both modes", () => {
    for (const key of accentKeys) {
      for (const mode of ["light", "dark"] as const) {
        const accent = tokens.color.palette[mode][key];
        expect(contrast(accent, tokens.color[mode].bg), `${key} ${mode}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens.color[mode].onAccent, accent), `${key} ${mode}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("generateThemeCss", () => {
  const css = generateThemeCss(tokens);

  it("defines light variables on the root and dark variables for the dark theme", () => {
    expect(ruleBody(css, '[data-theme="light"]')).toContain("--ph-color-accent: #0B6F78;");
    expect(ruleBody(css, '[data-theme="dark"]')).toContain("--ph-color-accent: #5DB9C2;");
    expect(ruleBody(css, '[data-theme="dark"]')).toContain("color-scheme: dark;");
  });

  it("follows the system preference unless a theme is selected explicitly", () => {
    const media = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
    expect(media).toContain(':root:not([data-theme="light"]) {');
    expect(media).toContain("--ph-color-bg: #151617;");
  });

  it("maps every color variable into the Tailwind theme", () => {
    const theme = ruleBody(css, "@theme inline");
    for (const key of Object.keys(tokens.color.light)) {
      const name = key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
      expect(theme).toContain(`--color-${name}: var(--ph-color-${name});`);
    }
    expect(theme).toContain("--color-palette-petrol: var(--ph-palette-petrol);");
    expect(theme).toContain("--color-status-in-progress-bg: var(--ph-status-in-progress-bg);");
  });

  it("resets the default Tailwind scales so that only token values exist", () => {
    const theme = ruleBody(css, "@theme inline");
    for (const namespace of [
      "--color-*",
      "--spacing-*",
      "--radius-*",
      "--shadow-*",
      "--text-*",
      "--font-*",
      "--container-*",
    ]) {
      expect(theme).toContain(`${namespace}: initial;`);
    }
    expect(theme).toContain("--spacing-rail: 3.75rem;");
    expect(theme).toContain("--text-base: 0.875rem;");
    expect(theme).toContain("--shadow-popover: 0 10px 30px rgba(0, 0, 0, 0.12);");
  });

  it("switches to high contrast for light, dark and the system preference", () => {
    expect(ruleBody(css, ':root[data-contrast="high"]')).toContain("--ph-color-text: #000000;");
    expect(ruleBody(css, ':root[data-contrast="high"][data-theme="dark"]')).toContain(
      "--ph-color-text: #FFFFFF;",
    );
    expect(ruleBody(css, ':root[data-contrast="high"]:not([data-theme="light"])')).toContain(
      "--ph-color-bg: #000000;",
    );
    expect(ruleBody(css, ':root[data-contrast="high"]')).toContain("--ph-focus-width: 0.1875rem;");
  });

  it("scales the root font size with the text scale", () => {
    expect(ruleBody(css, ":root")).toContain("font-size: calc(var(--ph-text-scale, 1) * 100%);");
  });

  it("shrinks rows and controls in the compact density", () => {
    const compact = ruleBody(css, ':root[data-density="compact"]');
    expect(compact).toContain("--ph-row: 1.75rem;");
    expect(compact).toContain("--ph-control-field: 2rem;");
    expect(ruleBody(css, "@theme inline")).toContain("--spacing-control-md: var(--ph-control-md);");
  });

  it("keeps rows at least 24 pixels high at the smallest text size", () => {
    const smallest = (value: string) => Number.parseFloat(value) * 16 * tokens.textScale.min;
    expect(smallest(tokens.layout.rowHeight.default)).toBeGreaterThanOrEqual(24);
    expect(smallest(tokens.layout.rowHeight.compact)).toBeGreaterThanOrEqual(24);
  });

  it("switches the font for the reading-friendly option", () => {
    expect(ruleBody(css, ':root[data-font="readable"]')).toContain("Atkinson Hyperlegible Next");
    expect(ruleBody(css, "@theme inline")).toContain("--font-sans: var(--ph-font-sans);");
  });

  it("derives every accent but the default from the palette, outside high contrast", () => {
    for (const key of accentKeys.filter((candidate) => candidate !== "petrol")) {
      const selector = `:root[data-accent="${key}"]:not([data-contrast="high"])`;
      expect(ruleBody(css, selector)).toContain(`--ph-color-accent: ${tokens.color.palette.light[key]};`);
      expect(ruleBody(css, `${selector}[data-theme="dark"]`)).toContain(
        `--ph-color-accent: ${tokens.color.palette.dark[key]};`,
      );
      expect(ruleBody(css, `${selector}:not([data-theme="light"])`)).toContain(
        `--ph-color-on-accent: ${tokens.color.dark.onAccent};`,
      );
    }
    expect(css).not.toContain('[data-accent="petrol"]');
  });

  it("maps layout widths for maximum widths and sizes", () => {
    const theme = ruleBody(css, "@theme inline");
    for (const name of ["card", "card-wide", "page", "panel", "dialog-sm", "dialog-md", "dialog-lg"]) {
      expect(theme).toContain(`--spacing-${name}:`);
      expect(theme).toContain(`--container-${name}:`);
    }
    expect(theme).toContain("--spacing-qr: 7.5rem;");
    expect(theme).toContain("--spacing-field: 16rem;");
  });

  it("defines a focus ring utility from tokens", () => {
    expect(css).toContain("@utility focus-ring {");
    expect(css).toContain("outline: var(--ph-focus-width) solid var(--ph-color-accent);");
  });

  it("reflects token changes", () => {
    const changed: DesignTokens = structuredClone(tokens);
    changed.color.light.accent = "#123456";
    expect(ruleBody(generateThemeCss(changed), '[data-theme="light"]')).toContain(
      "--ph-color-accent: #123456;",
    );
  });
});
