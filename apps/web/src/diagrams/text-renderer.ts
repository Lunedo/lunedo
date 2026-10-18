import {
  type DiagramFailure,
  isDiagramReply,
  RENDER_TIMEOUT_MS,
  type TextDiagram,
} from "../diagram-frame/protocol.js";

export const DIAGRAM_FRAME_URL = "/diagram.html";

export type RenderResult =
  | { ok: true; svg: string }
  | { ok: false; reason: DiagramFailure; detail: string; line?: number | null };

interface Pending {
  id: number;
  diagram: TextDiagram;
  source: string;
  resolve: (result: RenderResult) => void;
}

export class TextDiagramRenderer {
  #frame: HTMLIFrameElement | null = null;
  #ready: Promise<void> | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #next = 0;

  constructor(
    private readonly timeout = RENDER_TIMEOUT_MS,
    private readonly url = DIAGRAM_FRAME_URL,
  ) {}

  #open(): Promise<void> {
    if (this.#ready && this.#frame?.isConnected) return this.#ready;
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.title = "";
    frame.style.cssText =
      "position:fixed;left:-10000px;top:0;width:1600px;height:1200px;border:0;visibility:hidden";
    frame.src = this.url;
    this.#frame = frame;
    this.#ready = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("unavailable"));
      }, this.timeout);
      const onMessage = (event: MessageEvent) => {
        if (
          event.source !== frame.contentWindow ||
          !isDiagramReply(event.data) ||
          event.data.type !== "ready"
        )
          return;
        window.clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve();
      };
      window.addEventListener("message", onMessage);
    });
    document.body.append(frame);
    return this.#ready;
  }

  #close(): void {
    this.#frame?.remove();
    this.#frame = null;
    this.#ready = null;
  }

  async #run(pending: Pending): Promise<void> {
    try {
      await this.#open();
    } catch {
      this.#close();
      pending.resolve({ ok: false, reason: "unavailable", detail: "" });
      return;
    }
    const frame = this.#frame;
    await new Promise<void>((done) => {
      const finish = (result: RenderResult) => {
        window.clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        pending.resolve(result);
        done();
      };
      const timer = window.setTimeout(() => {
        this.#close();
        finish({ ok: false, reason: "timeout", detail: "" });
      }, this.timeout);
      const onMessage = (event: MessageEvent) => {
        const reply = event.data;
        if (event.source !== frame?.contentWindow || !isDiagramReply(reply) || reply.type === "ready") return;
        if (reply.id !== pending.id) return;
        finish(
          reply.type === "rendered"
            ? { ok: true, svg: reply.svg }
            : { ok: false, reason: reply.reason, detail: reply.detail, line: reply.line ?? null },
        );
      };
      window.addEventListener("message", onMessage);
      frame?.contentWindow?.postMessage(
        { type: "render", id: pending.id, diagram: pending.diagram, source: pending.source },
        "*",
      );
    });
  }

  render(diagram: TextDiagram, source: string): Promise<RenderResult> {
    return new Promise((resolve) => {
      this.#next += 1;
      const pending = { id: this.#next, diagram, source, resolve };
      this.#queue = this.#queue.then(() => this.#run(pending));
    });
  }

  dispose(): void {
    this.#close();
  }
}

let shared: TextDiagramRenderer | null = null;

export function textDiagramRenderer(): TextDiagramRenderer {
  shared ??= new TextDiagramRenderer();
  return shared;
}
