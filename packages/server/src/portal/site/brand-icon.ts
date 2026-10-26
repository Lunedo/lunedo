import { readFileSync } from "node:fs";
import path from "node:path";
import { resourcePath } from "../../resources.js";

const ICONS = {
  "favicon.svg": "image/svg+xml",
  "favicon.ico": "image/x-icon",
} as const;

export type PortalIconName = keyof typeof ICONS;

export const PORTAL_ICONS = {
  svg: "favicon.svg",
  ico: "favicon.ico",
} as const satisfies Record<string, PortalIconName>;

const DIRECTORY = resourcePath("data", "portal");

export function portalIconByName(name: string): { type: string; data: Buffer } | null {
  if (!Object.hasOwn(ICONS, name)) return null;
  const icon = name as PortalIconName;
  return { type: ICONS[icon], data: readFileSync(path.join(DIRECTORY, icon)) };
}
