import {
  isValidSceneFile,
  SCENE_ELEMENTS,
  SCENE_FILES,
  SCENE_SETTINGS,
  type SceneFile,
  type SceneProblem,
  sceneImageTypes,
  validateElement,
} from "@pagehall/editor-schema/scene";
import * as Y from "yjs";

export interface SyncElement {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly versionNonce: number;
  readonly isDeleted: boolean;
  readonly [key: string]: unknown;
}

export interface LocalFile {
  id: string;
  mimeType: string;
  dataURL: string;
  created: number;
}

export interface SceneTarget {
  elements(): readonly SyncElement[];
  replaceElements(elements: readonly SyncElement[]): void;
  files(): Readonly<Record<string, LocalFile>>;
  addFiles(files: LocalFile[]): void;
  backgroundColor(): string | null;
  setBackgroundColor(color: string | null): void;
}

export type Reconcile = (local: readonly SyncElement[], remote: readonly SyncElement[]) => SyncElement[];

export interface FileStore {
  upload(file: LocalFile): Promise<string>;
  load(attachmentId: string, mimeType: string): Promise<string>;
}

export type RefusedElement = { element: SyncElement; problems: SceneProblem[] };

export const PUSH_DELAY_MS = 60;

export function newerThan(candidate: SyncElement, current: SyncElement): boolean {
  if (candidate.version !== current.version) return candidate.version > current.version;
  return candidate.versionNonce < current.versionNonce;
}

export function reconcileByVersion(
  local: readonly SyncElement[],
  remote: readonly SyncElement[],
): SyncElement[] {
  const merged = new Map(local.map((element) => [element.id, element]));
  for (const element of remote) {
    const current = merged.get(element.id);
    if (!current || newerThan(element, current)) merged.set(element.id, element);
  }
  return [...merged.values()];
}

function plain(element: SyncElement): Record<string, unknown> {
  return JSON.parse(JSON.stringify(element)) as Record<string, unknown>;
}

function isElement(value: unknown): value is SyncElement {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SyncElement).id === "string" &&
    typeof (value as SyncElement).version === "number"
  );
}

export class SceneSync {
  readonly #doc: Y.Doc;
  readonly #target: SceneTarget;
  readonly #reconcile: Reconcile;
  readonly #files: FileStore;
  readonly #onRefused: (refused: RefusedElement[]) => void;
  readonly #onFileFailed: (error: unknown) => void;
  readonly #onSent: () => void;
  readonly #synced = new Map<string, number>();
  readonly #uploading = new Set<string>();
  readonly #loading = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #editable: boolean;
  #destroyed = false;

  constructor(options: {
    doc: Y.Doc;
    target: SceneTarget;
    reconcile: Reconcile;
    files: FileStore;
    editable: boolean;
    onRefused?: (refused: RefusedElement[]) => void;
    onFileFailed?: (error: unknown) => void;
    onSent?: () => void;
  }) {
    this.#doc = options.doc;
    this.#target = options.target;
    this.#reconcile = options.reconcile;
    this.#files = options.files;
    this.#editable = options.editable;
    this.#onRefused = options.onRefused ?? (() => undefined);
    this.#onFileFailed = options.onFileFailed ?? (() => undefined);
    this.#onSent = options.onSent ?? (() => undefined);
    this.#elements().observe(this.#remoteElements);
    this.#fileMap().observe(this.#remoteFiles);
    this.#settings().observe(this.#remoteSettings);
  }

