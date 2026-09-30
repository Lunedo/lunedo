import { describe, expect, it } from "vitest";
import { type DesignTokens, tokens } from "./index.js";
import { generateThemeCss } from "./theme.js";

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

describe("design tokens", () => {
  it("define the same color keys in light and dark mode", () => {
    expect(Object.keys(tokens.color.dark)).toEqual(Object.keys(tokens.color.light));
    expect(Object.keys(tokens.color.palette.dark)).toEqual(Object.keys(tokens.color.palette.light));
    expect(Object.keys(tokens.color.status.dark)).toEqual(Object.keys(tokens.color.status.light));
  });

  it("use the petrol accent from the visual design decision", () => {
    expect(tokens.color.light.accent).toBe("#0B6F78");
    expect(tokens.color.dark.accent).toBe("#5DB9C2");
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
    ]) {
      expect(theme).toContain(`${namespace}: initial;`);
    }
    expect(theme).toContain("--spacing-rail: 3.75rem;");
    expect(theme).toContain("--text-base: 0.875rem;");
    expect(theme).toContain("--shadow-popover: 0 10px 30px rgba(0, 0, 0, 0.12);");
  });

  it("reflects token changes", () => {
    const changed: DesignTokens = structuredClone(tokens);
    changed.color.light.accent = "#123456";
    expect(ruleBody(generateThemeCss(changed), '[data-theme="light"]')).toContain(
      "--ph-color-accent: #123456;",
    );
  });
});
