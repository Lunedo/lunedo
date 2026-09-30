import type { ColorMode, DesignTokens } from "./index.js";

const PREFIX = "ph";

type Declarations = [name: string, value: string][];

function kebab(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function colorDeclarations(tokens: DesignTokens, mode: ColorMode): Declarations {
  const declarations: Declarations = [];
  for (const [key, value] of Object.entries(tokens.color[mode])) {
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

function themeDeclarations(tokens: DesignTokens): Declarations {
  const colorNames = colorDeclarations(tokens, "light").map(([name]) => name);
  const declarations: Declarations = [
    ["--color-*", "initial"],
    ...colorNames.map((name): [string, string] => [
      `--color-${name.slice(`--${PREFIX}-`.length).replace(/^color-/, "")}`,
      `var(${name})`,
    ]),
    ["--font-*", "initial"],
    ...Object.entries(tokens.font.family).map(([key, value]): [string, string] => [`--font-${key}`, value]),
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
    ["--spacing-content", tokens.layout.contentWidth],
    ["--spacing-row", tokens.layout.rowHeight.default],
    ["--spacing-row-compact", tokens.layout.rowHeight.compact],
    ...Object.entries(tokens.icon.size).map(([key, value]): [string, string] => [
      `--spacing-icon-${key}`,
      value,
    ]),
    ["--radius-*", "initial"],
    ...Object.entries(tokens.radius).map(([key, value]): [string, string] => [`--radius-${key}`, value]),
    ["--shadow-*", "initial"],
    ...Object.entries(tokens.shadow).map(([key, value]): [string, string] => [`--shadow-${key}`, value]),
  ];
  return declarations;
}

function block(selector: string, declarations: Declarations, indent = ""): string {
  const body = declarations.map(([name, value]) => `${indent}  ${name}: ${value};`).join("\n");
  return `${indent}${selector} {\n${body}\n${indent}}`;
}

/**
 * Generates the Tailwind theme and the CSS variables for both color modes.
 * The light mode applies by default, the dark mode follows the system preference
 * unless `data-theme` on the root element selects a mode explicitly.
 */
export function generateThemeCss(tokens: DesignTokens): string {
  const light: Declarations = [["color-scheme", "light"], ...colorDeclarations(tokens, "light")];
  const dark: Declarations = [["color-scheme", "dark"], ...colorDeclarations(tokens, "dark")];
  return [
    "/* Generated from design-tokens.json by @pagehall/tokens. Do not edit. */",
    block("@theme inline", themeDeclarations(tokens)),
    '@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));',
    block(':root,\n[data-theme="light"]', light),
    block('[data-theme="dark"]', dark),
    `@media (prefers-color-scheme: dark) {\n${block(':root:not([data-theme="light"])', dark, "  ")}\n}`,
    "",
  ].join("\n\n");
}
