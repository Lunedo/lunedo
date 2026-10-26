import { CLIENT_BUILD_META } from "@lunedo/shared";

export interface UpdateEnvironment {
  ownBuild: () => string | null;
  hidden: () => boolean;
  reload: () => void;
  open: (href: string) => void;
  storage: () => Storage | null;
  now: () => number;
}

export interface UpdateState {
  available: boolean;
  refused: boolean;
}

type UnsavedCheck = () => boolean;
type Settle = () => Promise<void>;

const CHUNK_RELOAD_KEY = "lunedo.chunkReloadAt";
const CHUNK_RELOAD_PAUSE_MS = 60_000;
const SETTLE_LIMIT_MS = 10_000;
const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

function browserEnvironment(): UpdateEnvironment {
  return {
    ownBuild: () =>
      globalThis.document?.querySelector<HTMLMetaElement>(`meta[name="${CLIENT_BUILD_META}"]`)?.content ||
      null,
    hidden: () => globalThis.document?.visibilityState === "hidden",
    reload: () => globalThis.location.reload(),
    open: (href) => globalThis.location.assign(href),
    storage: () => {
      try {
        return globalThis.sessionStorage ?? null;
      } catch {
        return null;
      }
    },
    now: () => Date.now(),
  };
}

let environment = browserEnvironment();
let serverBuild: string | null = null;
let refused = false;
let state: UpdateState = { available: false, refused: false };
const unsaved = new Map<UnsavedCheck, Settle | null>();
const listeners = new Set<() => void>();

function publish(): void {
  const next = { available: updateAvailable(), refused };
  if (next.available === state.available && next.refused === state.refused) return;
  state = next;
  for (const listener of listeners) listener();
}

export function setUpdateEnvironment(next: Partial<UpdateEnvironment>): void {
  environment = { ...browserEnvironment(), ...next };
}

export function resetUpdateState(): void {
  serverBuild = null;
  refused = false;
  unsaved.clear();
  state = { available: false, refused: false };
  environment = browserEnvironment();
}

export function updateState(): UpdateState {
  return state;
}

export function subscribeToUpdates(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateAvailable(): boolean {
  const own = environment.ownBuild();
  return own !== null && serverBuild !== null && own !== serverBuild;
}

export function registerUnsavedChanges(check: UnsavedCheck, settle: Settle | null = null): () => void {
  unsaved.set(check, settle);
  return () => {
    unsaved.delete(check);
    reloadIfHidden();
  };
}

export function hasUnsavedChanges(): boolean {
  for (const check of unsaved.keys()) if (check()) return true;
  return false;
}

export function reloadIfHidden(): boolean {
  if (!updateAvailable() || !environment.hidden() || hasUnsavedChanges()) return false;
  environment.reload();
  return true;
}

export function noteServerBuild(build: string | null): void {
  if (!build) return;
  serverBuild = build;
  publish();
  reloadIfHidden();
}

export function noteRefused(): void {
  refused = true;
  publish();
}

export function openForUpdate(href: string): boolean {
  if (!updateAvailable() || hasUnsavedChanges()) return false;
  environment.open(href);
  return true;
}

export async function saveAndReload(): Promise<void> {
  const settling = [...unsaved.entries()]
    .filter(([check, settle]) => settle !== null && check())
    .map(([, settle]) => (settle as Settle)());
  await Promise.race([
    Promise.allSettled(settling),
    new Promise((resolve) => setTimeout(resolve, SETTLE_LIMIT_MS)),
  ]);
  environment.reload();
}

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "ChunkLoadError" || CHUNK_ERROR.test(error.message);
}

export function reloadAfterChunkError(): boolean {
  if (hasUnsavedChanges()) return false;
  const storage = environment.storage();
  if (!storage) return false;
  const now = environment.now();
  try {
    const last = Number(storage.getItem(CHUNK_RELOAD_KEY) ?? 0);
    if (last > 0 && now - last < CHUNK_RELOAD_PAUSE_MS) return false;
    storage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  environment.reload();
  return true;
}

export function watchForUpdates(): () => void {
  const onVisibility = () => reloadIfHidden();
  const onPreloadError = (event: Event) => {
    if (reloadAfterChunkError()) event.preventDefault();
  };
  globalThis.document?.addEventListener("visibilitychange", onVisibility);
  globalThis.addEventListener?.("vite:preloadError", onPreloadError);
  return () => {
    globalThis.document?.removeEventListener("visibilitychange", onVisibility);
    globalThis.removeEventListener?.("vite:preloadError", onPreloadError);
  };
}
