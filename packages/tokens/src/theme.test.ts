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

type Triple = [number, number, number];

function toLinear(hex: string): Triple {
  return [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as Triple;
}

function toHex(linear: Triple): string {
  return `#${linear
    .map((value) => {
      const clamped = Math.min(1, Math.max(0, value));
      const encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
      return Math.round(encoded * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

function linearToOklab([r, g, b]: Triple): Triple {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear([lightness, a, b]: Triple): Triple {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function mixOklab(first: string, second: string, share: number): string {
  const left = linearToOklab(toLinear(first));
  const right = linearToOklab(toLinear(second));
  return toHex(
    oklabToLinear(left.map((value, index) => value * share + (right[index] ?? 0) * (1 - share)) as Triple),
  );
}

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

  it("give control boundaries at least 3:1 contrast against every surface", () => {
    for (const set of colorSets) {
      const colors = tokens.color[set];
      for (const surface of [colors.bg, colors.surface, colors.sidebar, colors.surfaceSunken, colors.hover]) {
        expect(contrast(colors.controlBorder, surface), set).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keep the selected item readable and marked with the accent in every set", () => {
    for (const set of colorSets) {
      const colors = tokens.color[set];
      expect(contrast(colors.selectedText, colors.selected), set).toBeGreaterThanOrEqual(4.5);
      expect(colors.selectedText, set).not.toBe(colors.text);
    }
  });

  it("give secondary controls a visible boundary and readable text in every set", () => {
    for (const set of colorSets) {
      const colors = tokens.color[set];
      for (const background of [colors.control, colors.controlHover]) {
        expect(contrast(colors.controlBorder, background), set).toBeGreaterThanOrEqual(3);
        expect(contrast(colors.text, background), set).toBeGreaterThanOrEqual(4.5);
      }
      for (const surface of [colors.surface, colors.bg, colors.sidebar]) {
        expect(contrast(colors.controlBorder, surface), set).toBeGreaterThanOrEqual(3);
        expect(contrast(colors.textMuted, surface), `${set} icon`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("mark the selected item with a soft accent that is as visible in dark mode as in light mode", () => {
    const chroma = (hex: string) => Math.hypot(...linearToOklab(toLinear(hex)).slice(1));
    expect(chroma(tokens.color.dark.selected)).toBeGreaterThanOrEqual(
      chroma(tokens.color.light.selected) * 1.5,
    );
    for (const key of accentKeys) {
      const light = mixOklab(
        tokens.color.palette.light[key],
        tokens.color.light.bg,
        tokens.accentShare.light.selected,
      );
      const dark = mixOklab(
        tokens.color.palette.dark[key],
        tokens.color.dark.bg,
        tokens.accentShare.dark.selected,
      );
      expect(chroma(dark), key).toBeGreaterThanOrEqual(chroma(light));
    }
  });

  it("keep derived accent colors readable for every palette color", () => {
    for (const key of accentKeys) {
      for (const mode of ["light", "dark"] as const) {
        const accent = tokens.color.palette[mode][key];
        const colors = tokens.color[mode];
        const share = tokens.accentShare[mode];
        const selected = mixOklab(accent, colors.bg, share.selected);
        const selectedText = mixOklab(accent, colors.text, 0.82);
        expect(contrast(selectedText, selected), `${key} ${mode} selected`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors.onAccent, accent), `${key} ${mode} on accent`).toBeGreaterThanOrEqual(4.5);
        const soft = mixOklab(accent, colors.bg, share.soft);
        expect(contrast(accent, soft), `${key} ${mode} icon on soft`).toBeGreaterThanOrEqual(3);
      }
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

  it("keeps hit areas at least 44 pixels at every text size", () => {
    expect(tokens.layout.hitArea).toBe("44px");
    expect(ruleBody(css, "@theme inline")).toContain("--spacing-hit: 44px;");
  });

  it("lets popovers match the width of their trigger and lays out setting rows in fixed columns", () => {
    const theme = ruleBody(css, "@theme inline");
    expect(theme).toContain("--spacing-select-trigger: var(--radix-select-trigger-width);");
    expect(theme).toContain("--spacing-popover-trigger: var(--radix-popover-trigger-width);");
    expect(css).toContain("@utility grid-cols-setting-row {\n  grid-template-columns: minmax(0, 1fr) auto;");
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
