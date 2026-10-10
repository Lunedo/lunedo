import { StringDecoder } from "node:string_decoder";
import { decodeHTML } from "entities/decode";
import { Parser } from "htmlparser2";
import { ImportFormatError } from "../errors.js";

export interface XmlLimits {
  readonly maxDepth: number;
  readonly maxElementBytes: number;
  readonly maxTokenBytes: number;
  readonly maxAttributes: number;
}

export const DEFAULT_XML_LIMITS: XmlLimits = {
  maxDepth: 256,
  maxElementBytes: 64 * 1024 * 1024,
  maxTokenBytes: 1024 * 1024,
  maxAttributes: 256,
};

export interface XmlHandler {
  open?(name: string, attributes: Readonly<Record<string, string>>, depth: number): void;
  text?(text: string, depth: number): void;
  close?(name: string, depth: number): void;
}

const CHUNK_CHARACTERS = 64 * 1024;

export function decodeCharacterReferences(text: string): string {
  return text.includes("&") ? decodeHTML(text) : text;
}

class LimitedHandler {
  depth = 0;
  readonly #sizes: number[] = [];
  #cdata = false;
  #failure: Error | null = null;
  lastEvent = 0;

  constructor(
    private readonly handler: XmlHandler,
    private readonly limits: XmlLimits,
  ) {}

  get failure(): Error | null {
    return this.#failure;
  }

  fail(error: Error): void {
    this.#failure ??= error;
  }

  #grow(bytes: number): void {
    const index = this.#sizes.length - 1;
    if (index < 0) return;
    const size = (this.#sizes[index] ?? 0) + bytes;
    this.#sizes[index] = size;
    if (size > this.limits.maxElementBytes) {
      throw new ImportFormatError("xmlElementTooLarge", "An element in the export is larger than the limit.");
    }
  }

  open(name: string, attributes: Record<string, string>): void {
    if (this.depth + 1 > this.limits.maxDepth) {
      throw new ImportFormatError("xmlTooDeep", "The export nests elements deeper than the limit.");
    }
    const names = Object.keys(attributes);
    if (names.length > this.limits.maxAttributes) {
      throw new ImportFormatError("xmlElementTooLarge", "An element in the export has too many attributes.");
    }
    let bytes = name.length;
    const decoded: Record<string, string> = Object.create(null);
    for (const key of names) {
      const value = attributes[key] ?? "";
      bytes += key.length + value.length;
      decoded[key] = decodeCharacterReferences(value);
    }
    this.depth += 1;
    this.#sizes.push(bytes);
    if (bytes > this.limits.maxElementBytes) {
      throw new ImportFormatError("xmlElementTooLarge", "An element in the export is larger than the limit.");
    }
    this.handler.open?.(name, decoded, this.depth);
  }

  text(data: string): void {
    this.#grow(data.length);
    this.handler.text?.(this.#cdata ? data : decodeCharacterReferences(data), this.depth);
  }

  close(name: string): void {
    this.#sizes.pop();
    this.handler.close?.(name, this.depth);
    this.depth -= 1;
  }

  cdata(inside: boolean): void {
    this.#cdata = inside;
  }
}

function guard(limited: LimitedHandler, parser: { endIndex: number }, work: () => void): void {
  if (limited.failure) return;
  try {
    work();
    limited.lastEvent = parser.endIndex;
  } catch (error) {
    limited.fail(error as Error);
  }
}

export async function parseXml(
  source: AsyncIterable<Buffer | string> | Iterable<Buffer | string>,
  handler: XmlHandler,
  limits: XmlLimits = DEFAULT_XML_LIMITS,
): Promise<void> {
  const limited = new LimitedHandler(handler, limits);
  const parser: Parser = new Parser(
    {
      onopentag: (name, attributes) => guard(limited, parser, () => limited.open(name, attributes)),
      ontext: (data) => guard(limited, parser, () => limited.text(data)),
      onclosetag: (name) => guard(limited, parser, () => limited.close(name)),
      oncdatastart: () => guard(limited, parser, () => limited.cdata(true)),
      oncdataend: () => guard(limited, parser, () => limited.cdata(false)),
      oncomment: () => {
        limited.lastEvent = parser.endIndex;
      },
      onprocessinginstruction: (name) =>
        guard(limited, parser, () => {
          if (name.startsWith("!")) {
            throw new ImportFormatError(
              "xmlDeclaration",
              "The export contains a document type or entity declaration.",
            );
          }
        }),
    },
    { xmlMode: true, decodeEntities: false, recognizeSelfClosing: true, lowerCaseTags: false },
  );
  const decoder = new StringDecoder("utf8");
  let written = 0;
  const write = (text: string) => {
    for (let index = 0; index < text.length; index += CHUNK_CHARACTERS) {
      const piece = text.slice(index, index + CHUNK_CHARACTERS);
      parser.write(piece);
      written += piece.length;
      if (limited.failure) throw limited.failure;
      if (written - limited.lastEvent > limits.maxTokenBytes) {
        throw new ImportFormatError("xmlElementTooLarge", "A tag in the export is larger than the limit.");
      }
    }
  };
  let first = true;
  for await (const chunk of source) {
    let text = typeof chunk === "string" ? chunk : decoder.write(chunk);
    if (first && text.length > 0) {
      first = false;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    write(text);
  }
  write(decoder.end());
  parser.end();
  if (limited.failure) throw limited.failure;
}

export interface XmlNode {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: (XmlNode | string)[];
}

export async function parseXmlFragment(
  xml: string,
  limits: XmlLimits = DEFAULT_XML_LIMITS,
): Promise<XmlNode> {
  const root: XmlNode = { name: "#root", attributes: {}, children: [] };
  const stack: XmlNode[] = [root];
  await parseXml(
    [xml],
    {
      open(name, attributes) {
        const node: XmlNode = { name, attributes, children: [] };
        stack.at(-1)?.children.push(node);
        stack.push(node);
      },
      text(text) {
        const children = stack.at(-1)?.children;
        if (!children) return;
        const last = children.at(-1);
        if (typeof last === "string") children[children.length - 1] = last + text;
        else children.push(text);
      },
      close() {
        stack.pop();
      },
    },
    limits,
  );
  return root;
}
