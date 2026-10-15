import { PassThrough } from "node:stream";
import { buffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import yauzl from "yauzl";
import { type ArchiveEntry, zipArchive } from "./archive.js";

const CHUNK = 1024 * 1024;

async function until(condition: () => boolean): Promise<void> {
  while (!condition()) await new Promise((resolve) => setTimeout(resolve, 5));
}

async function names(data: Buffer): Promise<string[]> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(data, {}, (error, opened) => (error ? reject(error) : resolve(opened))),
  );
  const found: string[] = [];
  await new Promise<void>((resolve, reject) => {
    zip.on("entry", (entry: yauzl.Entry) => found.push(entry.fileName));
    zip.on("end", resolve);
    zip.on("error", reject);
  });
  return found;
}

describe("zip archives", () => {
  it("streams a file into the archive before the file has been read completely", async () => {
    const source = new PassThrough();
    const archive = zipArchive([
      { path: "large.bin", mtime: new Date(), compress: false, content: async () => source },
    ]);
    const output = new PassThrough();
    archive.pipe(output);
    let received = 0;
    output.on("data", (chunk: Buffer) => {
      received += chunk.length;
    });
    source.write(Buffer.alloc(CHUNK, 1));
    await until(() => received >= CHUNK);
    expect(source.writableEnded).toBe(false);
    source.end(Buffer.alloc(CHUNK, 2));
    await new Promise((resolve) => output.once("end", resolve));
    expect(received).toBeGreaterThan(2 * CHUNK);
  });

  it("opens each file only after the previous one was written", async () => {
    const opened: string[] = [];
    const sources = new Map<string, PassThrough>();
    const entries: ArchiveEntry[] = ["a.bin", "b.bin", "c.bin"].map((path) => ({
      path,
      mtime: new Date(),
      compress: false,
      content: async () => {
        opened.push(path);
        const source = new PassThrough();
        sources.set(path, source);
        return source;
      },
    }));
    const archive = zipArchive(entries);
    const collected = buffer(archive);
    await until(() => sources.has("a.bin"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(opened).toEqual(["a.bin"]);
    sources.get("a.bin")?.end(Buffer.alloc(CHUNK));
    await until(() => sources.has("b.bin"));
    expect(opened).toEqual(["a.bin", "b.bin"]);
    sources.get("b.bin")?.end(Buffer.alloc(CHUNK));
    await until(() => sources.has("c.bin"));
    sources.get("c.bin")?.end(Buffer.alloc(CHUNK));
    expect(await names(await collected)).toEqual(["a.bin", "b.bin", "c.bin"]);
  });
});
