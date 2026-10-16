import * as Y from "yjs";
import { z } from "zod";

export const MAX_SCENE_BYTES = 8 * 1024 * 1024;
export const MAX_ELEMENT_BYTES = 512 * 1024;
export const MAX_ELEMENTS = 20_000;
export const MAX_FILES = 500;
export const MAX_POINTS = 20_000;
export const MAX_ELEMENT_TEXT = 20_000;
export const MAX_SCENE_PROBLEMS = 20;

export const sceneLimits = {
  maxSceneBytes: MAX_SCENE_BYTES,
  maxElementBytes: MAX_ELEMENT_BYTES,
  maxElements: MAX_ELEMENTS,
  maxFiles: MAX_FILES,
} as const;

export const SCENE_ELEMENTS = "elements";
export const SCENE_FILES = "files";
export const SCENE_SETTINGS = "settings";

export const sceneElementTypes = [
  "rectangle",
  "diamond",
  "ellipse",
  "arrow",
  "line",
  "freedraw",
  "text",
  "image",
  "frame",
] as const;
export type SceneElementType = (typeof sceneElementTypes)[number];

export const sceneImageTypes = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
] as const;

export type SceneProblemCode =
  | "notAnObject"
  | "notSerializable"
  | "tooLarge"
  | "tooManyElements"
  | "tooManyFiles"
  | "elementTooLarge"
  | "unknownElementType"
  | "unknownField"
  | "invalidElement"
  | "duplicateElement"
  | "invalidLink"
  | "invalidFile";

export interface SceneProblem {
  path: string;
  code: SceneProblemCode;
}

export type SceneElement = Record<string, unknown> & {
  id: string;
  type: SceneElementType;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  index: string | null;
};

export interface SceneFile {
  attachmentId: string;
  mimeType: (typeof sceneImageTypes)[number];
}

export interface Scene {
  elements: SceneElement[];
  files: Record<string, SceneFile>;
  settings: { viewBackgroundColor: string | null };
}

export type SceneValidation = { ok: true; scene: Scene } | { ok: false; problems: SceneProblem[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const color = z.string().regex(/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,30}|rgba?\([0-9., %]{1,40}\))$/);
const finite = z.number().finite();
const safeNumber = finite.min(-1e9).max(1e9);
const integer = z
  .number()
  .int()
  .min(-(2 ** 53))
  .max(2 ** 53);
const point = z.tuple([safeNumber, safeNumber]);
const points = z.array(point).max(MAX_POINTS);
const fractionalIndex = z.string().regex(/^[0-9A-Za-z]{1,128}$/);
const text = z.string().max(MAX_ELEMENT_TEXT);

const binding = z
  .object({
    elementId: identifier,
    focus: safeNumber,
    gap: safeNumber,
    fixedPoint: z.tuple([safeNumber, safeNumber]).nullable().optional(),
  })
  .strict();

const baseShape = {
  id: identifier,
  x: safeNumber,
  y: safeNumber,
  width: safeNumber,
  height: safeNumber,
  angle: safeNumber,
  strokeColor: color,
  backgroundColor: color,
  fillStyle: z.enum(["hachure", "cross-hatch", "solid", "zigzag"]),
  strokeWidth: finite.min(0).max(1000),
  strokeStyle: z.enum(["solid", "dashed", "dotted"]),
  roundness: z
    .object({ type: z.number().int().min(1).max(3), value: safeNumber.optional() })
    .strict()
    .nullable(),
  roughness: finite.min(0).max(10),
  opacity: finite.min(0).max(100),
  seed: integer,
  version: z
    .number()
    .int()
    .min(1)
    .max(2 ** 53),
  versionNonce: integer,
  index: fractionalIndex.nullable(),
  isDeleted: z.boolean(),
  groupIds: z.array(identifier).max(100),
  frameId: identifier.nullable(),
  boundElements: z
    .array(z.object({ id: identifier, type: z.enum(["arrow", "text"]) }).strict())
    .max(1000)
    .nullable(),
  updated: finite.min(0),
  link: z.string().max(2048).nullable(),
  locked: z.boolean(),
  customData: z
    .object({ stickyNote: z.literal(true).optional() })
    .strict()
    .optional(),
};

