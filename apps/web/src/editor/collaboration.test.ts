import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { closeCollaboration, openCollaboration, PageCollaboration } from "./collaboration.js";

describe("page collaboration", () => {
  let collaboration: PageCollaboration | null = null;

  afterEach(() => {
    collaboration?.destroy();
    collaboration = null;
  });

  it("goes offline as soon as the browser loses the network and reconnects when it is back", () => {
    collaboration = new PageCollaboration("01929b1e-0000-7000-8000-0000000000b0", {
      origin: "http://127.0.0.1:9",
    });
    const disconnect = vi.spyOn(collaboration.provider, "disconnect");
    const connect = vi.spyOn(collaboration.provider, "connect").mockResolvedValue(undefined);
    collaboration.doc.getText("probe").insert(0, "changed while connected");

    globalThis.dispatchEvent(new Event("offline"));
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(collaboration.getSnapshot()).toMatchObject({ connected: false, saveState: "offline" });

    globalThis.dispatchEvent(new Event("online"));
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("stops listening to the network once it is destroyed", () => {
    const destroyed = new PageCollaboration("01929b1e-0000-7000-8000-0000000000b0", {
      origin: "http://127.0.0.1:9",
    });
    const disconnect = vi.spyOn(destroyed.provider, "disconnect");
    const connect = vi.spyOn(destroyed.provider, "connect").mockResolvedValue(undefined);
    destroyed.destroy();
    globalThis.dispatchEvent(new Event("offline"));
    globalThis.dispatchEvent(new Event("online"));
    expect(disconnect).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });
});

describe("open page collaborations", () => {
  const pageId = "01929b1e-0000-7000-8000-0000000000c0";
  const origin = "http://127.0.0.1:9";

  function saveEverything(collaboration: PageCollaboration): void {
    collaboration.tracker.unsyncedChanges(0);
    collaboration.tracker.saved(Y.encodeStateVector(collaboration.doc));
  }

  it("keeps unsaved changes when the editor closes and hands them to the next editor of the page", () => {
    const first = openCollaboration(pageId, { origin });
    globalThis.dispatchEvent(new Event("offline"));
    first.doc.getText("probe").insert(0, "written while offline");
    const destroy = vi.spyOn(first, "destroy");
    closeCollaboration(first);
    expect(destroy).not.toHaveBeenCalled();

    const second = openCollaboration(pageId, { origin });
    expect(second).toBe(first);
    expect(second.doc.getText("probe").toString()).toBe("written while offline");
    saveEverything(second);
    closeCollaboration(second);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("closes a kept collaboration once its changes are saved", () => {
    const collaboration = openCollaboration(pageId, { origin });
    collaboration.tracker.connection(true);
    collaboration.doc.getText("probe").insert(0, "pending");
    const destroy = vi.spyOn(collaboration, "destroy");
    closeCollaboration(collaboration);
    expect(destroy).not.toHaveBeenCalled();

    saveEverything(collaboration);
    expect(destroy).toHaveBeenCalledTimes(1);
    const next = openCollaboration(pageId, { origin });
    expect(next).not.toBe(collaboration);
    closeCollaboration(next);
  });

  it("warns before the tab closes while a closed editor still has unsaved changes", () => {
    const listen = vi.spyOn(globalThis, "addEventListener");
    const collaboration = openCollaboration(pageId, { origin });
    collaboration.doc.getText("probe").insert(0, "pending");
    closeCollaboration(collaboration);
    const warn = listen.mock.calls.find(([type]) => type === "beforeunload")?.[1] as
      | ((event: Event) => void)
      | undefined;
    listen.mockRestore();
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      warn?.(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(true);

    collaboration.tracker.connection(true);
    saveEverything(collaboration);
    expect(unload()).toBe(false);
  });

  it("closes at once when there is nothing to save", () => {
    const collaboration = openCollaboration(pageId, { origin });
    const destroy = vi.spyOn(collaboration, "destroy");
    closeCollaboration(collaboration);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
