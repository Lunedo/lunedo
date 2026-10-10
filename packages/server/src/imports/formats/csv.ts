import { StringDecoder } from "node:string_decoder";
import { ImportFormatError } from "../errors.js";

export interface CsvLimits {
  readonly maxFieldBytes: number;
  readonly maxRowBytes: number;
  readonly maxFields: number;
}

export const DEFAULT_CSV_LIMITS: CsvLimits = {
  maxFieldBytes: 16 * 1024 * 1024,
  maxRowBytes: 32 * 1024 * 1024,
  maxFields: 1000,
};

const QUOTE = 34;
const COMMA = 44;
const CR = 13;
const LF = 10;

class RowBuilder {
  readonly fields: string[] = [];
  #field: Buffer[] = [];
  #fieldBytes = 0;
  #rowBytes = 0;

  constructor(private readonly limits: CsvLimits) {}

  get empty(): boolean {
    return this.fields.length === 0 && this.#fieldBytes === 0;
  }

  append(chunk: Buffer, start: number, end: number): void {
    if (end <= start) return;
    const length = end - start;
    this.#fieldBytes += length;
    this.#rowBytes += length;
    if (this.#fieldBytes > this.limits.maxFieldBytes) {
      throw new ImportFormatError("csvFieldTooLarge", "A CSV field is larger than the limit.");
    }
    if (this.#rowBytes > this.limits.maxRowBytes) {
      throw new ImportFormatError("csvRowTooLarge", "A CSV row is larger than the limit.");
    }
    this.#field.push(chunk.subarray(start, end));
  }

  endField(): void {
    if (this.fields.length >= this.limits.maxFields) {
      throw new ImportFormatError("csvTooManyFields", "A CSV row has more fields than the limit.");
    }
    const decoder = new StringDecoder("utf8");
    let text = "";
    for (const part of this.#field) text += decoder.write(part);
    text += decoder.end();
    this.fields.push(text);
    this.#field = [];
    this.#fieldBytes = 0;
  }

  take(): string[] {
    const row = this.fields.splice(0);
    this.#rowBytes = 0;
    return row;
  }
}

export async function* readCsvRows(
  source: AsyncIterable<Buffer | Uint8Array | string>,
  limits: CsvLimits = DEFAULT_CSV_LIMITS,
): AsyncGenerator<string[]> {
  const row = new RowBuilder(limits);
  let quoted = false;
  let quotePending = false;
  let fieldStarted = false;
  let skipLf = false;
  let first = true;
  for await (const piece of source) {
    let chunk = typeof piece === "string" ? Buffer.from(piece, "utf8") : Buffer.from(piece);
    if (first && chunk.length > 0) {
      first = false;
      if (chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf) chunk = chunk.subarray(3);
    }
    let start = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      const byte = chunk[index];
      if (skipLf) {
        skipLf = false;
        if (byte === LF) {
          start = index + 1;
          continue;
        }
      }
      if (quoted) {
        if (quotePending) {
          quotePending = false;
          if (byte === QUOTE) {
            row.append(chunk, index, index + 1);
            start = index + 1;
            continue;
          }
          quoted = false;
        } else {
          if (byte === QUOTE) {
            row.append(chunk, start, index);
            quotePending = true;
            start = index + 1;
          }
          continue;
        }
      }
      if (byte === QUOTE && !fieldStarted) {
        quoted = true;
        fieldStarted = true;
        start = index + 1;
        continue;
      }
      if (byte === COMMA) {
        row.append(chunk, start, index);
        row.endField();
        fieldStarted = false;
        start = index + 1;
        continue;
      }
      if (byte === CR || byte === LF) {
        row.append(chunk, start, index);
        if (fieldStarted || !row.empty) {
          row.endField();
          yield row.take();
        }
        fieldStarted = false;
        skipLf = byte === CR;
        start = index + 1;
        continue;
      }
      fieldStarted = true;
    }
    if (quoted && !quotePending) row.append(chunk, start, chunk.length);
    else if (!quoted) row.append(chunk, start, chunk.length);
  }
  if (quoted && !quotePending) {
    throw new ImportFormatError("csvUnterminatedQuote", "A quoted CSV field is not closed.");
  }
  if (fieldStarted || !row.empty) {
    row.endField();
    yield row.take();
  }
}

export async function* readCsvRecords(
  source: AsyncIterable<Buffer | Uint8Array | string>,
  limits: CsvLimits = DEFAULT_CSV_LIMITS,
): AsyncGenerator<Record<string, string>> {
  let header: string[] | null = null;
  for await (const row of readCsvRows(source, limits)) {
    if (header === null) {
      header = row.map((name) => name.trim());
      continue;
    }
    const record: Record<string, string> = Object.create(null);
    for (const [index, name] of header.entries()) record[name] = row[index] ?? "";
    yield record;
  }
}

export function spreadsheetCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