const linearShape = {
  ...baseShape,
  points,
  lastCommittedPoint: point.nullable(),
  startBinding: binding.nullable(),
  endBinding: binding.nullable(),
  startArrowhead: z
    .string()
    .regex(/^[a-z_]{1,32}$/)
    .nullable(),
  endArrowhead: z
    .string()
    .regex(/^[a-z_]{1,32}$/)
    .nullable(),
};

const segment = z
  .object({ start: point, end: point, index: z.number().int().min(0).max(MAX_POINTS) })
  .strict();

const elementSchemas: Record<SceneElementType, z.ZodType> = {
  rectangle: z.object({ ...baseShape, type: z.literal("rectangle") }).strict(),
  diamond: z.object({ ...baseShape, type: z.literal("diamond") }).strict(),
  ellipse: z.object({ ...baseShape, type: z.literal("ellipse") }).strict(),
  line: z.object({ ...linearShape, type: z.literal("line"), polygon: z.boolean().optional() }).strict(),
  arrow: z
    .object({
      ...linearShape,
      type: z.literal("arrow"),
      elbowed: z.boolean(),
      fixedSegments: z.array(segment).max(MAX_POINTS).nullable().optional(),
      startIsSpecial: z.boolean().nullable().optional(),
      endIsSpecial: z.boolean().nullable().optional(),
    })
    .strict(),
  freedraw: z
    .object({
      ...baseShape,
      type: z.literal("freedraw"),
      points,
      pressures: z.array(finite.min(0).max(1)).max(MAX_POINTS),
      simulatePressure: z.boolean().optional(),
      lastCommittedPoint: point.nullable(),
    })
    .strict(),
  text: z
    .object({
      ...baseShape,
      type: z.literal("text"),
      fontSize: finite.min(1).max(10_000),
      fontFamily: z.number().int().min(1).max(100),
      text,
      originalText: text,
      textAlign: z.enum(["left", "center", "right"]),
      verticalAlign: z.enum(["top", "middle", "bottom"]),
      containerId: identifier.nullable(),
      autoResize: z.boolean(),
      lineHeight: finite.min(0.1).max(10),
      baseline: safeNumber.optional(),
    })
    .strict(),
  image: z
    .object({
      ...baseShape,
      type: z.literal("image"),
      fileId: identifier.nullable(),
      status: z.enum(["pending", "saved", "error"]),
      scale: z.tuple([finite.min(-1).max(1), finite.min(-1).max(1)]),
      crop: z
        .object({
          x: safeNumber,
          y: safeNumber,
          width: safeNumber,
          height: safeNumber,
          naturalWidth: safeNumber,
          naturalHeight: safeNumber,
        })
        .strict()
        .nullable()
        .optional(),
    })
    .strict(),
  frame: z.object({ ...baseShape, type: z.literal("frame"), name: z.string().max(255).nullable() }).strict(),
};

const fileSchema = z
  .object({ attachmentId: z.string().regex(UUID), mimeType: z.enum(sceneImageTypes) })
  .strict();

const settingsSchema = z.object({ viewBackgroundColor: color.nullable() }).strict();

export function isValidSceneFile(id: string, value: unknown): value is SceneFile {
  return identifier.safeParse(id).success && fileSchema.safeParse(value).success;
}

export function isValidSceneSettings(value: unknown): boolean {
  return settingsSchema.safeParse(value).success;
}

export function elementBytes(value: unknown): number | null {
  return byteSize(value);
}

