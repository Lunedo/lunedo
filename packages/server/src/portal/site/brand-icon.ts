import { readFileSync } from "node:fs";

const ICONS = {
  "favicon.svg": "image/svg+xml",
  "favicon.ico": "image/x-icon",
} as const;

export type PortalIconName = keyof typeof ICONS;

export const PORTAL_ICONS = {
  svg: "favicon.svg",
  ico: "favicon.ico",
} as const satisfies Record<string, PortalIconName>;

const DIRECTORY = new URL("../../../data/portal/", import.meta.url);

export function portalIconByName(name: string): { type: string; data: Buffer } | null {
  if (!Object.hasOwn(ICONS, name)) return null;
  const icon = name as PortalIconName;
  return { type: ICONS[icon], data: readFileSync(new URL(icon, DIRECTORY)) };
}
