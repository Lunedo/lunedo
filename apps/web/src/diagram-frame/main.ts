import {
  type DiagramReply,
  type DiagramRequest,
  isDiagramRequest,
  renderedProblem,
  sourceProblem,
  syntaxProblem,
} from "./protocol.js";

const MERMAID_SECURE_KEYS = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "maxEdges",
  "suppressErrorRendering",
  "htmlLabels",
  "flowchart",
  "dompurifyConfig",
  "themeCSS",
];
const PLANTUML_ERROR = /Syntax Error\?/;

let next = 0;
let queue: Promise<void> = Promise.resolve();

function post(message: DiagramReply): void {
  window.parent.postMessage(message, "*");
}

function svgText(svg: string): string {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  return [...document.querySelectorAll("text")]
    .map((element) => element.textContent?.trim() ?? "")
    .filter((line) => line.length > 0)
    .join("\n");
}

function asXml(svg: string): string {
  const root = new DOMParser().parseFromString(svg, "text/html").querySelector("svg");
  if (!root) throw new Error("The renderer returned no SVG image");
  return new XMLSerializer().serializeToString(root);
}

async function renderMermaid(source: string): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    layout: "dagre",
    theme: "default",
    look: "classic",
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    maxTextSize: 50_000,
    maxEdges: 1000,
    secure: MERMAID_SECURE_KEYS,
    suppressErrorRendering: true,
  });
  next += 1;
  const { svg } = await mermaid.render(`diagram-${next}`, source);
  return svg;
}

async function renderPlantUml(source: string): Promise<string> {
  const scope = globalThis as { PLANTUML_STDLIB_LOADER?: unknown };
  scope.PLANTUML_STDLIB_LOADER = (_url: string, _ok: () => void, fail: (message: string) => void) => {
    fail("The PlantUML standard library is not available");
    return true;
  };
  await import("@plantuml/core/viz-global.js");
  if (/!theme\b/i.test(source)) await import("@plantuml/core/themes.js");
  if (/<:[a-z0-9_]+:>/i.test(source)) await import("@plantuml/core/emoji.js");
  if (/<&[a-z0-9_-]+>/i.test(source)) await import("@plantuml/core/openiconic.js");
  const { renderToString } = await import("@plantuml/core");
  const svg = await new Promise<string>((resolve, reject) =>
    renderToString(source.split(/\r?\n/), resolve, (message: string) => reject(new Error(message))),
  );
  if (PLANTUML_ERROR.test(svg)) throw new Error(svgText(svg) || "Syntax Error?");
  return svg;
}

async function render(request: DiagramRequest): Promise<void> {
  const blocked = sourceProblem(request.diagram, request.source);
  if (blocked) {
    post({ type: "failed", id: request.id, reason: "include", detail: blocked });
    return;
  }
  let svg: string;
  try {
    svg = asXml(
      request.diagram === "mermaid"
        ? await renderMermaid(request.source)
        : await renderPlantUml(request.source),
    );
  } catch (error) {
    const { line, detail } = syntaxProblem(request.diagram, request.source, error);
    post({ type: "failed", id: request.id, reason: "syntax", detail, line });
    return;
  }
  const problem = renderedProblem(svg);
  if (problem) post({ type: "failed", id: request.id, reason: problem, detail: "" });
  else post({ type: "rendered", id: request.id, svg });
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent || !isDiagramRequest(event.data)) return;
  const request = event.data;
  queue = queue.then(() => render(request));
});

post({ type: "ready" });
