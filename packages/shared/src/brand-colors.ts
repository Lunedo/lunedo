export type BrandMode = "light" | "dark";

export const MINIMUM_CONTRAST = 4.5;

const HEX = /^#[0-9A-F]{6}$/;

export interface ContrastPair {
  background: string;
  onBrand: string;
}

export interface BrandCheck {
  passes: boolean;
  onBackground: number;
  onBrand: number;
}

export function normalizeHex(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  const full = /^#?[0-9A-F]{3}$/.test(trimmed)
    ? `#${[...trimmed.replace("#", "")].map((digit) => digit + digit).join("")}`
    : trimmed.startsWith("#")
      ? trimmed
      : `#${trimmed}`;
  return HEX.test(full) ? full : null;
}

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex([red, green, blue]: [number, number, number]): string {
  return `#${[red, green, blue]
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

function luminance(hex: string): number {
  const [red, green, blue] = channels(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

export function checkBrandColor(color: string, pair: ContrastPair): BrandCheck {
  const onBackground = contrastRatio(color, pair.background);
  const onBrand = contrastRatio(color, pair.onBrand);
  return {
    passes: onBackground >= MINIMUM_CONTRAST && onBrand >= MINIMUM_CONTRAST,
    onBackground: Math.round(onBackground * 100) / 100,
    onBrand: Math.round(onBrand * 100) / 100,
  };
}

function toHsl(hex: string): [number, number, number] {
  const [red, green, blue] = channels(hex).map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue =
    max === red
      ? (green - blue) / delta + (green < blue ? 6 : 0)
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return [hue / 6, saturation, lightness];
}

function fromHsl([hue, saturation, lightness]: [number, number, number]): string {
  if (saturation === 0) return toHex([lightness * 255, lightness * 255, lightness * 255]);
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (offset: number) => {
    let t = hue + offset;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return toHex([channel(1 / 3) * 255, channel(0) * 255, channel(-1 / 3) * 255]);
}

export function proposeBrandColor(color: string, mode: BrandMode, pair: ContrastPair): string | null {
  if (checkBrandColor(color, pair).passes) return color;
  const [hue, saturation, start] = toHsl(color);
  const step = mode === "light" ? -0.005 : 0.005;
  for (let lightness = start + step; lightness >= 0 && lightness <= 1; lightness += step) {
    const candidate = fromHsl([hue, saturation, lightness]);
    if (checkBrandColor(candidate, pair).passes) return candidate;
  }
  return null;
}
