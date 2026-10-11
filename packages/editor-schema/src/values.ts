import { common } from "lowlight";
import { z } from "zod";

export const contentColors = [
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;
export type ContentColor = (typeof contentColors)[number];

export const calloutVariants = ["info", "tip", "note", "warning", "error"] as const;
export type CalloutVariant = (typeof calloutVariants)[number];

export const textAlignments = ["left", "center", "right", "justify"] as const;
export type TextAlignment = (typeof textAlignments)[number];

export const imageAlignments = ["left", "center", "right"] as const;

export const codeLanguages: readonly string[] = [...Object.keys(common), "powershell"].sort();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export const MAX_HREF_LENGTH = 2048;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function isAllowedHref(href: string): boolean {
  if (href.length === 0 || href.length > MAX_HREF_LENGTH) return false;
  if (hasControlCharacter(href) || href.includes("\\") || href.trim() !== href) return false;
  if (href.startsWith("/")) return !href.startsWith("//");
  try {
    const url = new URL(href);
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false;
    return url.protocol === "mailto:" || url.hostname.length > 0;
  } catch {
    return false;
  }
}

export const MAX_LABEL_LENGTH = 100;
export const MAX_FILTER_LABELS = 20;
export const MAX_FILTER_PAGES = 20;

export function cleanLabel(value: string): string | null {
  const label = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}._-]/gu, "")
    .replace(/-+/g, "-");
  return label.length > 0 && label.length <= MAX_LABEL_LENGTH ? label : null;
}

const BUILT_IN_TEMPLATE = /^builtin:[a-z][a-z0-9-]{0,39}$/;

export function isTemplateId(value: string): boolean {
  return isUuid(value) || BUILT_IN_TEMPLATE.test(value);
}

function unique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

export const uuidValue = z.string().refine(isUuid, "Expected a lowercase UUID");
export const labelValue = z
  .string()
  .refine((value) => cleanLabel(value) === value, "Expected a lowercase label without spaces");
export const labelsValue = z
  .array(labelValue)
  .max(MAX_FILTER_LABELS)
  .refine(unique, "Each label may appear only once");
export const pageIdsValue = z
  .array(z.string().refine(isUuid, "Expected a lowercase UUID"))
  .max(MAX_FILTER_PAGES)
  .refine(unique, "Each page may appear only once");
export const templateIdValue = z
  .string()
  .refine(isTemplateId, "Expected a template ID or a built-in template such as builtin:how-to");
export const isoDateValue = z.string().refine(isIsoDate, "Expected a date in the form YYYY-MM-DD");
export const colorValue = z.enum(contentColors);
export const hrefValue = z.string().refine(isAllowedHref, "Expected an http, https, mailto or internal link");
export const emojiValue = z.string().regex(/^\p{RGI_Emoji}$/v, "Expected exactly one emoji");
export const alignmentValue = z.enum(textAlignments);
export const indentValue = z.number().int().min(0).max(8);
