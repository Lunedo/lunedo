import type { Readable } from "node:stream";
import {
  type CopiedAttachment,
  type DocumentJson,
  documentAttachments,
  editorSchemaVersion,
  type FileRole,
  MigrationError,
  migrateDocument,
  type NodeJson,
  type PortableRemovals,
  portableTemplateDocument,
  resolveEmbed,
  validateDocument,
} from "@pagehall/editor-schema";
import { type Scene, validateScene, visibleScene } from "@pagehall/editor-schema/scene";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Database, Transaction } from "../database/database.js";
import { sanitizeDrawio } from "../diagrams/drawio.js";
import { readUpload, sanitizerSlots } from "../diagrams/markup.js";
import type { EmbedServices } from "../embeds/embeds.js";
import type { AttachmentContent } from "../files/attachments.js";
import { previewOf } from "../files/attachments.js";
import { FileTooLargeError, type StoredFile } from "../files/files.js";
import { cleanFileName } from "../files/names.js";
import { detectType, SNIFF_BYTES } from "../files/sniff.js";
import { actorIdOf, auditScopeOf, SpaceError } from "../spaces/common.js";
import type { StorageService } from "../storage/storage.js";
import { sanitizeDiagramSvg, sanitizeSvg } from "../whiteboards/svg.js";
import { isZip, readTemplateArchive, writeTemplateArchive } from "./archive.js";
import type { SeriesDefaults, TemplateLanguage } from "./builtin/types.js";
import type { TemplateField } from "./fields.js";
import type { TemplateFileService } from "./files.js";
import {
  blockReference,
  exportFileName,
  FILE_PATH,
  fileReference,
  IMAGE_MEDIA_TYPES,
  MAX_TEMPLATES_PER_UPLOAD,
  serializeManifest,
  sha256,
  TEMPLATE_ENTRY_MAX_BYTES,
  TEMPLATE_FORMAT,
  TEMPLATE_FORMAT_VERSION,
  TEMPLATE_UPLOAD_MAX_BYTES,
  type TemplateEntry,
  type TemplateFileEntry,
  TemplateFileError,
  type TemplateFileType,
  type TemplateManifest,
  templateEntrySchema,
  templateFileTypes,
} from "./format.js";
import type { TemplateCategory } from "./schema.js";
import {
  cleanTemplate,
  type PageTemplate,
  TEMPLATE_NAME_MAX_LENGTH,
  type TemplateScope,
  type TemplateService,
} from "./templates.js";

const IMPORT_HOURS = 12;
const MAX_PROBLEMS = 20;
const SCENE_TYPE = "application/vnd.excalidraw+json";
const DRAWIO_TYPE = "application/vnd.jgraph.mxfile";
const MB = (bytes: number) => `${bytes / (1024 * 1024)} MB`;

const IMPORTED_SUFFIX: Record<TemplateLanguage, string> = { en: " (imported)", de: " (importiert)" };

export type ExportSource = { scope: TemplateScope } | { builtIn: TemplateLanguage };

export interface ExportedTemplate {
  name: string;
  files: number;
  removed: PortableRemovals;
}

export interface TemplateExport {
  fileName: string;
  contentType: string;
  templates: ExportedTemplate[];
  body: Buffer;
}

export interface ImportProblem {
  place: string | null;
  message: string;
}

export interface ImportedFile {
  id: string;
  name: string;
  mediaType: string;
  size: number;
}

export interface ImportedTemplate {
  index: number;
  name: string;
  description: string;
  category: TemplateCategory | null;
  language: TemplateLanguage | null;
  title: string;
  fields: TemplateField[];
  series: SeriesDefaults | null;
  document: DocumentJson | null;
  files: ImportedFile[];
  removed: PortableRemovals;
  blockedEmbeds: string[];
  problems: ImportProblem[];
  valid: boolean;
  conflict: { templateId: string; suggestedName: string } | null;
}

export interface TemplateImportPreview {
  id: string;
  fileName: string;
  templates: ImportedTemplate[];
  expiresAt: Date;
}

export interface ImportDecision {
  index: number;
  action: "create" | "replace" | "skip";
  name?: string | undefined;
}

export interface TemplateImportResult {
  created: PageTemplate[];
  replaced: PageTemplate[];
  skipped: number;
}

interface StagedFile extends ImportedFile {
  storedId: string;
}

interface StagedTemplate extends Omit<ImportedTemplate, "files"> {
  files: StagedFile[];
}

interface PreparedFile {
  bytes: Buffer;
  mediaType: TemplateFileType;
  name: string;
}

interface ImportRow {
  [key: string]: unknown;
  id: string;
  account_id: string;
  level: TemplateScope["level"];
  organization_id: string | null;
  space_id: string | null;
  file_name: string;
  templates: StagedTemplate[];
  created_at: Date | string;
}

