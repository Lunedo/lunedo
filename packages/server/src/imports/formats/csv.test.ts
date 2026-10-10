import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { gunzipIfCompressed } from "./bytes.js";
import { type CsvLimits, DEFAULT_CSV_LIMITS, readCsvRecords, readCsvRows, spreadsheetCell } from "./csv.js";

async function* chunks(text: string | Buffer, size = 3): AsyncGenerator<Buffer> {
  const bytes = typeof text === "string" ? Buffer.from(text, "utf8") : text;
  for (let index = 0; index < bytes.length; index += size) yield bytes.subarray(index, index + size);
}

async function rows(text: string, limits: Partial<CsvLimits> = {}, size = 3): Promise<string[][]> {
  const result: string[][] = [];
  for await (const row of readCsvRows(chunks(text, size), { ...DEFAULT_CSV_LIMITS, ...limits }))
    result.push(row);
  return result;
}

async function failure(text: string, limits: Partial<CsvLimits>): Promise<string> {
  try {
    await rows(text, limits);
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
  return "none";
}

describe("CSV rows", () => {
  it("reads quoted fields with commas, quotes and line breaks across chunk borders", async () => {
    const text = 'id,body\r\n1,"<p>a, ""b""</p>\r\n<p>c</p>"\r\n2,plain\n3,\n';
    for (const size of [1, 2, 3, 7, 1000]) {
      expect(await rows(text, {}, size)).toEqual([
        ["id", "body"],
        ["1", '<p>a, "b"</p>\r\n<p>c</p>'],
        ["2", "plain"],
        ["3", ""],
      ]);
    }
  });

  it("decodes multi-byte characters split between chunks", async () => {
    expect(await rows("name\nÜber Größe 😀\n", {}, 1)).toEqual([["name"], ["Über Größe 😀"]]);
  });

  it("skips a byte order mark and reads a last row without line break", async () => {
    expect(await rows("﻿a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("refuses fields above the field limit", async () => {
    const text = `a\n"${"x".repeat(200)}"\n`;
    expect(await failure(text, { maxFieldBytes: 100 })).toBe("csvFieldTooLarge");
    expect(await failure(text, { maxFieldBytes: 300 })).toBe("none");
  });

  it("refuses rows above the row limit", async () => {
    const text = `a,b,c\n${"x".repeat(60)},${"y".repeat(60)},${"z".repeat(60)}\n`;
    expect(await failure(text, { maxRowBytes: 150 })).toBe("csvRowTooLarge");
    expect(await failure(text, { maxRowBytes: 200 })).toBe("none");
  });

  it("refuses rows with more fields than the limit", async () => {
    expect(await failure(`${"a,".repeat(20)}a\n`, { maxFields: 10 })).toBe("csvTooManyFields");
  });

  it("refuses an unterminated quoted field", async () => {
    expect(await failure('a\n"open', {})).toBe("csvUnterminatedQuote");
  });

  it("maps records by the header", async () => {
    const records: Record<string, string>[] = [];
    for await (const record of readCsvRecords(chunks("id, title\n1,Home\n2\n"))) records.push({ ...record });
    expect(records).toEqual([
      { id: "1", title: "Home" },
      { id: "2", title: "" },
    ]);
  });
});

describe("compressed CSV files", () => {
  it("reads gzip and plain files alike", async () => {
    const plain = Buffer.from("a,b\n1,2\n");
    for (const input of [plain, gzipSync(plain)]) {
      const output: Buffer[] = [];
      for await (const chunk of gunzipIfCompressed(chunks(input, 4), 1000)) output.push(chunk);
      expect(Buffer.concat(output).toString()).toBe("a,b\n1,2\n");
    }
  });

  it("stops a file that expands beyond the limit", async () => {
    const bomb = gzipSync(Buffer.alloc(1024 * 1024));
    await expect(async () => {
      for await (const _ of gunzipIfCompressed(chunks(bomb, 1024), 64 * 1024)) {
      }
    }).rejects.toMatchObject({ code: "archiveTooLarge" });
  });
});

describe("spreadsheet cells", () => {
  it.each([
    ['=HYPERLINK("http://x")', '"\'=HYPERLINK(""http://x"")"'],
    ["+1", '"\'+1"'],
    ["-1", '"\'-1"'],
    ["@SUM(A1)", '"\'@SUM(A1)"'],
    ["\tcmd", '"\'\tcmd"'],
    ["\rcmd", '"\'\rcmd"'],
    ["plain", '"plain"'],
  ])("escapes %j", (value, expected) => {
    expect(spreadsheetCell(value)).toBe(expected);
  });
});
