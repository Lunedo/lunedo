import type { ContentColor } from "@pagehall/editor-schema";

const NAMED: Readonly<Record<string, string>> = {
  black: "#000000",
  white: "#ffffff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  red: "#ff0000",
  maroon: "#800000",
  orange: "#ffa500",
  yellow: "#ffff00",
  olive: "#808000",
  lime: "#00ff00",
  green: "#008000",
  teal: "#008080",
  aqua: "#00ffff",
  cyan: "#00ffff",
  blue: "#0000ff",
  navy: "#000080",
  purple: "#800080",
  fuchsia: "#ff00ff",
  magenta: "#ff00ff",
  pink: "#ffc0cb",
};

function rgbOf(value: string): [number, number, number] | null {
  const text = (NAMED[value.trim().toLowerCase()] ?? value).trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (hex?.[1]) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join("") : hex[1];
    return [0, 2, 4].map((offset) => Number.parseInt(digits.slice(offset, offset + 2), 16)) as [
      number,
      number,
      number,
    ];
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/.exec(text);
  if (rgb) {
    const channels = [rgb[1], rgb[2], rgb[3]].map((channel) => Math.min(255, Number(channel)));
    return channels as [number, number, number];
  }
  return null;
}

export function paletteColor(value: string | undefined): ContentColor | null {
  if (!value) return null;
  const rgb = rgbOf(value);
  if (!rgb) return null;
  const [red, green, blue] = rgb.map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta < 0.0001) return "gray";
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.15 || lightness < 0.08) return "gray";
  let hue: number;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 345) return lightness > 0.8 ? "pink" : "red";
  if (hue < 40) return "orange";
  if (hue < 70) return "yellow";
  if (hue < 160) return "green";
  if (hue < 200) return "teal";
  if (hue < 250) return "blue";
  if (hue < 290) return "purple";
  return "pink";
}
