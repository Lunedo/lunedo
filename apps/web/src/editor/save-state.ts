import * as Y from "yjs";

export type SaveState = "connecting" | "editing" | "saving" | "saved" | "offline" | "error";

export const TYPING_PAUSE_MS = 800;

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function coversOwnChanges(doc: Y.Doc, storedStateVector: Uint8Array): boolean {
  const stored = Y.decodeStateVector(storedStateVector);
  return (stored.get(doc.clientID) ?? 0) >= Y.getState(doc.store, doc.clientID);
}

interface Scheduler {
  set(callback: () => void, delay: number): unknown;
  clear(handle: unknown): void;
}

const timers: Scheduler = {
  set: (callback, delay) => setTimeout(callback, delay),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class SaveTracker {
  readonly #doc: Y.Doc;
  readonly #scheduler: Scheduler;
  readonly #listeners = new Set<(state: SaveState) => void>();
  #changes = 0;
  #acknowledged = 0;
  #dirty = false;
  #typing = false;
  #online = false;
  #lost = false;
  #failed = false;
  #typingTimer: unknown = null;
  #state: SaveState = "connecting";

  constructor(doc: Y.Doc, scheduler: Scheduler = timers) {
    this.#doc = doc;
    this.#scheduler = scheduler;
  }

  get state(): SaveState {
    return this.#state;
  }

  get hasUnsavedChanges(): boolean {
    return this.#dirty;
  }

  subscribe(listener: (state: SaveState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  localChange(): void {
    this.#changes += 1;
    this.#dirty = true;
    this.#typing = true;
    if (this.#typingTimer !== null) this.#scheduler.clear(this.#typingTimer);
    this.#typingTimer = this.#scheduler.set(() => {
      this.#typingTimer = null;
      this.#typing = false;
      this.#update();
    }, TYPING_PAUSE_MS);
    this.#update();
  }

  unsyncedChanges(count: number): void {
    if (count === 0) this.#acknowledged = this.#changes;
  }

  saved(storedStateVector: Uint8Array): void {
    this.#failed = false;
    if (this.#acknowledged === this.#changes && coversOwnChanges(this.#doc, storedStateVector))
      this.#dirty = false;
    this.#update();
  }

  saveFailed(): void {
    this.#failed = true;
    this.#update();
  }

  connection(online: boolean): void {
    if (this.#online && !online) this.#lost = true;
    if (online) this.#lost = false;
    this.#online = online;
    this.#update();
  }

  connectionLost(): void {
    this.#online = false;
    this.#lost = true;
    this.#update();
  }

  destroy(): void {
    if (this.#typingTimer !== null) this.#scheduler.clear(this.#typingTimer);
    this.#listeners.clear();
  }

  #compute(): SaveState {
    if (!this.#online) return this.#lost ? "offline" : "connecting";
    if (this.#failed) return "error";
    if (!this.#dirty) return "saved";
    return this.#typing ? "editing" : "saving";
  }

  #update(): void {
    const next = this.#compute();
    if (next === this.#state) return;
    this.#state = next;
    for (const listener of this.#listeners) listener(next);
  }
}
