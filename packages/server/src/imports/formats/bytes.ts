import { PassThrough, pipeline, Readable, Transform, type TransformCallback } from "node:stream";
import { createGunzip } from "node:zlib";
import { ImportFormatError } from "../errors.js";

export interface ByteSource {
  readonly size: number;
  read(start: number, end: number): Promise<Readable>;
  close(): Promise<void>;
}

export function bufferSource(buffer: Buffer): ByteSource {
  return {
    size: buffer.length,
    async read(start, end) {
      const stream = new PassThrough();
      stream.end(buffer.subarray(start, end));
      return stream;
    },
    async close() {},
  };
}

export interface BundledFile {
  readonly name: string;
  readonly source: ByteSource;
}

export interface ByteBundle extends ByteSource {
  readonly files: readonly BundledFile[];
}

export function isBundle(source: ByteSource): source is ByteBundle {
  return Array.isArray((source as Partial<ByteBundle>).files);
}

export function bundleOf(files: readonly BundledFile[]): ByteBundle {
  return {
    files,
    size: files.reduce((sum, file) => sum + file.source.size, 0),
    async read() {
      throw new ImportFormatError("wrongFormat", "Several files cannot be read as one.");
    },
    async close() {
      await Promise.all(files.map((file) => file.source.close()));
    },
  };
}

export const EMPTY_SOURCE: ByteSource = {
  size: 0,
  async read() {
    return Readable.from([]);
  },
  async close() {},
};

export class ByteLimit extends Transform {
  #seen = 0;

  constructor(
    private readonly maximum: number,
    private readonly code: string,
    private readonly message: string,
  ) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.#seen += chunk.length;
    if (this.#seen > this.maximum) {
      callback(new ImportFormatError(this.code, this.message));
      return;
    }
    callback(null, chunk);
  }
}

const GZIP_MAGIC = [0x1f, 0x8b];

function expansionError(): ImportFormatError {
  return new ImportFormatError(
    "archiveTooLarge",
    "A compressed file in the export expands beyond the limit.",
  );
}

function gunzip(source: AsyncIterable<Buffer>): AsyncIterable<Buffer> {
  const output = createGunzip();
  pipeline(Readable.from(source), output, () => {});
  return output;
}

export async function* gunzipIfCompressed(
  stream: AsyncIterable<Buffer>,
  maxBytes: number,
): AsyncGenerator<Buffer> {
  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) return;
  const head = first.value;
  async function* all(): AsyncGenerator<Buffer> {
    yield head;
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  }
  const compressed = head[0] === GZIP_MAGIC[0] && head[1] === GZIP_MAGIC[1];
  const chunks: AsyncIterable<Buffer> = compressed ? gunzip(all()) : all();
  let seen = 0;
  for await (const chunk of chunks) {
    seen += chunk.length;
    if (seen > maxBytes) throw expansionError();
    yield chunk;
  }
}
