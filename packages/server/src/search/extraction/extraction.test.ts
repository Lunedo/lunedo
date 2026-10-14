import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TextExtractor } from "./extractor.js";
import {
  COMPOUND_FILE_HEADER,
  docxFile,
  inflatingPdfFile,
  markEncrypted,
  pdfFile,
  xlsxFile,
  zipFile,
} from "./files.testing.js";
import { type ExtractionOutcome, extractableFormat } from "./text.js";

const extractor = new TextExtractor();

function text(outcome: ExtractionOutcome): string {
  if (outcome.status !== "extracted") throw new Error(`Expected text, got ${outcome.reason}`);
  return outcome.sections.map((section) => `${section.heading}|${section.text}`).join("\n");
}

describe("attachment text extraction", () => {
  it("knows the three formats by their content type only", () => {
    expect(extractableFormat("application/pdf")).toBe("pdf");
    expect(extractableFormat("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(
      "docx",
    );
    expect(extractableFormat("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(
      "xlsx",
    );
    expect(extractableFormat("application/zip")).toBeNull();
    expect(extractableFormat("application/pdf; version=2")).toBeNull();
    expect(extractableFormat("text/plain")).toBeNull();
  });

  it("reads the text of every page of a PDF file", async () => {
    const outcome = await extractor.extract(
      "pdf",
      pdfFile([["Quarterly budget review", "Travel (domestic)"], ["Second page closes"]]),
    );
    expect(text(outcome)).toContain("Quarterly budget review");
    expect(text(outcome)).toContain("Travel (domestic)");
    expect(text(outcome)).toContain("Second page closes");
  });

  it("reads paragraphs, tabs and footnotes of a Word file", async () => {
    const outcome = await extractor.extract(
      "docx",
      await docxFile(["Onboarding checklist", "Laptop\tbadge & keys"], {
        footnotes: ["Ask facilities first"],
      }),
    );
    expect(text(outcome)).toBe("|Onboarding checklist\nLaptop badge & keys\nAsk facilities first");
  });

  it("reads every sheet of an Excel file with its name, shared strings and numbers", async () => {
    const outcome = await extractor.extract(
      "xlsx",
      await xlsxFile([
        {
          name: "Costs",
          rows: [
            ["Item", "Amount"],
            ["Licences", 1250],
          ],
        },
        { name: "Owners", rows: [["Licences", "Finance"]] },
      ]),
    );
    expect(outcome).toEqual({
      status: "extracted",
      truncated: false,
      sections: [
        { heading: "Costs", text: "Item Amount\nLicences 1250" },
        { heading: "Owners", text: "Licences Finance" },
      ],
    });
  });

  it("stops at the limit for the extracted text and keeps what came before", async () => {
    const limited = new TextExtractor({ maxCharacters: 40 });
    const outcome = await limited.extract(
      "docx",
      await docxFile(Array.from({ length: 50 }, (_, index) => `Paragraph number ${index}`)),
    );
    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.truncated).toBe(true);
    expect(outcome.sections.map((section) => section.text).join("").length).toBeLessThanOrEqual(40);
    expect(text(outcome)).toContain("Paragraph number 0");
  });

  it("skips encrypted PDF and Office files", async () => {
    expect(await extractor.extract("pdf", pdfFile([["Secret"]], { encrypted: true }))).toEqual({
      status: "skipped",
      reason: "encrypted",
    });
    const compound = Buffer.concat([COMPOUND_FILE_HEADER, randomBytes(4096)]);
    expect(await extractor.extract("docx", compound)).toEqual({ status: "skipped", reason: "encrypted" });
    expect(
      await extractor.extract("xlsx", markEncrypted(await xlsxFile([{ name: "A", rows: [["x"]] }]))),
    ).toEqual({ status: "skipped", reason: "encrypted" });
  });

  it("skips broken files of every format", async () => {
    const garbage = randomBytes(2048);
    for (const format of ["pdf", "docx", "xlsx"] as const) {
      expect(await extractor.extract(format, garbage)).toEqual({ status: "skipped", reason: "unreadable" });
    }
    const truncated = (await docxFile(["Cut off in the middle"])).subarray(0, 200);
    expect(await extractor.extract("docx", truncated)).toEqual({ status: "skipped", reason: "unreadable" });
    const pdf = pdfFile([["Cut off"]]);
    expect(await extractor.extract("pdf", pdf.subarray(0, 60))).toEqual({
      status: "skipped",
      reason: "unreadable",
    });
    expect(await extractor.extract("docx", await zipFile({ "readme.txt": "no document part" }))).toEqual({
      status: "skipped",
      reason: "unreadable",
    });
  });

  it("skips files over the size limit without reading them", async () => {
    const small = new TextExtractor({ maxBytes: 1024 });
    expect(await small.extract("pdf", Buffer.alloc(2048))).toEqual({ status: "skipped", reason: "tooLarge" });
  });

  it("refuses ZIP bombs and archives with too many entries", async () => {
    const bomb = await docxFile(["Small"], {
      extra: { "word/media/padding.bin": Buffer.alloc(64 * 1024 * 1024) },
    });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(await extractor.extract("docx", bomb)).toEqual({ status: "skipped", reason: "archiveLimits" });
    const crowded: Record<string, string> = {};
    for (let index = 0; index < 10_001; index++) crowded[`xl/media/${index}.txt`] = "x";
    expect(await extractor.extract("xlsx", await zipFile(crowded))).toEqual({
      status: "skipped",
      reason: "archiveLimits",
    });
  });

  it("stops an extraction that runs into its time limit", async () => {
    const slow = new TextExtractor({ timeoutMs: 50 });
    const rows = Array.from({ length: 20_000 }, (_, index) => [`Row ${index}`, index, `Value ${index}`]);
    expect(await slow.extract("xlsx", await xlsxFile([{ name: "Large", rows }]))).toEqual({
      status: "skipped",
      reason: "timeLimit",
    });
  });

  it("stops an extraction that runs into its memory limit", async () => {
    const tight = new TextExtractor({ maxHeapMb: 4 });
    const rows = Array.from({ length: 20_000 }, (_, index) => [`Row ${index}`, `Value ${index}`]);
    expect(await tight.extract("xlsx", await xlsxFile([{ name: "Large", rows }]))).toEqual({
      status: "skipped",
      reason: "memoryLimit",
    });
  });

  it("stops an extraction whose buffers outside the heap grow beyond the memory limit", async () => {
    const tight = new TextExtractor({ maxHeapMb: 64 });
    const bomb = inflatingPdfFile(512 * 1024 * 1024);
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(await tight.extract("pdf", bomb)).toEqual({ status: "skipped", reason: "memoryLimit" });
    expect(text(await extractor.extract("pdf", inflatingPdfFile(1024)))).toContain("Inflated");
  });

  it("stops when the caller gives up", async () => {
    const controller = new AbortController();
    const running = extractor.extract("pdf", pdfFile([["Abort me"]]), controller.signal);
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: "ExtractionAbortedError" });
  });
});
