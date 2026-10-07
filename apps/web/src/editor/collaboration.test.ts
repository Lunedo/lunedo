import { afterEach, describe, expect, it, vi } from "vitest";
import { PageCollaboration } from "./collaboration.js";

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
