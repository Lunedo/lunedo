export const extractableFormats = ["pdf", "docx", "xlsx"] as const;
export type ExtractableFormat = (typeof extractableFormats)[number];

export const skipReasons = [
  "tooLarge",
  "encrypted",
  "unreadable",
  "archiveLimits",
  "timeLimit",
  "memoryLimit",
] as const;
export type SkipReason = (typeof skipReasons)[number];

export interface ExtractedSection {
  heading: string;
  text: string;
}

export type ExtractionOutcome =
  | { status: "extracted"; sections: ExtractedSection[]; truncated: boolean }
  | { status: "skipped"; reason: SkipReason };

const CONTENT_TYPES: Record<string, ExtractableFormat> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

export const extractableContentTypes = Object.keys(CONTENT_TYPES);

export function extractableFormat(contentType: string): ExtractableFormat | null {
  return CONTENT_TYPES[contentType] ?? null;
}

export function codePointBoundary(text: string, at: number): number {
  const code = text.charCodeAt(at - 1);
  return code >= 0xd800 && code <= 0xdbff ? at - 1 : at;
}

export class TextLimitReached extends Error {
  override name = "TextLimitReached";
}

export class TextCollector {
  readonly #maximum: number;
  readonly #sections: ExtractedSection[] = [];
  #parts: string[] = [];
  #heading = "";
  #length = 0;

  constructor(maximum: number) {
    this.#maximum = maximum;
  }

  section(heading: string): void {
    this.#flush();
    this.#heading = heading;
  }

  append(text: string): void {
    if (text.length === 0) return;
    const room = this.#maximum - this.#length;
    if (text.length > room) {
      this.#parts.push(text.slice(0, codePointBoundary(text, Math.max(room, 0))));
      this.#length = this.#maximum;
      throw new TextLimitReached("The extracted text reached its limit");
    }
    this.#parts.push(text);
    this.#length += text.length;
  }

  newline(): void {
    const last = this.#parts[this.#parts.length - 1];
    if (last !== undefined && !last.endsWith("\n")) this.append("\n");
  }

  sections(): ExtractedSection[] {
    this.#flush();
    return this.#sections;
  }

  #flush(): void {
    const text = this.#parts.join("").trim();
    if (text.length > 0) this.#sections.push({ heading: this.#heading, text });
    this.#parts = [];
  }
}
