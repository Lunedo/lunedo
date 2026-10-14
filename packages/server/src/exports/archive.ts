import { PassThrough, Readable } from "node:stream";
import { ZipFile } from "yazl";

export interface ArchiveEntry {
  path: string;
  mtime: Date;
  compress: boolean;
  content: () => Promise<Readable | Buffer>;
}

class StartOnRead extends PassThrough {
  #start: (() => void) | null;

  constructor(start: (output: PassThrough) => void) {
    super();
    this.#start = () => start(this);
  }

  override _read(size: number): void {
    const start = this.#start;
    this.#start = null;
    start?.();
    super._read(size);
  }
}

export function zipArchive(entries: Iterable<ArchiveEntry>): Readable {
  return new StartOnRead((output) => {
    const zip = new ZipFile();
    const fail = (error: Error) => {
      if (!output.destroyed) output.destroy(error);
    };
    zip.on("error", fail);
    zip.outputStream.on("error", fail);
    zip.outputStream.pipe(output);
    for (const entry of entries) {
      zip.addReadStreamLazy(entry.path, { mtime: entry.mtime, compress: entry.compress }, (callback) => {
        if (output.destroyed) return;
        entry.content().then(
          (content) => {
            const stream = Buffer.isBuffer(content) ? Readable.from([content]) : content;
            stream.once("error", fail);
            callback(null, stream);
          },
          (error: unknown) => fail(error instanceof Error ? error : new Error(String(error))),
        );
      });
    }
    zip.end();
  });
}
