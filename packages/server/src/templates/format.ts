import { createHash } from "node:crypto";
import { portableRemovals } from "@lunedo/editor-schema";
import { z } from "zod";
import { MEGABYTE } from "../files/settings.js";
import { SpaceError } from "../spaces/common.js";
import { templateLanguages } from "./builtin/types.js";
import { templateFieldsSchema } from "./fields.js";
import { templateCategories } from "./schema.js";
import {
  seriesDefaultsSchema,
  TEMPLATE_DESCRIPTION_MAX_LENGTH,
  TEMPLATE_NAME_MAX_LENGTH,
  TEMPLATE_TITLE_MAX_LENGTH,
} from "./templates.js";

export const templateRemovalKinds = portableRemovals;

export const TEMPLATE_FORMAT = "lunedo-template";
export const TEMPLATE_FORMAT_VERSION = 1;
export const TEMPLATE_UPLOAD_MAX_BYTES = 20 * MEGABYTE;
export const TEMPLATE_ENTRY_MAX_BYTES = 5 * MEGABYTE;
export const TEMPLATE_MANIFEST_MAX_BYTES = 5 * MEGABYTE;
export const MAX_TEMPLATES_PER_UPLOAD = 50;
export const MAX_FILES_PER_UPLOAD = 200;
export const TEMPLATE_MANIFEST = "template.json";
export const TEMPLATE_JSON_SUFFIX = ".lunedo-template.json";
export const TEMPLATE_ZIP_SUFFIX = ".lunedo-template.zip";

export const templateFileTypes = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/vnd.excalidraw+json": "excalidraw",
  "application/vnd.jgraph.mxfile": "drawio",
} as const;
export type TemplateFileType = keyof typeof templateFileTypes;
export const templateMediaTypes = Object.keys(templateFileTypes) as TemplateFileType[];
export const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

export const FILE_PATH = /^files\/([0-9a-f]{64})\.(png|jpg|gif|webp|svg|excalidraw|drawio)$/;

export class TemplateFileError extends SpaceError {
  override name = "TemplateFileError";
}

export const templateFileEntrySchema = z
  .object({
    path: z
      .string()
      .regex(FILE_PATH, "Expected files/ followed by the SHA-256 hash of the file and its extension")
      .describe("Path of the file in the archive: `files/<sha256>.<extension>`."),
    mediaType: z.enum(templateMediaTypes).describe("Media type of the file."),
    size: z.number().int().min(1).max(TEMPLATE_ENTRY_MAX_BYTES).describe("Size in bytes."),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "Expected a lowercase hexadecimal SHA-256 hash")
      .describe("SHA-256 hash of the content, lowercase hexadecimal."),
    name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^/\\\p{Cc}]+$/u, "Expected a file name without paths or control characters")
      .describe("File name shown when the template is used."),
  })
  .strict()
  .describe("A file the template uses.");

export const templateEntrySchema = z
  .object({
    name: z.string().min(1).max(TEMPLATE_NAME_MAX_LENGTH).describe("Name of the template."),
    description: z.string().max(TEMPLATE_DESCRIPTION_MAX_LENGTH).describe("Short description."),
    category: z.enum(templateCategories).describe("Category in the gallery."),
    language: z.enum(templateLanguages).nullable().describe("Language of the content, or null if unknown."),
    titlePattern: z
      .string()
      .min(1)
      .max(TEMPLATE_TITLE_MAX_LENGTH)
      .describe("Title of new pages; `{key}` inserts the value of an input field."),
    fields: templateFieldsSchema.describe("Input fields asked for when a page is created."),
    series: seriesDefaultsSchema.nullable().describe("Defaults of a series template, or null."),
    files: z.array(templateFileEntrySchema).max(MAX_FILES_PER_UPLOAD).describe("Files the content uses."),
    document: z
      .looseObject({ type: z.literal("doc").describe("Always `doc`.") })
      .describe("Content in the editor format of the stated schema version."),
  })
  .strict()
  .describe("A template.");

export const templateManifestSchema = z
  .object({
    format: z.literal(TEMPLATE_FORMAT).describe("Always `lunedo-template`."),
    formatVersion: z.literal(TEMPLATE_FORMAT_VERSION).describe("Version of this file format."),
    schemaVersion: z.number().int().min(1).describe("Version of the editor format of the documents."),
    lunedoVersion: z.string().min(1).max(100).describe("Version of Lunedo that wrote the file."),
    templates: z
      .array(templateEntrySchema)
      .min(1)
      .max(MAX_TEMPLATES_PER_UPLOAD)
      .describe("The templates of the file."),
  })
  .strict()
  .describe("A Lunedo template file.");

export type TemplateManifest = z.infer<typeof templateManifestSchema>;
export type TemplateEntry = z.infer<typeof templateEntrySchema>;
export type TemplateFileEntry = z.infer<typeof templateFileEntrySchema>;

export function templateFormatJsonSchema(): Record<string, unknown> {
  return {
    title: "Lunedo template file",
    ...z.toJSONSchema(templateManifestSchema, { target: "draft-2020-12", io: "input" }),
  };
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function uuidFromHex(hex: string): string {
  const variant = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const digits = `${hex.slice(0, 12)}8${hex.slice(13, 16)}${variant}${hex.slice(17, 32)}`;
  return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-${digits.slice(12, 16)}-${digits.slice(16, 20)}-${digits.slice(20, 32)}`;
}

export function fileReference(hash: string): string {
  return uuidFromHex(hash);
}

export function blockReference(index: number): string {
  return uuidFromHex(createHash("sha256").update(`block:${index}`).digest("hex"));
}

const KEY_ORDER = [
  "format",
  "formatVersion",
  "schemaVersion",
  "lunedoVersion",
  "templates",
  "name",
  "description",
  "category",
  "language",
  "titlePattern",
  "key",
  "label",
  "type",
  "required",
  "options",
  "rhythm",
  "durationMinutes",
  "fields",
  "series",
  "files",
  "path",
  "mediaType",
  "size",
  "sha256",
  "attrs",
  "marks",
  "text",
  "content",
  "document",
];
const RANK = new Map(KEY_ORDER.map((key, index) => [key, index]));

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value === null || typeof value !== "object") return value;
  const keys = Object.keys(value).sort((a, b) => {
    const rank = (RANK.get(a) ?? KEY_ORDER.length) - (RANK.get(b) ?? KEY_ORDER.length);
    return rank !== 0 ? rank : a < b ? -1 : a > b ? 1 : 0;
  });
  return Object.fromEntries(keys.map((key) => [key, ordered((value as Record<string, unknown>)[key])]));
}

export function serializeManifest(manifest: TemplateManifest): string {
  return `${JSON.stringify(ordered(manifest), null, 2)}\n`;
}

export function exportFileName(name: string, zip: boolean): string {
  const base =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "templates";
  return `${base}${zip ? TEMPLATE_ZIP_SUFFIX : TEMPLATE_JSON_SUFFIX}`;
}
