import { type DocumentJson, extractSections } from "@pagehall/editor-schema";
import { codePointBoundary } from "./extraction/text.js";

export const MAX_CHUNK_LENGTH = 2000;
export const MAX_CHUNKS_PER_SOURCE = 500;

export interface ChunkText {
  heading: string;
  anchor: string | null;
  body: string;
}

export function cleanText(text: string): string {
  return text.replace(/[\p{Cc}\p{Cs}]/gu, (character) =>
    character === "\n" ? character : /\p{Cs}/u.test(character) ? "�" : " ",
  );
}

export function splitText(text: string, maximum: number = MAX_CHUNK_LENGTH): string[] {
  const pieces: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim().length > 0) pieces.push(current.trim());
    current = "";
  };
  for (const line of text.split("\n")) {
    let rest = line;
    while (rest.length > maximum) {
      const cut = rest.lastIndexOf(" ", maximum);
      const at = cut > maximum / 2 ? cut : codePointBoundary(rest, maximum);
      flush();
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at);
    }
    if (current.length + rest.length + 1 > maximum) flush();
    current = current.length > 0 ? `${current}\n${rest}` : rest;
  }
  flush();
  return pieces.filter((piece) => piece.length > 0);
}

export function documentChunks(document: DocumentJson): ChunkText[] {
  const chunks: ChunkText[] = [];
  for (const section of extractSections(document)) {
    const heading = cleanText(section.heading?.text ?? "");
    const anchor = section.heading?.id ?? null;
    const pieces = splitText(cleanText(section.text));
    if (pieces.length === 0) chunks.push({ heading, anchor, body: "" });
    for (const body of pieces) chunks.push({ heading, anchor, body });
  }
  if (chunks.length === 0) chunks.push({ heading: "", anchor: null, body: "" });
  return chunks.slice(0, MAX_CHUNKS_PER_SOURCE);
}

export function textChunks(text: string): ChunkText[] {
  return splitText(cleanText(text))
    .slice(0, MAX_CHUNKS_PER_SOURCE)
    .map((body) => ({ heading: "", anchor: null, body }));
}
