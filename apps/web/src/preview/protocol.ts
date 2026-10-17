export const PREVIEW_KINDS = [
  "image",
  "pdf",
  "video",
  "audio",
  "text",
  "code",
  "markdown",
  "csv",
  "svg",
  "word",
  "excel",
] as const;

export type FramePreviewKind = Exclude<(typeof PREVIEW_KINDS)[number], "image" | "video" | "audio">;

export interface PreviewLabels {
  page: string;
  sheet: string;
  truncated: string;
  failed: string;
  empty: string;
}

export interface RenderMessage {
  type: "render";
  kind: FramePreviewKind;
  name: string;
  bytes: ArrayBuffer;
  theme: "light" | "dark";
  labels: PreviewLabels;
  zoom?: number;
}

export type FrameMessage =
  | { type: "ready" }
  | { type: "rendered"; height: number }
  | { type: "failed"; reason: string };

export function isFrameMessage(value: unknown): value is FrameMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === "ready" || type === "rendered" || type === "failed";
}

export function isRenderMessage(value: unknown): value is RenderMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<RenderMessage>;
  return (
    message.type === "render" &&
    typeof message.kind === "string" &&
    (PREVIEW_KINDS as readonly string[]).includes(message.kind) &&
    message.bytes instanceof ArrayBuffer &&
    typeof message.name === "string" &&
    (message.zoom === undefined ||
      (Number.isInteger(message.zoom) && message.zoom >= MIN_ZOOM && message.zoom <= MAX_ZOOM))
  );
}

export const MAX_ROWS = 2000;
export const MIN_ZOOM = 25;
export const MAX_ZOOM = 400;

export function parseCsv(text: string, delimiter = ","): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += character;
      continue;
    }
    if (character === '"' && cell === "") quoted = true;
    else if (character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (rows.length > MAX_ROWS) return { rows: rows.slice(0, MAX_ROWS), truncated: true };
    } else cell += character;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return { rows, truncated: false };
}

export function delimiterOf(name: string, text: string): string {
  if (/\.tsv$/i.test(name)) return "\t";
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? undefined : text.indexOf("\n"));
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}