function placeOf(path: readonly PropertyKey[]): string | null {
  const [first, second, ...rest] = path;
  if (first === undefined) return null;
  const detail = rest.length > 0 ? ` (${rest.map(String).join(".")})` : "";
  if (first === "fields" && typeof second === "number") return `field ${second + 1}${detail}`;
  if (first === "files" && typeof second === "number") return `file ${second + 1}${detail}`;
  if (first === "document") return "content";
  return [first, second, ...rest]
    .filter((part) => part !== undefined)
    .map(String)
    .join(".");
}

function problem(label: string, place: string | null, message: string): ImportProblem {
  return { place, message: `Template '${label}'${place ? `, ${place}` : ""}: ${message}` };
}

function walk(node: NodeJson, visit: (node: NodeJson) => void): void {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

function embedUrls(document: DocumentJson): string[] {
  const urls: string[] = [];
  walk(document, (node) => {
    if (node.type === "embed" && typeof node.attrs?.url === "string") urls.push(node.attrs.url);
  });
  return urls;
}

function addRemovals(total: Record<string, number>, removed: PortableRemovals): void {
  for (const [kind, count] of Object.entries(removed)) total[kind] = (total[kind] ?? 0) + (count ?? 0);
}

function sceneBytes(scene: Scene): Buffer {
  return Buffer.from(JSON.stringify(scene), "utf8");
}

function roleAccepts(role: FileRole, mediaType: string): boolean {
  switch (role) {
    case "image":
    case "file":
      return IMAGE_MEDIA_TYPES.has(mediaType);
    case "drawingPreview":
    case "diagramPreview":
      return mediaType === "image/svg+xml";
    case "drawingScene":
      return mediaType === SCENE_TYPE;
    case "diagramSource":
      return mediaType === DRAWIO_TYPE;
  }
}

function scopeColumns(scope: TemplateScope) {
  return {
    organizationId: scope.level === "organization" ? scope.organizationId : null,
    spaceId: scope.level === "space" ? scope.spaceId : null,
  };
}

export class TemplateTransferService {
  readonly #database: Database;
  readonly #templates: TemplateService;
  readonly #files: TemplateFileService;
  readonly #storage: StorageService;
  readonly #embeds: EmbedServices;
  readonly #audit: AuditLog;
  readonly #instanceUrl: () => Promise<string | null>;

  constructor(options: {
    database: Database;
    templates: TemplateService;
    storage: StorageService;
    embeds: EmbedServices;
    audit: AuditLog;
    instanceUrl: () => Promise<string | null>;
  }) {
    this.#instanceUrl = options.instanceUrl;
    this.#database = options.database;
    this.#templates = options.templates;
    this.#files = options.templates.files;
    this.#storage = options.storage;
    this.#embeds = options.embeds;
    this.#audit = options.audit;
  }

  async #organizationOf(scope: TemplateScope): Promise<string | null> {
    if (scope.level === "organization") return scope.organizationId;
    if (scope.level === "instance") return null;
    const result = await this.#database.execute<{ organization_id: string | null }>(
      sql`select organization_id from spaces where id = ${scope.spaceId}`,
    );
    return result.rows[0]?.organization_id ?? null;
  }

  async #source(source: ExportSource, templateIds: readonly string[] | null): Promise<PageTemplate[]> {
    const all =
      "builtIn" in source
        ? this.#templates.builtIn(source.builtIn)
        : await this.#templates.list(source.scope);
    if (templateIds === null) return all;
    const wanted = new Set(templateIds);
    const chosen = all.filter((template) => wanted.has(template.id));
    if (chosen.length !== wanted.size)
      throw new SpaceError("templateNotFound", "A chosen template does not exist");
    return chosen;
  }

  async #exportOne(
    template: PageTemplate,
    language: TemplateLanguage | null,
    isInternalHref: (href: string) => boolean,
    output: Map<string, Buffer>,
  ): Promise<{ entry: TemplateEntry; summary: ExportedTemplate }> {
    const own = new Map(
      (template.level === "builtIn" ? [] : await this.#files.list(template.id)).map((file) => [
        file.id,
        file,
      ]),
    );
    const contents = new Map<string, Buffer>();
    for (const reference of documentAttachments(template.document)) {
      const file = own.get(reference.id);
      if (!file || contents.has(file.id) || file.size > TEMPLATE_ENTRY_MAX_BYTES) continue;
      const content = await this.#files.content(template.id, file.id);
      if (content)
        contents.set(file.id, await this.#files.files.readAll(content.fileId, TEMPLATE_ENTRY_MAX_BYTES));
    }
    const files = new Map<string, TemplateFileEntry>();
    let block = 0;
    let droppedSceneFiles = 0;
    const prepared = (reference: CopiedAttachment, role: FileRole): PreparedFile | null => {
      const file = own.get(reference.id);
      const bytes = contents.get(reference.id);
      if (!file || !bytes) return null;
      if (role === "drawingScene") {
        const validated = validateScene(JSON.parse(bytes.toString("utf8")) as unknown);
        if (!validated.ok) return null;
        const scene = visibleScene(validated.scene);
        droppedSceneFiles += Object.keys(scene.files).length;
        return { bytes: sceneBytes({ ...scene, files: {} }), mediaType: SCENE_TYPE, name: file.name };
      }
      if (role === "diagramSource") return { bytes, mediaType: DRAWIO_TYPE, name: file.name };
      const mediaType = file.contentType.split(";")[0]?.trim() ?? "";
      if (!roleAccepts(role, mediaType)) return null;
      return { bytes, mediaType: mediaType as TemplateFileType, name: file.name };
    };
    const { document, removed } = portableTemplateDocument(template.document, {
      file: (reference, role) => {
        const file = prepared(reference, role);
        if (!file) return null;
        const hash = sha256(file.bytes);
        const path = `files/${hash}.${templateFileTypes[file.mediaType]}`;
        const ref = fileReference(hash);
        files.set(path, {
          path,
          mediaType: file.mediaType,
          size: file.bytes.length,
          sha256: hash,
          name: (
            cleanFileName(file.name.replace(/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, ref)) ?? "file"
          ).slice(0, 255),
        });
        output.set(path, file.bytes);
        return { id: ref, version: reference.version === null ? null : 1 };
      },
      isInternalHref,
      isBuiltInTemplate: (id) => id.startsWith("builtin:"),
      localId: () => blockReference(++block),
    });
    if (droppedSceneFiles > 0) removed.file = (removed.file ?? 0) + droppedSceneFiles;
    const entry: TemplateEntry = {
      name: template.name,
      description: template.description,
      category: template.category,
      language,
      titlePattern: template.title,
      fields: template.fields,
      series: template.series,
      files: [...files.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      document: document as TemplateEntry["document"],
    };
    return { entry, summary: { name: template.name, files: files.size, removed } };
  }

  async #isInternalHref(): Promise<(href: string) => boolean> {
    const address = await this.#instanceUrl();
    const origin = address ? new URL(address).origin : null;
    return (href) => {
      if (href.startsWith("/")) return true;
      if (!origin) return false;
      try {
        return new URL(href).origin === origin;
      } catch {
        return false;
      }
    };
  }

  async exportTemplates(
    actor: Principal,
    source: ExportSource,
    templateIds: readonly string[] | null,
    pagehallVersion: string,
  ): Promise<TemplateExport> {
    const templates = await this.#source(source, templateIds);
    if (templates.length === 0) {
      throw new SpaceError("noTemplates", "There are no templates to export here. Create a template first.");
    }
    if (templates.length > MAX_TEMPLATES_PER_UPLOAD) {
      throw new SpaceError(
        "tooManyTemplates",
        `A template file holds at most ${MAX_TEMPLATES_PER_UPLOAD} templates. Choose fewer templates.`,
      );
    }
    for (const template of templates) {
      if (template.level !== "builtIn") await this.#templates.ensureFiles(template.id);
    }
    const fresh =
      "builtIn" in source
        ? templates
        : await this.#source(
            source,
            templates.map((item) => item.id),
          );
    const isInternalHref = await this.#isInternalHref();
    const output = new Map<string, Buffer>();
    const exported: { entry: TemplateEntry; summary: ExportedTemplate }[] = [];
    for (const template of fresh) {
      exported.push(
        await this.#exportOne(template, "builtIn" in source ? source.builtIn : null, isInternalHref, output),
      );
    }
    const manifest: TemplateManifest = {
      format: TEMPLATE_FORMAT,
      formatVersion: TEMPLATE_FORMAT_VERSION,
      schemaVersion: editorSchemaVersion,
      pagehallVersion: pagehallVersion.slice(0, 100) || "dev",
      templates: exported.map((item) => item.entry),
    };
    const json = serializeManifest(manifest);
    const zip = output.size > 0;
    const body = zip ? await writeTemplateArchive(json, output) : Buffer.from(json, "utf8");
    if (body.length > TEMPLATE_UPLOAD_MAX_BYTES) {
      throw new SpaceError(
        "templateExportTooLarge",
        `The export would be larger than ${MB(TEMPLATE_UPLOAD_MAX_BYTES)}, the limit for importing it again. Export fewer templates at a time.`,
      );
    }
    const name = fresh.length === 1 ? (fresh[0]?.name ?? "template") : "templates";
    const scope = "scope" in source ? source.scope : ({ level: "instance" } as const);
    const organizationId = await this.#organizationOf(scope);
    const removed: Record<string, number> = {};
    for (const item of exported) addRemovals(removed, item.summary.removed);
    await this.#database.transaction(async (tx) => {
      await this.#audit.record(tx, {
        name: "template.exported",
        actor,
        targetId: null,
        fields: {
          level: scope.level,
          organizationId,
          spaceId: scope.level === "space" ? scope.spaceId : null,
          templates: fresh.length,
          builtIn: "builtIn" in source,
          removed,
        },
        scope: auditScopeOf({ organizationId }),
      });
    });
    return {
      fileName: exportFileName(name, zip),
      contentType: zip ? "application/zip" : "application/json",
      templates: exported.map((item) => item.summary),
      body,
    };
  }

  async exportSummary(
    source: ExportSource,
    templateIds: readonly string[] | null,
  ): Promise<ExportedTemplate[]> {
    const templates = await this.#source(source, templateIds);
    const isInternalHref = await this.#isInternalHref();
    const summaries: ExportedTemplate[] = [];
    for (const template of templates) {
      if (template.level !== "builtIn") await this.#templates.ensureFiles(template.id);
    }
    const fresh =
      "builtIn" in source
        ? templates
        : await this.#source(
            source,
            templates.map((item) => item.id),
          );
    for (const template of fresh) {
      summaries.push((await this.#exportOne(template, null, isInternalHref, new Map())).summary);
    }
    return summaries;
  }

  #parseManifest(bytes: Buffer): { schemaVersion: number; templates: unknown[] } {
    let raw: unknown;
    try {
      raw = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      throw new TemplateFileError(
        "invalidTemplateFile",
        "The file is neither a Pagehall template file in JSON nor a ZIP archive with template.json.",
      );
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new TemplateFileError("invalidTemplateFile", "template.json must contain a JSON object.");
    }
    const manifest = raw as Record<string, unknown>;
    if (manifest.format !== TEMPLATE_FORMAT) {
      throw new TemplateFileError(
        "invalidTemplateFile",
        `The file is not a Pagehall template file: "format" must be "${TEMPLATE_FORMAT}".`,
      );
    }
    const formatVersion = manifest.formatVersion;
    if (typeof formatVersion === "number" && formatVersion > TEMPLATE_FORMAT_VERSION) {
      throw new TemplateFileError(
        "newerTemplateFormat",
        `The file uses template format version ${formatVersion}; this Pagehall reads version ${TEMPLATE_FORMAT_VERSION}. Update Pagehall to import it.`,
        { fileVersion: formatVersion, supportedVersion: TEMPLATE_FORMAT_VERSION },
      );
    }
    const schemaVersion = manifest.schemaVersion;
    if (typeof schemaVersion === "number" && schemaVersion > editorSchemaVersion) {
      throw new TemplateFileError(
        "newerTemplateFormat",
        `The content uses editor schema version ${schemaVersion}; this Pagehall supports up to version ${editorSchemaVersion}. Update Pagehall to import it.`,
        { fileVersion: schemaVersion, supportedVersion: editorSchemaVersion },
      );
    }
    const unknown = Object.keys(manifest).filter(
      (key) => !["format", "formatVersion", "schemaVersion", "pagehallVersion", "templates"].includes(key),
    );
    if (unknown.length > 0) {
      throw new TemplateFileError(
        "invalidTemplateFile",
        `template.json has unknown keys: ${unknown.join(", ")}.`,
      );
    }
    if (formatVersion !== TEMPLATE_FORMAT_VERSION) {
      throw new TemplateFileError(
        "invalidTemplateFile",
        `"formatVersion" must be ${TEMPLATE_FORMAT_VERSION}.`,
      );
    }
    if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
      throw new TemplateFileError(
        "invalidTemplateFile",
        `"schemaVersion" must be a whole number of at least 1.`,
      );
    }
    const version = manifest.pagehallVersion;
    if (typeof version !== "string" || version.length === 0 || version.length > 100) {
      throw new TemplateFileError(
        "invalidTemplateFile",
        `"pagehallVersion" must be a text of 1 to 100 characters.`,
      );
    }
    const templates = manifest.templates;
    if (!Array.isArray(templates) || templates.length === 0) {
      throw new TemplateFileError("invalidTemplateFile", "The file contains no templates.");
    }
    if (templates.length > MAX_TEMPLATES_PER_UPLOAD) {
      throw new TemplateFileError(
        "tooManyTemplates",
        `The file contains ${templates.length} templates; at most ${MAX_TEMPLATES_PER_UPLOAD} can be imported at once.`,
      );
    }
    return { schemaVersion, templates };
  }

  #prepareFile(
    entry: TemplateFileEntry,
    bytes: Buffer,
    role: FileRole,
    references: ReadonlySet<string>,
  ): { bytes: Buffer; droppedSceneFiles: number } {
    if (!roleAccepts(role, entry.mediaType)) {
      throw new Error(`is a ${entry.mediaType} file but the content uses it as ${role}`);
    }
    if (entry.mediaType === "image/svg+xml") {
      const text = bytes.toString("utf8");
      const svg =
        role === "diagramPreview"
          ? sanitizeDiagramSvg(text, TEMPLATE_ENTRY_MAX_BYTES).svg
          : sanitizeSvg(text);
      return { bytes: Buffer.from(svg, "utf8"), droppedSceneFiles: 0 };
    }
    if (entry.mediaType === SCENE_TYPE) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(bytes.toString("utf8")) as unknown;
      } catch {
        throw new Error("is not a valid drawing");
      }
      const validated = validateScene(parsed);
      if (!validated.ok) throw new Error("is not a valid drawing");
      const scene = visibleScene(validated.scene);
      const kept = Object.entries(scene.files).filter(([, file]) => references.has(file.attachmentId));
      return {
        bytes: sceneBytes({ ...scene, files: Object.fromEntries(kept) }),
        droppedSceneFiles: Object.keys(scene.files).length - kept.length,
      };
    }
    if (entry.mediaType === DRAWIO_TYPE) {
      return { bytes: Buffer.from(sanitizeDrawio(bytes.toString("utf8")).xml, "utf8"), droppedSceneFiles: 0 };
    }
    return { bytes, droppedSceneFiles: 0 };
  }

  #checkFile(entry: TemplateFileEntry, bytes: Buffer | undefined): string | null {
    const match = FILE_PATH.exec(entry.path);
    if (!match || match[1] !== entry.sha256) return "its path must be files/ followed by its SHA-256 hash";
    if (match[2] !== templateFileTypes[entry.mediaType])
      return `its extension does not match ${entry.mediaType}`;
    if (!bytes) return "is missing from the archive";
    if (bytes.length !== entry.size) return `has ${bytes.length} bytes, not ${entry.size} as stated`;
    if (sha256(bytes) !== entry.sha256) return "does not match its SHA-256 hash";
    if (IMAGE_MEDIA_TYPES.has(entry.mediaType)) {
      const head = bytes.subarray(0, SNIFF_BYTES);
      const detected = detectType(head, {
        name: entry.path,
        truncated: bytes.length > head.length,
      }).contentType;
      if (detected !== entry.mediaType)
        return `is declared as ${entry.mediaType} but its content is ${detected}`;
    }
    return null;
  }

  #checkTemplate(
    raw: unknown,
    index: number,
    schemaVersion: number,
    archive: ReadonlyMap<string, Buffer>,
    context: {
      isInternalHref: (href: string) => boolean;
      embedAllowed: (url: string) => boolean;
      existing: Map<string, string>;
      language: TemplateLanguage;
    },
  ): { template: ImportedTemplate; prepared: Map<string, PreparedFile> } {
    const named = raw && typeof raw === "object" ? (raw as Record<string, unknown>).name : undefined;
    const label = typeof named === "string" && named.trim() ? named.trim().slice(0, 100) : `#${index + 1}`;
    const problems: ImportProblem[] = [];
    const prepared = new Map<string, PreparedFile>();
    const empty: ImportedTemplate = {
      index,
      name: label,
      description: "",
      category: null,
      language: null,
      title: "",
      fields: [],
      series: null,
      document: null,
      files: [],
      removed: {},
      blockedEmbeds: [],
      problems,
      valid: false,
      conflict: null,
    };
    const parsed = templateEntrySchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues.slice(0, MAX_PROBLEMS)) {
        const message =
          issue.code === "unrecognized_keys" ? `unknown key ${issue.keys.join(", ")}` : issue.message;
        problems.push(problem(label, placeOf(issue.path), message));
      }
      return { template: empty, prepared };
    }
    const entry = parsed.data;
    const byReference = new Map<string, { entry: TemplateFileEntry; position: number }>();
    entry.files.forEach((file, position) => {
      const failure = this.#checkFile(file, archive.get(file.path));
      if (failure) problems.push(problem(label, `file ${position + 1}`, `${file.path} ${failure}`));
      else byReference.set(fileReference(file.sha256), { entry: file, position });
    });
    let document: DocumentJson;
    try {
      document = migrateDocument(entry.document as DocumentJson, schemaVersion);
    } catch (error) {
      problems.push(
        problem(label, "content", error instanceof MigrationError ? error.message : "cannot be read"),
      );
      return { template: { ...empty, problems }, prepared };
    }
    const validation = validateDocument(document);
    if (!validation.ok) {
      for (const item of validation.problems.slice(0, MAX_PROBLEMS)) {
        problems.push(problem(label, `content at ${item.path || "the top"}`, item.message));
      }
      return { template: { ...empty, problems }, prepared };
    }
    const ids = new Map<string, string>();
    const references = new Set(byReference.keys());
    let droppedSceneFiles = 0;
    const portable = portableTemplateDocument(validation.document, {
      file: (reference, role) => {
        const found = byReference.get(reference.id);
        const bytes = found ? archive.get(found.entry.path) : undefined;
        if (!found || !bytes) return null;
        const key = `${reference.id}:${role === "diagramPreview" ? "diagram" : "plain"}`;
        let id = ids.get(key);
        if (!id) {
          try {
            const result = this.#prepareFile(found.entry, bytes, role, references);
            droppedSceneFiles += result.droppedSceneFiles;
            id = uuidv7();
            ids.set(key, id);
            prepared.set(id, {
              bytes: result.bytes,
              mediaType: found.entry.mediaType,
              name: cleanFileName(found.entry.name) ?? `file.${templateFileTypes[found.entry.mediaType]}`,
            });
          } catch (error) {
            problems.push(
              problem(
                label,
                `file ${found.position + 1}`,
                `${found.entry.path} ${error instanceof Error ? error.message : "cannot be used"}`,
              ),
            );
            return null;
          }
        }
        return { id, version: reference.version === null ? null : 1 };
      },
      isInternalHref: context.isInternalHref,
      isBuiltInTemplate: (id) => id.startsWith("builtin:"),
      localId: () => uuidv7(),
    });
    for (const [id, file] of prepared) {
      if (file.mediaType !== SCENE_TYPE) continue;
      const scene = JSON.parse(file.bytes.toString("utf8")) as Scene;
      const files = Object.fromEntries(
        Object.entries(scene.files).flatMap(([key, value]) => {
          const mapped = ids.get(`${value.attachmentId}:plain`);
          return mapped ? [[key, { ...value, attachmentId: mapped }]] : [];
        }),
      );
      prepared.set(id, { ...file, bytes: sceneBytes({ ...scene, files }) });
    }
    if (droppedSceneFiles > 0) portable.removed.file = (portable.removed.file ?? 0) + droppedSceneFiles;
    const revalidated = validateDocument(portable.document);
    if (!revalidated.ok) {
      problems.push(problem(label, "content", revalidated.problems[0]?.message ?? "is not valid"));
    }
    let clean: ReturnType<typeof cleanTemplate> | null = null;
    try {
      clean = cleanTemplate({
        name: entry.name,
        description: entry.description,
        category: entry.category,
        title: entry.titlePattern,
        fields: entry.fields,
        document: portable.document,
        series: entry.series,
      });
    } catch (error) {
      problems.push(problem(label, null, error instanceof Error ? error.message : "is not valid"));
    }
    const conflictId = context.existing.get(entry.name.replace(/\s+/g, " ").trim().toLowerCase());
    const suffix = IMPORTED_SUFFIX[context.language];
    const template: ImportedTemplate = {
      index,
      name: clean?.name ?? label,
      description: clean?.description ?? entry.description,
      category: entry.category,
      language: entry.language,
      title: clean?.title ?? entry.titlePattern,
      fields: clean?.fields ?? entry.fields,
      series: clean?.series ?? null,
      document: clean?.document ?? portable.document,
      files: [...prepared].map(([id, file]) => ({
        id,
        name: file.name,
        mediaType: file.mediaType,
        size: file.bytes.length,
      })),
      removed: portable.removed,
      blockedEmbeds: [...new Set(embedUrls(portable.document).filter((url) => !context.embedAllowed(url)))],
      problems,
      valid: problems.length === 0 && clean !== null,
      conflict: conflictId
        ? {
            templateId: conflictId,
            suggestedName: `${(clean?.name ?? entry.name).slice(0, TEMPLATE_NAME_MAX_LENGTH - suffix.length)}${suffix}`,
          }
        : null,
    };
    return { template, prepared };
  }

  async #existingNames(scope: TemplateScope): Promise<Map<string, string>> {
    const templates = await this.#templates.list(scope);
    return new Map(templates.map((template) => [template.name.toLowerCase(), template.id]));
  }

  async preview(
    actor: Principal,
    scope: TemplateScope,
    input: { fileName: string; body: Readable; contentLength?: number | undefined },
  ): Promise<TemplateImportPreview> {
    const accountId = actorIdOf(actor);
    if (!accountId) {
      input.body.resume();
      throw new SpaceError("invalidActor", "Only people can import templates");
    }
    if (input.contentLength !== undefined && input.contentLength > TEMPLATE_UPLOAD_MAX_BYTES) {
      input.body.resume();
      throw new FileTooLargeError(TEMPLATE_UPLOAD_MAX_BYTES);
    }
    try {
      await this.#storage.requireUpload();
    } catch (error) {
      input.body.resume();
      throw error;
    }
    const bytes = await readUpload(input.body, TEMPLATE_UPLOAD_MAX_BYTES);
    const archive = isZip(bytes) ? await readTemplateArchive(bytes) : { manifest: bytes, files: new Map() };
    const manifest = this.#parseManifest(archive.manifest);
    const organizationId = await this.#organizationOf(scope);
    const services = organizationId
      ? await this.#embeds.organization(organizationId)
      : await this.#embeds.instance();
    const context = {
      isInternalHref: await this.#isInternalHref(),
      embedAllowed: (url: string) => resolveEmbed(url, services) !== null,
      existing: await this.#existingNames(scope),
      language: await this.#templates.language(actor),
    };
    const seen = new Set<string>();
    const checked = await sanitizerSlots.run(actor, () =>
      manifest.templates.map((raw, index) => {
        const result = this.#checkTemplate(raw, index, manifest.schemaVersion, archive.files, context);
        const key = result.template.name.toLowerCase();
        if (result.template.valid && seen.has(key)) {
          result.template.problems.push(
            problem(result.template.name, null, "another template in the file has the same name"),
          );
          result.template.valid = false;
        }
        seen.add(key);
        return result;
      }),
    );
    const stored: StoredFile[] = [];
    const staged: StagedTemplate[] = [];
    try {
      const byContent = new Map<string, StoredFile>();
      for (const { template, prepared } of checked) {
        const files: StagedFile[] = [];
        if (template.valid) {
          for (const file of template.files) {
            const content = prepared.get(file.id);
            if (!content) continue;
            const hash = sha256(content.bytes);
            let saved = byContent.get(hash);
            if (!saved) {
              saved = await this.#files.store(content.bytes, file.name, TEMPLATE_ENTRY_MAX_BYTES);
              stored.push(saved);
              byContent.set(hash, saved);
            }
            files.push({ ...file, storedId: saved.id });
          }
        }
        staged.push({ ...template, files });
      }
      const id = uuidv7();
      const columns = scopeColumns(scope);
      const fileName = (cleanFileName(input.fileName) ?? "templates").slice(0, 255);
      await this.#database.transaction(async (tx) => {
        await this.#discardExpired(tx);
        await tx.execute(sql`
          insert into template_imports (id, account_id, level, organization_id, space_id, file_name, templates, files)
          values (${id}, ${accountId}, ${scope.level}, ${columns.organizationId}, ${columns.spaceId}, ${fileName},
            ${JSON.stringify(staged)}::jsonb, ${JSON.stringify(stored.map((file) => file.id))}::jsonb)`);
      });
      return {
        id,
        fileName,
        templates: staged.map(({ files, ...template }) => ({
          ...template,
          files: files.map(({ storedId: _storedId, ...file }) => file),
        })),
        expiresAt: new Date(Date.now() + IMPORT_HOURS * 60 * 60 * 1000),
      };
    } catch (error) {
      for (const file of stored) await this.#files.release(file);
      throw error;
    }
  }

  async #discardExpired(tx: Transaction): Promise<void> {
    const expired = await tx.execute<{ files: string[] }>(sql`
      delete from template_imports where created_at < now() - make_interval(hours => ${IMPORT_HOURS})
      returning files`);
    const ids = expired.rows.flatMap((row) => row.files);
    if (ids.length === 0) return;
    await tx.execute(sql`
      update stored_files set state = 'orphaned', updated_at = now()
      where id = any(${sql.param(ids)}::uuid[]) and state = 'stored'`);
  }

  async cleanup(): Promise<void> {
    await this.#database.transaction((tx) => this.#discardExpired(tx));
  }

  async #row(executor: Transaction | Database, actor: Principal, scope: TemplateScope, importId: string) {
    const columns = scopeColumns(scope);
    const result = await executor.execute<ImportRow>(sql`
      select id, account_id, level, organization_id, space_id, file_name, templates, created_at
      from template_imports
      where id = ${importId} and account_id = ${actorIdOf(actor)} and level = ${scope.level}
        and organization_id is not distinct from ${columns.organizationId}
        and space_id is not distinct from ${columns.spaceId}
        and created_at >= now() - make_interval(hours => ${IMPORT_HOURS})
      ${executor === this.#database ? sql`` : sql`for update`}`);
    const row = result.rows[0];
    if (!row) {
      throw new SpaceError(
        "templateImportNotFound",
        "The import preview no longer exists; previews are kept for 12 hours. Upload the file again.",
      );
    }
    return row;
  }

  async fileContent(
    actor: Principal,
    scope: TemplateScope,
    importId: string,
    fileId: string,
  ): Promise<AttachmentContent | null> {
    const row = await this.#row(this.#database, actor, scope, importId);
    for (const template of row.templates) {
      const file = template.files.find((candidate) => candidate.id === fileId);
      if (file) {
        return {
          attachmentId: file.id,
          fileId: file.storedId,
          name: file.name,
          size: file.size,
          contentType: file.mediaType,
          ...previewOf(file.mediaType, file.name),
          version: 1,
          versionId: file.id,
        };
      }
    }
    return null;
  }

  async discard(actor: Principal, scope: TemplateScope, importId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await this.#row(tx, actor, scope, importId);
      const removed = await tx.execute<{ files: string[] }>(
        sql`delete from template_imports where id = ${importId} returning files`,
      );
      const ids = removed.rows.flatMap((row) => row.files);
      if (ids.length === 0) return;
      await tx.execute(sql`
        update stored_files set state = 'orphaned', updated_at = now()
        where id = any(${sql.param(ids)}::uuid[]) and state = 'stored'`);
    });
  }

  async confirm(
    actor: Principal,
    scope: TemplateScope,
    importId: string,
    input: { decisions: readonly ImportDecision[]; skipInvalid: boolean },
  ): Promise<TemplateImportResult> {
    await this.#storage.requireUpload();
    const organizationId = await this.#organizationOf(scope);
    const outcome = await this.#database.transaction(async (tx) => {
      const row = await this.#row(tx, actor, scope, importId);
      const invalid = row.templates.filter((template) => !template.valid);
      if (invalid.length > 0 && !input.skipInvalid) {
        throw new SpaceError(
          "invalidTemplatesInFile",
          `${invalid.length} of the templates in the file are not valid. Import only the valid ones, or fix the file and upload it again.`,
          { templateProblems: invalid.flatMap((template) => template.problems).slice(0, MAX_PROBLEMS) },
        );
      }
      const decisions = new Map(input.decisions.map((decision) => [decision.index, decision]));
      const existing = await this.#existingNames(scope);
      const created: string[] = [];
      const replaced: string[] = [];
      const names = { created: [] as string[], replaced: [] as string[] };
      const committed = new Set<string>();
      let skipped = invalid.length;
      for (const template of row.templates) {
        if (!template.valid || !template.document || !template.category) continue;
        const decision = decisions.get(template.index) ?? { index: template.index, action: "create" };
        if (decision.action === "skip") {
          skipped += 1;
          continue;
        }
        const clean = cleanTemplate({
          name: decision.action === "create" && decision.name !== undefined ? decision.name : template.name,
          description: template.description,
          category: template.category,
          title: template.title,
          fields: template.fields,
          document: template.document,
          series: template.series,
        });
        const key = clean.name.toLowerCase();
        let templateId: string;
        if (decision.action === "replace") {
          const target = existing.get(key);
          if (!target || target !== template.conflict?.templateId) {
            throw new SpaceError(
              "templateNotFound",
              `The template '${template.name}' to replace no longer exists here. Upload the file again.`,
            );
          }
          templateId = await this.#replace(tx, actor, target, clean);
          replaced.push(templateId);
          names.replaced.push(clean.name);
        } else {
          if (existing.has(key)) {
            throw new SpaceError(
              "templateNameTaken",
              `A template named '${clean.name}' already exists here. Replace it or choose another name.`,
              { templateIndex: template.index },
            );
          }
          templateId = await this.#templates.insert(tx, actor, scope, clean);
          created.push(templateId);
          names.created.push(clean.name);
        }
        existing.set(key, templateId);
        for (const file of template.files) {
          if (!committed.has(file.storedId)) {
            await this.#files.files.commit(tx, file.storedId);
            committed.add(file.storedId);
          }
          await tx.execute(sql`
            insert into template_files (id, template_id, file_id, name, created_by)
            values (${file.id}, ${templateId}, ${file.storedId}, ${file.name}, ${actorIdOf(actor)})`);
        }
      }
      const left = await tx.execute<{ files: string[] }>(
        sql`delete from template_imports where id = ${importId} returning files`,
      );
      const unused = left.rows.flatMap((item) => item.files).filter((id) => !committed.has(id));
      if (unused.length > 0) {
        await tx.execute(sql`
          update stored_files set state = 'orphaned', updated_at = now()
          where id = any(${sql.param(unused)}::uuid[]) and state = 'stored'`);
      }
      await this.#audit.record(tx, {
        name: "template.imported",
        actor,
        targetId: null,
        fields: {
          level: scope.level,
          organizationId,
          spaceId: scope.level === "space" ? scope.spaceId : null,
          fileName: row.file_name,
          created: names.created,
          replaced: names.replaced,
        },
        scope: auditScopeOf({ organizationId }),
      });
      return { created, replaced, skipped };
    });
    const load = async (ids: string[]) =>
      (await Promise.all(ids.map((id) => this.#templates.get(id)))).filter(
        (template): template is PageTemplate => template !== null,
      );
    return {
      created: await load(outcome.created),
      replaced: await load(outcome.replaced),
      skipped: outcome.skipped,
    };
  }

  async #replace(
    tx: Transaction,
    actor: Principal,
    templateId: string,
    clean: ReturnType<typeof cleanTemplate>,
  ): Promise<string> {
    await tx.execute(sql`select id from page_templates where id = ${templateId} for update`);
    await tx.execute(sql`delete from template_files where template_id = ${templateId}`);
    await tx.execute(sql`
      update page_templates set name = ${clean.name}, description = ${clean.description},
        category = ${clean.category}, title = ${clean.title}, document = ${JSON.stringify(clean.document)}::jsonb,
        schema_version = ${editorSchemaVersion}, fields = ${JSON.stringify(clean.fields)}::jsonb,
        series = ${clean.series === null ? null : JSON.stringify(clean.series)}::jsonb, files_adopted = true,
        updated_by = ${actorIdOf(actor)}, updated_at = now()
      where id = ${templateId}`);
    return templateId;
  }
}
