import { validateDocument } from "@pagehall/editor-schema";
import {
  elementBytes,
  hasOnlySceneTypes,
  isValidSceneFile,
  isValidSceneSettings,
  MAX_ELEMENTS,
  MAX_FILES,
  MAX_SCENE_BYTES,
  SCENE_ELEMENTS,
  SCENE_FILES,
  SCENE_SETTINGS,
  type SceneProblem,
  validateElement,
} from "@pagehall/editor-schema/scene";
import { documentFromYDoc } from "@pagehall/editor-schema/yjs";
import * as Y from "yjs";

export type UpdateVerdict =
  | { ok: true; newClients: number[] }
  | { ok: false; reason: "invalidDocument" | "foreignClient" | "malformed"; problems: string[] };

export interface ClientOwners {
  owners(clientIds: number[]): Promise<Map<number, string>>;
}

type Changes = Map<object, Set<string | null>>;

export interface ContentValidator {
  check(doc: Y.Doc, changed: Changes): string[] | null;
  observe?(doc: Y.Doc, changed: Changes): void;
}

export type ValidatorFactory = (doc: Y.Doc) => ContentValidator;

export const pageValidator: ValidatorFactory = () => ({
  check(doc) {
    const result = validateDocument(documentFromYDoc(doc));
    return result.ok ? null : result.problems.map((problem) => problem.code);
  },
});

export const sceneValidator: ValidatorFactory = (initial) => {
  const sizes = new Map<string, number>();
  let total = 0;
  for (const [id, value] of initial.getMap<unknown>(SCENE_ELEMENTS).entries()) {
    const size = elementBytes(value) ?? 0;
    sizes.set(id, size);
    total += size;
  }
  const validator: ContentValidator = {
    check(doc, changed) {
      if (!hasOnlySceneTypes(doc)) return ["unknownField"];
      const problems: SceneProblem[] = [];
      const elements = doc.getMap<unknown>(SCENE_ELEMENTS);
      const files = doc.getMap<unknown>(SCENE_FILES);
      const updates = new Map<string, number>();
      for (const key of changed.get(elements) ?? []) {
        if (key === null) continue;
        const value = elements.get(key);
        if (value === undefined) {
          updates.set(key, 0);
          continue;
        }
        const element = validateElement(value, `elements.${key}`, problems);
        if (element && element.id !== key)
          problems.push({ path: `elements.${key}.id`, code: "invalidElement" });
        updates.set(key, elementBytes(value) ?? MAX_SCENE_BYTES);
        if (problems.length >= 20) break;
      }
      for (const key of changed.get(files) ?? []) {
        if (key === null) continue;
        const value = files.get(key);
        if (value !== undefined && !isValidSceneFile(key, value))
          problems.push({ path: `files.${key}`, code: "invalidFile" });
      }
      const settings = doc.getMap<unknown>(SCENE_SETTINGS);
      if (changed.has(settings) && !isValidSceneSettings(Object.fromEntries(settings.entries()))) {
        problems.push({ path: "settings", code: "invalidElement" });
      }
      if (elements.size > MAX_ELEMENTS) problems.push({ path: "elements", code: "tooManyElements" });
      if (files.size > MAX_FILES) problems.push({ path: "files", code: "tooManyFiles" });
      for (const [key, size] of updates) {
        total += size - (sizes.get(key) ?? 0);
        if (size === 0) sizes.delete(key);
        else sizes.set(key, size);
      }
      if (total > MAX_SCENE_BYTES) problems.push({ path: "", code: "tooLarge" });
      return problems.length > 0 ? problems.map((problem) => problem.code) : null;
    },
    observe(doc, changed) {
      validator.check(doc, changed);
    },
  };
  return validator;
};

function clientsOf(update: Uint8Array): number[] {
  const clients = new Set<number>();
  for (const struct of Y.decodeUpdate(update).structs) clients.add(struct.id.client);
  return [...clients];
}

export class DocumentGuard {
  readonly #live: Y.Doc;
  readonly #owners: ClientOwners;
  readonly #validator: ValidatorFactory;
  readonly #known = new Map<number, string>();
  #shadow: Y.Doc;
  #content: ContentValidator;
  #changed: Changes = new Map();

  constructor(live: Y.Doc, owners: ClientOwners, validator: ValidatorFactory = pageValidator) {
    this.#live = live;
    this.#owners = owners;
    this.#validator = validator;
    this.#shadow = this.#copy();
    this.#content = validator(this.#shadow);
    live.on("update", this.#follow);
  }

  #copy(): Y.Doc {
    const shadow = new Y.Doc({ gc: this.#live.gc });
    Y.applyUpdate(shadow, Y.encodeStateAsUpdate(this.#live));
    shadow.on("afterTransaction", this.#record);
    return shadow;
  }

  #record = (transaction: Y.Transaction) => {
    for (const [type, keys] of transaction.changed) {
      const known = this.#changed.get(type) ?? new Set<string | null>();
      for (const key of keys) known.add(key);
      this.#changed.set(type, known);
    }
  };

  #follow = (update: Uint8Array) => {
    this.#changed.clear();
    Y.applyUpdate(this.#shadow, update);
    if (this.#changed.size > 0) this.#content.observe?.(this.#shadow, this.#changed);
    this.#changed.clear();
  };

  #reset(): void {
    this.#shadow.off("afterTransaction", this.#record);
    this.#shadow.destroy();
    this.#shadow = this.#copy();
    this.#content = this.#validator(this.#shadow);
    this.#changed.clear();
  }

  async check(update: Uint8Array, accountId: string): Promise<UpdateVerdict> {
    let clients: number[];
    try {
      clients = clientsOf(update);
    } catch {
      return { ok: false, reason: "malformed", problems: [] };
    }
    const unknown = clients.filter((client) => !this.#known.has(client));
    if (unknown.length > 0) {
      for (const [client, owner] of await this.#owners.owners(unknown)) this.#known.set(client, owner);
    }
    if (clients.some((client) => (this.#known.get(client) ?? accountId) !== accountId)) {
      return { ok: false, reason: "foreignClient", problems: [] };
    }
    this.#changed.clear();
    try {
      Y.applyUpdate(this.#shadow, update);
    } catch {
      this.#reset();
      return { ok: false, reason: "malformed", problems: [] };
    }
    const problems = this.#content.check(this.#shadow, this.#changed);
    this.#changed.clear();
    if (problems) {
      this.#reset();
      return { ok: false, reason: "invalidDocument", problems: [...new Set(problems)].slice(0, 20) };
    }
    const newClients = clients.filter((client) => !this.#known.has(client));
    for (const client of newClients) this.#known.set(client, accountId);
    return { ok: true, newClients };
  }

  destroy(): void {
    this.#live.off("update", this.#follow);
    this.#shadow.off("afterTransaction", this.#record);
    this.#shadow.destroy();
  }
}