const encoder = new TextEncoder();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function byteSize(value: unknown): number | null {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? null : encoder.encode(json).byteLength;
  } catch {
    return null;
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function isAllowedElementLink(link: string): boolean {
  if (link.length === 0 || link.length > 2048) return false;
  if (hasControlCharacter(link) || link.includes("\\") || link.trim() !== link) return false;
  if (link.startsWith("/")) return !link.startsWith("//");
  try {
    const url = new URL(link);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function problemCode(issue: z.core.$ZodIssue): SceneProblemCode {
  return issue.code === "unrecognized_keys" ? "unknownField" : "invalidElement";
}

export function validateElement(value: unknown, path: string, problems: SceneProblem[]): SceneElement | null {
  if (!isPlainObject(value)) {
    problems.push({ path, code: "notAnObject" });
    return null;
  }
  const size = byteSize(value);
  if (size === null) {
    problems.push({ path, code: "notSerializable" });
    return null;
  }
  if (size > MAX_ELEMENT_BYTES) {
    problems.push({ path, code: "elementTooLarge" });
    return null;
  }
  const type = value.type;
  const schema = typeof type === "string" ? elementSchemas[type as SceneElementType] : undefined;
  if (!schema || !Object.hasOwn(elementSchemas, type as string)) {
    problems.push({ path: `${path}.type`, code: "unknownElementType" });
    return null;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 3)) {
      problems.push({ path: [path, ...issue.path.map(String)].join("."), code: problemCode(issue) });
    }
    return null;
  }
  const element = parsed.data as SceneElement;
  if (typeof element.link === "string" && !isAllowedElementLink(element.link)) {
    problems.push({ path: `${path}.link`, code: "invalidLink" });
    return null;
  }
  return element;
}

function compareElements(a: SceneElement, b: SceneElement): number {
  const left = a.index ?? "";
  const right = b.index ?? "";
  if (left !== right) return left < right ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function validateScene(value: unknown): SceneValidation {
  const problems: SceneProblem[] = [];
  if (!isPlainObject(value)) return { ok: false, problems: [{ path: "", code: "notAnObject" }] };
  const size = byteSize(value);
  if (size === null) return { ok: false, problems: [{ path: "", code: "notSerializable" }] };
  if (size > MAX_SCENE_BYTES) return { ok: false, problems: [{ path: "", code: "tooLarge" }] };
  for (const key of Object.keys(value)) {
    if (key !== "elements" && key !== "files" && key !== "settings")
      problems.push({ path: key, code: "unknownField" });
  }
  const rawElements = value.elements ?? [];
  const rawFiles = value.files ?? {};
  if (!Array.isArray(rawElements))
    return { ok: false, problems: [{ path: "elements", code: "notAnObject" }] };
  if (!isPlainObject(rawFiles)) return { ok: false, problems: [{ path: "files", code: "notAnObject" }] };
  if (rawElements.length > MAX_ELEMENTS)
    return { ok: false, problems: [{ path: "elements", code: "tooManyElements" }] };
  if (Object.keys(rawFiles).length > MAX_FILES)
    return { ok: false, problems: [{ path: "files", code: "tooManyFiles" }] };

  const elements: SceneElement[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of rawElements.entries()) {
    const element = validateElement(raw, `elements.${index}`, problems);
    if (!element) {
      if (problems.length >= MAX_SCENE_PROBLEMS) break;
      continue;
    }
    if (seen.has(element.id)) {
      problems.push({ path: `elements.${index}.id`, code: "duplicateElement" });
      continue;
    }
    seen.add(element.id);
    elements.push(element);
  }

  const files: Record<string, SceneFile> = {};
  for (const [id, raw] of Object.entries(rawFiles)) {
    const parsed = fileSchema.safeParse(raw);
    if (!identifier.safeParse(id).success || !parsed.success) {
      problems.push({ path: `files.${id.slice(0, 128)}`, code: "invalidFile" });
      continue;
    }
    files[id] = parsed.data;
  }

  const settings = settingsSchema.safeParse(value.settings ?? { viewBackgroundColor: null });
  if (!settings.success) problems.push({ path: "settings", code: "invalidElement" });

  if (problems.length > 0) return { ok: false, problems: problems.slice(0, MAX_SCENE_PROBLEMS) };
  return {
    ok: true,
    scene: {
      elements: elements.sort(compareElements),
      files,
      settings: settings.success ? settings.data : { viewBackgroundColor: null },
    },
  };
}

export function visibleScene(scene: Scene): Scene {
  const elements = scene.elements.filter((element) => !element.isDeleted);
  const used = new Set(
    elements.flatMap((element) =>
      element.type === "image" && typeof element.fileId === "string" ? [element.fileId] : [],
    ),
  );
  const files = Object.fromEntries(Object.entries(scene.files).filter(([id]) => used.has(id)));
  return { elements, files, settings: scene.settings };
}

export function emptyScene(): Scene {
  return { elements: [], files: {}, settings: { viewBackgroundColor: null } };
}

export function elementText(element: SceneElement): string {
  if (element.isDeleted) return "";
  if (element.type === "text") return String(element.originalText || element.text || "").trim();
  if (element.type === "frame" && typeof element.name === "string") return element.name.trim();
  return "";
}

export function sceneText(scene: Scene): string {
  return scene.elements
    .map(elementText)
    .filter((part) => part.length > 0)
    .join("\n");
}

export function boundText(scene: Scene, element: SceneElement): string {
  const own = elementText(element);
  if (own) return own;
  const bound = scene.elements.find(
    (candidate) => candidate.type === "text" && candidate.containerId === element.id && !candidate.isDeleted,
  );
  return bound ? elementText(bound) : "";
}

export function isStickyNote(element: SceneElement): boolean {
  const data = element.customData as { stickyNote?: boolean } | undefined;
  return element.type === "rectangle" && data?.stickyNote === true;
}

export function sceneFromYDoc(doc: Y.Doc): unknown {
  const elements = [...doc.getMap<unknown>(SCENE_ELEMENTS).values()];
  const files = Object.fromEntries(doc.getMap<unknown>(SCENE_FILES).entries());
  const settings = doc.getMap<unknown>(SCENE_SETTINGS);
  return {
    elements,
    files,
    settings: { viewBackgroundColor: settings.get("viewBackgroundColor") ?? null },
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function randomNonce(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export function applyScene(doc: Y.Doc, scene: Scene, origin?: unknown): void {
  const elements = doc.getMap<unknown>(SCENE_ELEMENTS);
  const files = doc.getMap<unknown>(SCENE_FILES);
  const settings = doc.getMap<unknown>(SCENE_SETTINGS);
  const now = Date.now();
  doc.transact(() => {
    const wanted = new Map(scene.elements.map((element) => [element.id, element]));
    for (const [id, raw] of elements.entries()) {
      if (wanted.has(id) || !isPlainObject(raw) || raw.isDeleted === true) continue;
      const version = typeof raw.version === "number" ? raw.version : 0;
      elements.set(id, {
        ...raw,
        isDeleted: true,
        version: version + 1,
        versionNonce: randomNonce(),
        updated: now,
      });
    }
    for (const element of scene.elements) {
      const current = elements.get(element.id);
      const currentVersion =
        isPlainObject(current) && typeof current.version === "number" ? current.version : 0;
      if (isPlainObject(current) && sameValue({ ...current }, element)) continue;
      elements.set(element.id, {
        ...element,
        version: Math.max(currentVersion, element.version) + 1,
        versionNonce: randomNonce(),
        updated: now,
      });
    }
    for (const [id, file] of Object.entries(scene.files)) {
      if (!sameValue(files.get(id), file)) files.set(id, file);
    }
    if (settings.get("viewBackgroundColor") !== scene.settings.viewBackgroundColor) {
      settings.set("viewBackgroundColor", scene.settings.viewBackgroundColor);
    }
  }, origin);
}

export function yDocFromScene(scene: Scene): Y.Doc {
  const doc = new Y.Doc();
  const elements = doc.getMap<unknown>(SCENE_ELEMENTS);
  const files = doc.getMap<unknown>(SCENE_FILES);
  doc.transact(() => {
    for (const element of scene.elements) elements.set(element.id, element);
    for (const [id, file] of Object.entries(scene.files)) files.set(id, file);
    doc.getMap<unknown>(SCENE_SETTINGS).set("viewBackgroundColor", scene.settings.viewBackgroundColor);
  });
  return doc;
}

export function pruneDeletedElements(doc: Y.Doc, olderThan: number, origin?: unknown): number {
  const elements = doc.getMap<unknown>(SCENE_ELEMENTS);
  const stale = [...elements.entries()].filter(
    ([, raw]) =>
      isPlainObject(raw) &&
      raw.isDeleted === true &&
      typeof raw.updated === "number" &&
      raw.updated < olderThan,
  );
  if (stale.length === 0) return 0;
  doc.transact(() => {
    for (const [id] of stale) elements.delete(id);
  }, origin);
  return stale.length;
}

export function hasOnlySceneTypes(doc: Y.Doc): boolean {
  for (const name of doc.share.keys()) {
    if (name !== SCENE_ELEMENTS && name !== SCENE_FILES && name !== SCENE_SETTINGS) return false;
  }
  return true;
}
