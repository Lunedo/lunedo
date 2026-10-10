import { buffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { createZip, type ZipFileSpec } from "../testing/zip-writer.js";
import { bufferSource } from "./bytes.js";
import { DEFAULT_ZIP_LIMITS, ZipArchive, type ZipLimits, type ZipProblem } from "./zip.js";

async function read(files: ZipFileSpec[], limits: Partial<ZipLimits> = {}) {
  const archive = await ZipArchive.open(bufferSource(createZip(files)), { ...DEFAULT_ZIP_LIMITS, ...limits });
  const problems: ZipProblem[] = [];
  const entries: { name: string; content: string }[] = [];
  for await (const entry of archive.entries((problem) => problems.push(problem))) {
    entries.push({ name: entry.name, content: (await buffer(await entry.open())).toString("utf8") });
  }
  return { entries, problems };
}

async function failure(files: ZipFileSpec[], limits: Partial<ZipLimits> = {}): Promise<string> {
  try {
    await read(files, limits);
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
  return "none";
}

describe("ZIP archives", () => {
  it("reads stored and deflated files in directory order", async () => {
    const { entries, problems } = await read([
      { name: "entities.xml", data: "<root/>" },
      { name: "attachments/1/2/1", data: "file content", deflate: true },
    ]);
    expect(entries).toEqual([
      { name: "entities.xml", content: "<root/>" },
      { name: "attachments/1/2/1", content: "file content" },
    ]);
    expect(problems).toEqual([]);
  });

  it.each([
    ["/etc/passwd"],
    ["../outside.txt"],
    ["attachments/../../outside.txt"],
    ["C:/Windows/system.ini"],
    ["c:relative.txt"],
    ["attachments\\..\\..\\outside.txt"],
    ["attachments//double"],
    ["./entities.xml"],
    ["name\u0000.xml"],
  ])("refuses the entry name %j", async (name) => {
    expect(await failure([{ name, data: "x" }])).toBe("unsafeEntryName");
  });

  it("refuses symbolic links", async () => {
    expect(await failure([{ name: "attachments/link", data: "/etc/passwd", symbolicLink: true }])).toBe(
      "unsafeEntryName",
    );
  });

  it("keeps the first of two entries with the same name and reports the second", async () => {
    const { entries, problems } = await read([
      { name: "entities.xml", data: "first" },
      { name: "entities.xml", data: "second" },
      { name: "attachments\\1\\2\\1", data: "a" },
      { name: "attachments/1/2/1", data: "b" },
    ]);
    expect(entries).toEqual([
      { name: "entities.xml", content: "first" },
      { name: "attachments/1/2/1", content: "a" },
    ]);
    expect(problems).toEqual([
      { code: "duplicateEntry", name: "entities.xml" },
      { code: "duplicateEntry", name: "attachments/1/2/1" },
    ]);
  });

  it("refuses more entries than the limit", async () => {
    const files = Array.from({ length: 6 }, (_, index) => ({ name: `file-${index}`, data: "x" }));
    expect(await failure(files, { maxEntries: 5 })).toBe("tooManyEntries");
    expect(await failure(files.slice(0, 5), { maxEntries: 5 })).toBe("none");
  });

  it("refuses archives that expand beyond the total limit", async () => {
    const files = [
      { name: "a", data: Buffer.alloc(600) },
      { name: "b", data: Buffer.alloc(600) },
    ];
    expect(await failure(files, { maxTotalBytes: 1000 })).toBe("archiveTooLarge");
    expect(await failure(files, { maxTotalBytes: 1200 })).toBe("none");
  });

  it("refuses entries with a compression ratio above the limit", async () => {
    const bomb = [{ name: "entities.xml", data: Buffer.alloc(4 * 1024 * 1024), deflate: true }];
    expect(await failure(bomb)).toBe("compressionRatio");
    expect(await failure(bomb, { maxRatio: 10_000 })).toBe("none");
  });

  it("stops reading an entry that is larger than its declared size", async () => {
    expect(await failure([{ name: "entities.xml", data: Buffer.alloc(5000), declaredSize: 10 }])).not.toBe(
      "none",
    );
  });

  it("refuses files that are not ZIP archives", async () => {
    await expect(ZipArchive.open(bufferSource(Buffer.from("not a zip file at all")))).rejects.toMatchObject({
      code: "notAnArchive",
    });
  });

  it("resumes after a given entry index", async () => {
    const archive = await ZipArchive.open(
      bufferSource(
        createZip([
          { name: "a", data: "1" },
          { name: "b", data: "2" },
          { name: "c", data: "3" },
        ]),
      ),
    );
    const names: string[] = [];
    for await (const entry of archive.entries(undefined, 1)) names.push(`${entry.index}:${entry.name}`);
    expect(names).toEqual(["1:b", "2:c"]);
  });
});
