import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider";
import * as Y from "yjs";
import { onSignOut } from "../session/sign-out.js";
import { decodeBase64, type SaveState, SaveTracker } from "./save-state.js";

export const connectionRefusals = [
  "originNotAllowed",
  "tokenNotAllowed",
  "notSignedIn",
  "pageNotFound",
  "noEditPermission",
  "tooManyConnections",
] as const;

export const connectionCloses = [
  "updateRejected",
  "permissionRevoked",
  "sessionEnded",
  "tooManyMessages",
] as const;

export type CollaborationProblem =
  | (typeof connectionRefusals)[number]
  | (typeof connectionCloses)[number]
  | "unknown";

export interface CollaborationSnapshot {
  connected: boolean;
  synced: boolean;
  loaded: boolean;
  problem: CollaborationProblem | null;
  saveState: SaveState;
}

export function collaborationUrl(origin: string): string {
  return `${origin.replace(/^http/, "ws")}/collab`;
}

export function documentName(pageId: string): string {
  return `page:${pageId.toLowerCase()}`;
}

function problemOf(reason: string, known: readonly string[]): CollaborationProblem {
  return (known.includes(reason) ? reason : "unknown") as CollaborationProblem;
}

type Listener = () => void;

export const REATTACH_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000];

export class PageCollaboration {
  readonly doc = new Y.Doc();
  readonly name: string;
  readonly provider: HocuspocusProvider;
  readonly tracker: SaveTracker;
  readonly #listeners = new Set<Listener>();
  #snapshot: CollaborationSnapshot = {
    connected: false,
    synced: false,
    loaded: false,
    problem: null,
    saveState: "offline",
  };
  #reattachAttempts = 0;
  #reattachTimer: ReturnType<typeof setTimeout> | null = null;
  #destroyed = false;

  constructor(pageId: string, options: { origin?: string } = {}) {
    this.name = documentName(pageId);
    this.tracker = new SaveTracker(this.doc);
    this.tracker.subscribe((saveState) => this.#set({ saveState }));
    this.provider = new HocuspocusProvider({
      url: collaborationUrl(options.origin ?? globalThis.location.origin),
      name: this.name,
      document: this.doc,
      token: "session",
      onStatus: ({ status }) => {
        const connected = status === WebSocketStatus.Connected;
        this.tracker.connection(connected);
        this.#set({ connected });
      },
      onSynced: ({ state }) => {
        if (state) {
          this.#reattachAttempts = 0;
          this.tracker.connection(true);
          this.#set({ synced: true, connected: true, loaded: true });
          return;
        }
        this.#set({ synced: false });
      },
      onAuthenticationFailed: ({ reason }) => {
        this.#set({ problem: problemOf(reason, connectionRefusals) });
      },
      onClose: ({ event }) => {
        if (event.reason === "unavailable") {
          this.tracker.connection(false);
          this.#set({ connected: false, synced: false });
          this.#scheduleReattach();
          return;
        }
        if (event.reason && (connectionCloses as readonly string[]).includes(event.reason)) {
          this.#set({ problem: problemOf(event.reason, connectionCloses) });
        }
      },
      onUnsyncedChanges: ({ number }) => this.tracker.unsyncedChanges(number),
      onStateless: ({ payload }) => this.#stateless(payload),
    });
    this.doc.on("update", (_update: Uint8Array, origin: unknown) => {
      if (origin !== this.provider) this.tracker.localChange();
    });
    globalThis.addEventListener("offline", this.#wentOffline);
    globalThis.addEventListener("online", this.#cameOnline);
  }

  #wentOffline = (): void => {
    this.tracker.connection(false);
    this.#set({ connected: false, synced: false });
    this.provider.disconnect();
  };

  #cameOnline = (): void => {
    if (!this.#destroyed) void this.provider.connect();
  };

  #scheduleReattach(): void {
    if (this.#destroyed || this.#reattachTimer !== null) return;
    const delay =
      REATTACH_DELAYS_MS[Math.min(this.#reattachAttempts, REATTACH_DELAYS_MS.length - 1)] ?? 30_000;
    this.#reattachAttempts += 1;
    this.#reattachTimer = setTimeout(() => {
      this.#reattachTimer = null;
      if (this.#destroyed) return;
      this.provider.detach();
      this.provider.attach();
    }, delay);
  }

  #stateless(payload: string): void {
    let message: { type?: unknown; stateVector?: unknown };
    try {
      message = JSON.parse(payload) as { type?: unknown; stateVector?: unknown };
    } catch {
      return;
    }
    if (message.type === "saved" && typeof message.stateVector === "string") {
      this.tracker.saved(decodeBase64(message.stateVector));
    } else if (message.type === "saveFailed") {
      this.tracker.saveFailed();
    }
  }

  #set(changes: Partial<CollaborationSnapshot>): void {
    const next = { ...this.#snapshot, ...changes };
    if (
      next.connected === this.#snapshot.connected &&
      next.synced === this.#snapshot.synced &&
      next.loaded === this.#snapshot.loaded &&
      next.problem === this.#snapshot.problem &&
      next.saveState === this.#snapshot.saveState
    ) {
      return;
    }
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): CollaborationSnapshot => this.#snapshot;

  get hasUnsavedChanges(): boolean {
    return this.tracker.hasUnsavedChanges;
  }

  destroy(): void {
    this.#destroyed = true;
    globalThis.removeEventListener("offline", this.#wentOffline);
    globalThis.removeEventListener("online", this.#cameOnline);
    if (this.#reattachTimer !== null) clearTimeout(this.#reattachTimer);
    this.tracker.destroy();
    this.provider.destroy();
    this.doc.destroy();
    this.#listeners.clear();
  }
}

interface OpenCollaboration {
  collaboration: PageCollaboration;
  editors: number;
  unsubscribe: (() => void) | null;
}

const openCollaborations = new Map<string, OpenCollaboration>();

function keepsUnsavedChanges(): boolean {
  for (const entry of openCollaborations.values()) {
    if (entry.editors === 0 && entry.collaboration.hasUnsavedChanges) return true;
  }
  return false;
}

function warnBeforeUnload(event: BeforeUnloadEvent): void {
  if (!keepsUnsavedChanges()) return;
  event.preventDefault();
  event.returnValue = "";
}

export function openCollaboration(pageId: string, options: { origin?: string } = {}): PageCollaboration {
  const entry = openCollaborations.get(documentName(pageId));
  if (entry) {
    entry.editors += 1;
    entry.unsubscribe?.();
    entry.unsubscribe = null;
    return entry.collaboration;
  }
  const collaboration = new PageCollaboration(pageId, options);
  openCollaborations.set(collaboration.name, { collaboration, editors: 1, unsubscribe: null });
  return collaboration;
}

export function closeCollaboration(collaboration: PageCollaboration): void {
  const entry = openCollaborations.get(collaboration.name);
  if (entry?.collaboration !== collaboration) {
    collaboration.destroy();
    return;
  }
  entry.editors -= 1;
  if (entry.editors > 0) return;
  const finish = (): void => {
    if (entry.editors > 0) return;
    if (collaboration.hasUnsavedChanges && collaboration.getSnapshot().problem === null) return;
    entry.unsubscribe?.();
    openCollaborations.delete(collaboration.name);
    if (!keepsUnsavedChanges()) globalThis.removeEventListener("beforeunload", warnBeforeUnload);
    collaboration.destroy();
  };
  entry.unsubscribe = collaboration.subscribe(finish);
  globalThis.addEventListener("beforeunload", warnBeforeUnload);
  finish();
}

export function discardOpenCollaborations(): void {
  for (const entry of openCollaborations.values()) {
    entry.unsubscribe?.();
    entry.collaboration.destroy();
  }
  openCollaborations.clear();
  globalThis.removeEventListener("beforeunload", warnBeforeUnload);
}

onSignOut(discardOpenCollaborations);
