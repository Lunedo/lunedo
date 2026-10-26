import { CLIENT_API_HEADER, CLIENT_API_LEVEL, CLIENT_BUILD_HEADER } from "@lunedo/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api/client.js";
import {
  isChunkLoadError,
  noteRefused,
  noteServerBuild,
  openForUpdate,
  registerUnsavedChanges,
  reloadAfterChunkError,
  resetUpdateState,
  saveAndReload,
  setUpdateEnvironment,
  updateState,
  watchForUpdates,
} from "./app-update.js";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

let hidden = false;
let now = 1_000_000;
const reload = vi.fn();
const open = vi.fn();
const storage = memoryStorage();

beforeEach(() => {
  hidden = false;
  now = 1_000_000;
  reload.mockReset();
  open.mockReset();
  storage.clear();
  resetUpdateState();
  setUpdateEnvironment({
    ownBuild: () => "build-a",
    hidden: () => hidden,
    reload,
    open,
    storage: () => storage,
    now: () => now,
  });
});

afterEach(() => resetUpdateState());

describe("a new version on the server", () => {
  it("changes nothing while the server serves the same build", () => {
    noteServerBuild("build-a");
    expect(openForUpdate("/spaces")).toBe(false);
    expect(updateState().available).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("changes nothing in development, where the client has no build", () => {
    setUpdateEnvironment({ ownBuild: () => null, open, reload });
    noteServerBuild("build-b");
    expect(openForUpdate("/spaces")).toBe(false);
  });

  it("loads the target of the next route change in full", () => {
    noteServerBuild("build-b");
    expect(updateState().available).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    expect(openForUpdate("/spaces/IT?tab=pages")).toBe(true);
    expect(open).toHaveBeenCalledWith("/spaces/IT?tab=pages");
  });

  it("waits while the editor or a form has unsaved changes and loads once the person leaves them", () => {
    let unsaved = true;
    const unregister = registerUnsavedChanges(() => unsaved);
    noteServerBuild("build-b");
    expect(openForUpdate("/spaces")).toBe(false);
    unsaved = false;
    expect(openForUpdate("/spaces")).toBe(true);
    unregister();
  });

  it("reloads a hidden tab in the background, but never over unsaved changes", () => {
    hidden = true;
    const unregister = registerUnsavedChanges(() => true);
    noteServerBuild("build-b");
    expect(reload).not.toHaveBeenCalled();
    unregister();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads when a tab with a pending update is hidden later", () => {
    const stop = watchForUpdates();
    noteServerBuild("build-b");
    expect(reload).not.toHaveBeenCalled();
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it("checks without a timer", () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const stop = watchForUpdates();
    noteServerBuild("build-b");
    openForUpdate("/");
    expect(interval).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
    stop();
    interval.mockRestore();
    timeout.mockRestore();
  });
});

describe("a server that refuses the old client", () => {
  it("is reported, and saving and reloading waits for open changes", async () => {
    noteRefused();
    expect(updateState().refused).toBe(true);
    let finish: () => void = () => {};
    const settled = new Promise<void>((resolve) => {
      finish = resolve;
    });
    registerUnsavedChanges(
      () => true,
      () => settled,
    );
    const done = saveAndReload();
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
    finish();
    await done;
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("the API client", () => {
  it("sends its API level and notes the build the server names", async () => {
    let sent: string | null = null;
    const client = createApiClient(async (input: RequestInfo | URL) => {
      sent = (input as Request).headers.get(CLIENT_API_HEADER);
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", [CLIENT_BUILD_HEADER]: "build-b" },
      });
    });
    await client.GET("/api/v1/instance/info");
    expect(sent).toBe(String(CLIENT_API_LEVEL));
    expect(updateState().available).toBe(true);
  });
});

describe("a missing chunk after an update", () => {
  it("is recognised by the messages of the browsers", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: /assets/a.js"))).toBe(
      true,
    );
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Something else"))).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false);
  });

  it("reloads once and shows the error instead of reloading again right away", () => {
    expect(reloadAfterChunkError()).toBe(true);
    now += 5_000;
    expect(reloadAfterChunkError()).toBe(false);
    now += 60_000;
    expect(reloadAfterChunkError()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does not reload over unsaved changes or without storage for the guard", () => {
    setUpdateEnvironment({ ownBuild: () => "build-a", reload, storage: () => null });
    expect(reloadAfterChunkError()).toBe(false);
    setUpdateEnvironment({ ownBuild: () => "build-a", reload, storage: () => storage, now: () => now });
    const unregister = registerUnsavedChanges(() => true);
    expect(reloadAfterChunkError()).toBe(false);
    unregister();
    setUpdateEnvironment({
      ownBuild: () => "build-a",
      reload,
      storage: () => {
        const broken = memoryStorage();
        broken.setItem = () => {
          throw new Error("blocked");
        };
        return broken;
      },
    });
    expect(reloadAfterChunkError()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads on a failed preload instead of showing an error", () => {
    const stop = watchForUpdates();
    const event = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });
});
