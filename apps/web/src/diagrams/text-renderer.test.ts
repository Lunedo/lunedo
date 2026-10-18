import { afterEach, describe, expect, it } from "vitest";
import { TextDiagramRenderer } from "./text-renderer.js";

function frames(): HTMLIFrameElement[] {
  return [...document.querySelectorAll("iframe")];
}

function reply(frame: HTMLIFrameElement, data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data, source: frame.contentWindow }));
}

async function until<T>(read: () => T | undefined): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out");
}

afterEach(() => {
  for (const frame of frames()) frame.remove();
});

describe("text diagram renderer", () => {
  it("renders in a hidden sandboxed frame and ignores messages from other windows", async () => {
    const renderer = new TextDiagramRenderer(2000, "about:blank");
    const result = renderer.render("mermaid", "graph TD");
    const frame = await until(() => frames()[0]);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("aria-hidden")).toBe("true");
    reply(frame, { type: "ready" });
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "rendered", id: 1, svg: "<svg>forged</svg>" } }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    reply(frame, { type: "rendered", id: 1, svg: "<svg/>" });
    await expect(result).resolves.toEqual({ ok: true, svg: "<svg/>" });
    renderer.dispose();
  });

  it("stops a render that takes too long and starts a new frame for the next one", async () => {
    const renderer = new TextDiagramRenderer(50, "about:blank");
    const first = renderer.render("plantuml", "@startuml\n@enduml");
    const frame = await until(() => frames()[0]);
    reply(frame, { type: "ready" });
    await expect(first).resolves.toEqual({ ok: false, reason: "timeout", detail: "" });
    expect(frame.isConnected).toBe(false);
    const second = renderer.render("plantuml", "@startuml\n@enduml");
    const next = await until(() => frames()[0]);
    expect(next).not.toBe(frame);
    reply(next, { type: "ready" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    reply(next, { type: "failed", id: 2, reason: "syntax", detail: "line 2", line: 2 });
    await expect(second).resolves.toEqual({ ok: false, reason: "syntax", detail: "line 2", line: 2 });
    renderer.dispose();
  });

  it("reports an unavailable renderer when the frame does not start", async () => {
    const renderer = new TextDiagramRenderer(30, "about:blank");
    await expect(renderer.render("mermaid", "graph TD")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
      detail: "",
    });
    expect(frames()).toEqual([]);
  });
});