  #elements(): Y.Map<unknown> {
    return this.#doc.getMap<unknown>(SCENE_ELEMENTS);
  }

  #fileMap(): Y.Map<unknown> {
    return this.#doc.getMap<unknown>(SCENE_FILES);
  }

  #settings(): Y.Map<unknown> {
    return this.#doc.getMap<unknown>(SCENE_SETTINGS);
  }

  set editable(editable: boolean) {
    this.#editable = editable;
  }

  remoteElements(): SyncElement[] {
    return [...this.#elements().values()].filter(isElement);
  }

  pull(): void {
    if (this.#destroyed) return;
    const remote = this.remoteElements();
    for (const element of remote) this.#synced.set(element.id, element.version);
    this.#target.replaceElements(this.#reconcile(this.#target.elements(), remote));
    const color = this.#settings().get("viewBackgroundColor");
    if (typeof color === "string" || color === null) {
      if (color !== this.#target.backgroundColor()) this.#target.setBackgroundColor(color);
    }
    void this.#loadFiles();
  }

  #remoteElements = (_event: Y.YMapEvent<unknown>, transaction: Y.Transaction): void => {
    if (transaction.origin !== this) this.pull();
  };

  #remoteFiles = (_event: Y.YMapEvent<unknown>, transaction: Y.Transaction): void => {
    if (transaction.origin !== this) void this.#loadFiles();
  };

  #remoteSettings = (_event: Y.YMapEvent<unknown>, transaction: Y.Transaction): void => {
    if (transaction.origin !== this) this.pull();
  };

  changed(): void {
    if (!this.#editable || this.#destroyed || this.#timer !== null) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.flush();
    }, PUSH_DELAY_MS);
  }

  flush(): void {
    if (!this.#editable || this.#destroyed) return;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    const elements = this.#elements();
    const changes: Record<string, unknown>[] = [];
    const refused: RefusedElement[] = [];
    for (const element of this.#target.elements()) {
      if (this.#synced.get(element.id) === element.version) continue;
      const current = elements.get(element.id);
      if (isElement(current) && !newerThan(element, current)) continue;
      const value = plain(element);
      const problems: SceneProblem[] = [];
      if (!validateElement(value, `elements.${element.id}`, problems)) {
        refused.push({ element, problems });
        continue;
      }
      changes.push(value);
    }
    const color = this.#target.backgroundColor();
    const settings = this.#settings();
    const colorChanged = settings.get("viewBackgroundColor") !== color && color !== null;
    if (changes.length > 0 || colorChanged) {
      this.#doc.transact(() => {
        for (const value of changes) elements.set(value.id as string, value);
        if (colorChanged) settings.set("viewBackgroundColor", color);
      }, this);
      for (const value of changes) this.#synced.set(value.id as string, value.version as number);
      this.#onSent();
    }
    if (refused.length > 0) this.#onRefused(refused);
    void this.#uploadFiles();
  }

  async #uploadFiles(): Promise<void> {
    const known = this.#fileMap();
    const used = new Set(
      this.#target
        .elements()
        .filter(
          (element) => !element.isDeleted && element.type === "image" && typeof element.fileId === "string",
        )
        .map((element) => element.fileId as string),
    );
    for (const file of Object.values(this.#target.files())) {
      if (!used.has(file.id) || known.has(file.id) || this.#uploading.has(file.id)) continue;
      if (!(sceneImageTypes as readonly string[]).includes(file.mimeType)) continue;
      this.#uploading.add(file.id);
      try {
        const attachmentId = await this.#files.upload(file);
        const entry: SceneFile = { attachmentId, mimeType: file.mimeType as SceneFile["mimeType"] };
        if (!this.#destroyed && isValidSceneFile(file.id, entry)) {
          this.#doc.transact(() => known.set(file.id, entry), this);
        }
      } catch (error) {
        this.#onFileFailed(error);
      } finally {
        this.#uploading.delete(file.id);
      }
    }
  }

  async #loadFiles(): Promise<void> {
    const local = this.#target.files();
    const missing = [...this.#fileMap().entries()].filter(
      ([id, entry]) => !local[id] && !this.#loading.has(id) && isValidSceneFile(id, entry),
    ) as [string, SceneFile][];
    await Promise.all(
      missing.map(async ([id, entry]) => {
        this.#loading.add(id);
        try {
          const dataURL = await this.#files.load(entry.attachmentId, entry.mimeType);
          if (!this.#destroyed)
            this.#target.addFiles([{ id, mimeType: entry.mimeType, dataURL, created: Date.now() }]);
        } catch (error) {
          this.#onFileFailed(error);
        } finally {
          this.#loading.delete(id);
        }
      }),
    );
  }

  destroy(): void {
    this.#destroyed = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#elements().unobserve(this.#remoteElements);
    this.#fileMap().unobserve(this.#remoteFiles);
    this.#settings().unobserve(this.#remoteSettings);
  }
}
