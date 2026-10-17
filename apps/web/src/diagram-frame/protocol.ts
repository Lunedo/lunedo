export const TEXT_DIAGRAMS = ["mermaid", "plantuml"] as const;
export type TextDiagram = (typeof TEXT_DIAGRAMS)[number];

export const RENDER_TIMEOUT_MS = 10_000;
export const MAX_RENDERED_BYTES = 2 * 1024 * 1024;
export const MAX_RENDERED_SIZE = 20_000;

export type DiagramFailure = "syntax" | "include" | "htmlLabels" | "tooLarge" | "timeout" | "unavailable";

export interface DiagramRequest {
  type: "render";
  id: number;
  diagram: TextDiagram;
  source: string;
}

export type DiagramReply =
  | { type: "ready" }
  | { type: "rendered"; id: number; svg: string }
  | { type: "failed"; id: number; reason: DiagramFailure; detail: string };

export function isDiagramRequest(value: unknown): value is DiagramRequest {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<DiagramRequest>;
  return (
    message.type === "render" &&
    typeof message.id === "number" &&
    typeof message.source === "string" &&
    (TEXT_DIAGRAMS as readonly string[]).includes(message.diagram ?? "")
  );
}

export function isDiagramReply(value: unknown): value is DiagramReply {
  if (typeof value !== "object" || value === null) return false;
  const message = value as { type?: unknown; id?: unknown; svg?: unknown; reason?: unknown };
  if (message.type === "ready") return true;
  if (typeof message.id !== "number") return false;
  return (
    (message.type === "rendered" && typeof message.svg === "string") ||
    (message.type === "failed" && typeof message.reason === "string")
  );
}

const PLANTUML_FILE_ACCESS = [
  /^\s*!include[a-z_]*\b/im,
  /^\s*!import\b/im,
  /^\s*!theme\s+\S+\s+from\b/im,
  /%load_json\s*\(/i,
  /%get(all)?env\s*\(/i,
  /%file_exists\s*\(/i,
  /%dirpath\s*\(/i,
  /%filename\s*\(/i,
];

export function sourceProblem(diagram: TextDiagram, source: string): string | null {
  if (diagram !== "plantuml") return null;
  for (const pattern of PLANTUML_FILE_ACCESS) {
    const match = pattern.exec(source);
    if (match) return match[0].trim();
  }
  return null;
}

function length(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(px)?\s*$/.exec(value);
  return match ? Number(match[1]) : null;
}

export function svgSize(svg: string): { width: number | null; height: number | null } {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const attribute = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(root)?.[1];
  const box = (attribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return {
    width: length(attribute("width")) ?? (box.length === 4 && box[2] ? box[2] : null),
    height: length(attribute("height")) ?? (box.length === 4 && box[3] ? box[3] : null),
  };
}

export function renderedProblem(svg: string): DiagramFailure | null {
  if (new TextEncoder().encode(svg).length > MAX_RENDERED_BYTES) return "tooLarge";
  const { width, height } = svgSize(svg);
  if ((width ?? 0) > MAX_RENDERED_SIZE || (height ?? 0) > MAX_RENDERED_SIZE) return "tooLarge";
  if (/<foreignObject\b/i.test(svg)) return "htmlLabels";
  return null;
}
