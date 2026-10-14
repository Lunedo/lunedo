import { posix } from "node:path";
import { Parser } from "htmlparser2";
import { bufferSource } from "../../imports/formats/bytes.js";
import { ZipArchive, type ZipEntryLocation, type ZipLimits } from "../../imports/formats/zip.js";
import { EncryptedFileError } from "./pdf.js";
import type { TextCollector } from "./text.js";

export const OFFICE_ZIP_LIMITS: ZipLimits = {
  maxEntries: 10_000,
  maxTotalBytes: 512 * 1024 ** 2,
  maxEntryBytes: 256 * 1024 ** 2,
  maxRatio: 200,
  ratioThresholdBytes: 1024 * 1024,
  maxNameBytes: 1024,
};

const COMPOUND_FILE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const MAX_SHARED_STRINGS = 1_000_000;

interface XmlHandlers {
  open?(name: string, attributes: Record<string, string>): void;
  text?(text: string): void;
  close?(name: string): void;
}

function localName(name: string): string {
  return name.slice(name.indexOf(":") + 1);
}

class OfficeArchive {
  readonly #archive: ZipArchive;
  readonly #entries: Map<string, ZipEntryLocation>;

  private constructor(archive: ZipArchive, entries: Map<string, ZipEntryLocation>) {
    this.#archive = archive;
    this.#entries = entries;
  }

  static async open(data: Uint8Array, limits: ZipLimits): Promise<OfficeArchive> {
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    if (buffer.subarray(0, COMPOUND_FILE.length).equals(COMPOUND_FILE)) {
      throw new EncryptedFileError("The Office file is encrypted");
    }
    const archive = await ZipArchive.open(bufferSource(buffer), limits);
    const entries = new Map<string, ZipEntryLocation>();
    for await (const entry of archive.entries()) entries.set(entry.name.toLowerCase(), entry.location);
    return new OfficeArchive(archive, entries);
  }

  has(name: string): boolean {
    return this.#entries.has(name.toLowerCase());
  }

  async read(name: string, handlers: XmlHandlers): Promise<void> {
    const location = this.#entries.get(name.toLowerCase());
    if (!location) return;
    const stream = await this.#archive.openAt(location);
    const parser = new Parser(
      {
        onopentag: (tag, attributes) => handlers.open?.(localName(tag), attributes),
        ontext: (text) => handlers.text?.(text),
        onclosetag: (tag) => handlers.close?.(localName(tag)),
      },
      { xmlMode: true, decodeEntities: true },
    );
    const decoder = new TextDecoder("utf-8");
    try {
      for await (const chunk of stream) parser.write(decoder.decode(chunk as Buffer, { stream: true }));
      parser.write(decoder.decode());
      parser.end();
    } finally {
      stream.destroy();
    }
  }
}

export async function extractDocx(
  data: Uint8Array,
  collector: TextCollector,
  limits: ZipLimits = OFFICE_ZIP_LIMITS,
): Promise<void> {
  const archive = await OfficeArchive.open(data, limits);
  if (!archive.has("word/document.xml")) throw new Error("The Word file has no document part");
  collector.section("");
  for (const part of ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"]) {
    let inText = 0;
    await archive.read(part, {
      open(name) {
        if (name === "t") inText += 1;
        else if (name === "tab") collector.append(" ");
        else if (name === "br" || name === "cr") collector.newline();
      },
      text(text) {
        if (inText > 0) collector.append(text);
      },
      close(name) {
        if (name === "t") inText = Math.max(0, inText - 1);
        else if (name === "p") collector.newline();
        else if (name === "tc") collector.append(" ");
      },
    });
    collector.newline();
  }
}

interface Sheet {
  name: string;
  path: string;
}

async function workbookSheets(archive: OfficeArchive): Promise<Sheet[]> {
  const targets = new Map<string, string>();
  await archive.read("xl/_rels/workbook.xml.rels", {
    open(name, attributes) {
      if (name === "Relationship" && attributes.Id && attributes.Target) {
        targets.set(attributes.Id, attributes.Target);
      }
    },
  });
  const sheets: Sheet[] = [];
  await archive.read("xl/workbook.xml", {
    open(name, attributes) {
      if (name !== "sheet") return;
      const relation = Object.entries(attributes).find(([key]) => localName(key) === "id")?.[1];
      const target = relation ? targets.get(relation) : undefined;
      if (!target) return;
      const path = target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join("xl", target));
      sheets.push({ name: attributes.name ?? "", path });
    },
  });
  return sheets;
}

async function sharedStrings(archive: OfficeArchive, maximum: number): Promise<string[]> {
  const strings: string[] = [];
  let current: string[] | null = null;
  let inText = 0;
  let phonetic = 0;
  let total = 0;
  await archive.read("xl/sharedStrings.xml", {
    open(name) {
      if (name === "si") current = [];
      else if (name === "rPh") phonetic += 1;
      else if (name === "t") inText += 1;
    },
    text(text) {
      if (current && inText > 0 && phonetic === 0 && total < maximum) {
        current.push(text);
        total += text.length;
      }
    },
    close(name) {
      if (name === "t") inText = Math.max(0, inText - 1);
      else if (name === "rPh") phonetic = Math.max(0, phonetic - 1);
      else if (name === "si" && current) {
        if (strings.length < MAX_SHARED_STRINGS) strings.push(current.join(""));
        current = null;
      }
    },
  });
  return strings;
}

export async function extractXlsx(
  data: Uint8Array,
  collector: TextCollector,
  maxCharacters: number,
  limits: ZipLimits = OFFICE_ZIP_LIMITS,
): Promise<void> {
  const archive = await OfficeArchive.open(data, limits);
  if (!archive.has("xl/workbook.xml")) throw new Error("The Excel file has no workbook part");
  const sheets = await workbookSheets(archive);
  const strings = await sharedStrings(archive, maxCharacters);
  for (const sheet of sheets) {
    collector.section(sheet.name);
    let row: string[] = [];
    let type = "";
    let value: string[] = [];
    let collecting = false;
    let inline = 0;
    await archive.read(sheet.path, {
      open(name, attributes) {
        if (name === "c") {
          type = attributes.t ?? "n";
          value = [];
        } else if (name === "v") collecting = true;
        else if (name === "is") inline += 1;
        else if (name === "t" && inline > 0) collecting = true;
      },
      text(text) {
        if (collecting) value.push(text);
      },
      close(name) {
        if (name === "v" || name === "t") collecting = false;
        else if (name === "is") inline = Math.max(0, inline - 1);
        else if (name === "c") {
          const raw = value.join("").trim();
          const cell = type === "s" ? (strings[Number(raw)] ?? "") : type === "b" || type === "e" ? "" : raw;
          if (cell.length > 0) row.push(cell);
        } else if (name === "row") {
          if (row.length > 0) {
            collector.append(row.join(" "));
            collector.newline();
          }
          row = [];
        }
      },
    });
  }
}
