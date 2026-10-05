import type { ColorMode, DesignTokens } from "./index.js";

const PREFIX = "ph";

type Declarations = [name: string, value: string][];
type ColorSet = "light" | "dark" | "highContrastLight" | "highContrastDark";
type PaletteKey = keyof DesignTokens["color"]["palette"]["light"];

const DEFAULT_ACCENT: PaletteKey = "petrol";

function kebab(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function colorDeclarations(tokens: DesignTokens, set: ColorSet, mode: ColorMode): Declarations {
  const declarations: Declarations = [];
  for (const [key, value] of Object.entries(tokens.color[set])) {
    declarations.push([`--${PREFIX}-color-${kebab(key)}`, value]);
  }
  for (const [key, value] of Object.entries(tokens.color.palette[mode])) {
    declarations.push([`--${PREFIX}-palette-${kebab(key)}`, value]);
  }
  for (const [key, value] of Object.entries(tokens.color.status[mode])) {
    declarations.push([`--${PREFIX}-status-${kebab(key)}-bg`, value.bg]);
    declarations.push([`--${PREFIX}-status-${kebab(key)}-text`, value.text]);
  }
  return declarations;
}

function controlDeclarations(control: Record<string, string>): Declarations {
  return Object.entries(control).map(([key, value]) => [`--${PREFIX}-control-${kebab(key)}`, value]);
}

function rootDeclarations(tokens: DesignTokens): Declarations {
  return [
    ["font-size", `calc(var(--${PREFIX}-text-scale, ${tokens.textScale.default}) * 100%)`],
    [`--${PREFIX}-font-sans`, tokens.font.family.sans],
    [`--${PREFIX}-row`, tokens.layout.rowHeight.default],
    ...controlDeclarations(tokens.layout.control),
    [`--${PREFIX}-focus-width`, tokens.focusRing.width],
    [`--${PREFIX}-focus-offset`, tokens.focusRing.offset],
  ];
}

function sizeDeclarations(tokens: DesignTokens, namespace: string): Declarations {
  const { layout } = tokens;
  return [
    [`--${namespace}-card`, layout.cardWidth],
    [`--${namespace}-card-wide`, layout.cardWidthWide],
    [`--${namespace}-page`, layout.pageWidth],
    [`--${namespace}-panel`, layout.panelWidth],
    [`--${namespace}-content`, layout.contentWidth],
    ...Object.entries(layout.dialogWidth).map(([key, value]): [string, string] => [
      `--${namespace}-dialog-${key}`,
      value,
    ]),
  ];
}

function themeDeclarations(tokens: DesignTokens): Declarations {
  const colorNames = colorDeclarations(tokens, "light", "light").map(([name]) => name);
  return [
    ["--color-*", "initial"],
    ...colorNames.map((name): [string, string] => [
      `--color-${name.slice(`--${PREFIX}-`.length).replace(/^color-/, "")}`,
      `var(${name})`,
    ]),
    ["--font-*", "initial"],
    ["--font-sans", `var(--${PREFIX}-font-sans)`],
    ["--font-mono", tokens.font.family.mono],
    ["--font-readable", tokens.font.family.readable],
    ["--font-weight-*", "initial"],
    ...Object.entries(tokens.font.weight).map(([key, value]): [string, string] => [
      `--font-weight-${key}`,
      String(value),
    ]),
    ["--text-*", "initial"],
    ...Object.entries(tokens.font.size).map(([key, value]): [string, string] => [`--text-${key}`, value]),
    ["--leading-*", "initial"],
    ...Object.entries(tokens.font.lineHeight).map(([key, value]): [string, string] => [
      `--leading-${key}`,
      String(value),
    ]),
    ["--tracking-*", "initial"],
    ...Object.entries(tokens.font.letterSpacing).map(([key, value]): [string, string] => [
      `--tracking-${kebab(key)}`,
      value,
    ]),
    ["--spacing", "initial"],
    ["--spacing-*", "initial"],
    ...Object.entries(tokens.space).map(([key, value]): [string, string] => [`--spacing-${key}`, value]),
    ["--spacing-rail", tokens.layout.railWidth],
    ["--spacing-sidebar", tokens.layout.sidebarWidth],
    ["--spacing-toolbar", tokens.layout.toolbarHeight],
    ["--spacing-row", `var(--${PREFIX}-row)`],
    ["--spacing-row-compact", tokens.layout.rowHeight.compact],
    ...Object.keys(tokens.layout.control).map((key): [string, string] => [
      `--spacing-control-${kebab(key)}`,
      `var(--${PREFIX}-control-${kebab(key)})`,
    ]),
    ...sizeDeclarations(tokens, "spacing"),
    ["--spacing-qr", tokens.layout.qrCodeSize],
    ["--spacing-field", tokens.layout.fieldWidth],
    ["--spacing-hit", tokens.layout.hitArea],
    ["--spacing-number-field", tokens.layout.numberFieldWidth],
    ["--spacing-unit-field", tokens.layout.unitFieldWidth],
    ["--spacing-select-trigger", "var(--radix-select-trigger-width)"],
    ["--spacing-popover-trigger", "var(--radix-popover-trigger-width)"],
    ...Object.entries(tokens.icon.size).map(([key, value]): [string, string] => [
      `--spacing-icon-${key}`,
      value,
    ]),
    ["--container-*", "initial"],
    ...sizeDeclarations(tokens, "container"),
    ["--radius-*", "initial"],
    ...Object.entries(tokens.radius).map(([key, value]): [string, string] => [`--radius-${key}`, value]),
    ["--shadow-*", "initial"],
    ...Object.entries(tokens.shadow).map(([key, value]): [string, string] => [`--shadow-${key}`, value]),
  ];
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export function accentDeclarations(tokens: DesignTokens, key: PaletteKey, mode: ColorMode): Declarations {
  const color = tokens.color.palette[mode][key];
  const variable = (name: string) => `var(--${PREFIX}-color-${name})`;
  const hover = `color-mix(in oklab, ${color} 82%, ${variable("text")})`;
  const share = tokens.accentShare[mode];
  return [
    [`--${PREFIX}-color-accent`, color],
    [`--${PREFIX}-color-accent-hover`, hover],
    [`--${PREFIX}-color-on-accent`, tokens.color[mode].onAccent],
    [
      `--${PREFIX}-color-accent-soft`,
      `color-mix(in oklab, ${color} ${percent(share.soft)}, ${variable("bg")})`,
    ],
    [
      `--${PREFIX}-color-selected`,
      `color-mix(in oklab, ${color} ${percent(share.selected)}, ${variable("bg")})`,
    ],
    [`--${PREFIX}-color-selected-text`, hover],
  ];
}

function block(selector: string, declarations: Declarations, indent = ""): string {
  const body = declarations.map(([name, value]) => `${indent}  ${name}: ${value};`).join("\n");
  return `${indent}${selector} {\n${body}\n${indent}}`;
}

function media(content: string): string {
  return `@media (prefers-color-scheme: dark) {\n${content}\n}`;
}

const FOCUS_RING = `@utility focus-ring {
  outline: var(--${PREFIX}-focus-width) solid var(--${PREFIX}-color-accent);
  outline-offset: var(--${PREFIX}-focus-offset);
}`;

const SETTING_ROW = `@utility grid-cols-setting-row {
  grid-template-columns: minmax(0, 1fr) auto;
}`;

export function generateThemeCss(tokens: DesignTokens): string {
  const light: Declarations = [["color-scheme", "light"], ...colorDeclarations(tokens, "light", "light")];
  const dark: Declarations = [["color-scheme", "dark"], ...colorDeclarations(tokens, "dark", "dark")];
  const contrastLight: Declarations = [
    ["color-scheme", "light"],
    ...colorDeclarations(tokens, "highContrastLight", "light"),
    [`--${PREFIX}-focus-width`, tokens.focusRing.widthHighContrast],
  ];
  const contrastDark: Declarations = [
    ["color-scheme", "dark"],
    ...colorDeclarations(tokens, "highContrastDark", "dark"),
    [`--${PREFIX}-focus-width`, tokens.focusRing.widthHighContrast],
  ];
  const accents = (Object.keys(tokens.color.palette.light) as PaletteKey[])
    .filter((key) => key !== DEFAULT_ACCENT)
    .flatMap((key) => {
      const base = `:root[data-accent="${key}"]:not([data-contrast="high"])`;
      return [
        block(base, accentDeclarations(tokens, key, "light")),
        block(`${base}[data-theme="dark"]`, accentDeclarations(tokens, key, "dark")),
        media(block(`${base}:not([data-theme="light"])`, accentDeclarations(tokens, key, "dark"), "  ")),
      ];
    });
  return [
    "/* Generated from design-tokens.json by @pagehall/tokens. Do not edit. */",
    block("@theme inline", themeDeclarations(tokens)),
    '@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));',
    FOCUS_RING,
    SETTING_ROW,
    block(":root", rootDeclarations(tokens)),
    block(':root,\n[data-theme="light"]', light),
    block('[data-theme="dark"]', dark),
    media(block(':root:not([data-theme="light"])', dark, "  ")),
    block(':root[data-contrast="high"]', contrastLight),
    block(':root[data-contrast="high"][data-theme="dark"]', contrastDark),
    media(block(':root[data-contrast="high"]:not([data-theme="light"])', contrastDark, "  ")),
    block(':root[data-density="compact"]', [
      [`--${PREFIX}-row`, tokens.layout.rowHeight.compact],
      ...controlDeclarations(tokens.layout.controlCompact),
    ]),
    block(':root[data-font="readable"]', [[`--${PREFIX}-font-sans`, tokens.font.family.readable]]),
    ...accents,
    "",
  ].join("\n\n");
}
