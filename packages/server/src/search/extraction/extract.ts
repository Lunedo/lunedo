import { ImportFormatError } from "../../imports/errors.js";
import { extractDocx, extractXlsx } from "./office.js";
import { EncryptedFileError, extractPdf } from "./pdf.js";
import {
  type ExtractableFormat,
  type ExtractionOutcome,
  type SkipReason,
  TextCollector,
  TextLimitReached,
} from "./text.js";

const ARCHIVE_LIMIT_CODES = new Set(["tooManyEntries", "archiveTooLarge", "compressionRatio"]);

function reasonOf(error: unknown): SkipReason {
  if (error instanceof EncryptedFileError) return "encrypted";
  if (error instanceof ImportFormatError) {
    if (error.code === "encryptedEntry") return "encrypted";
    if (ARCHIVE_LIMIT_CODES.has(error.code)) return "archiveLimits";
  }
  return "unreadable";
}

export async function extractSections(
  format: ExtractableFormat,
  data: Uint8Array,
  maxCharacters: number,
): Promise<ExtractionOutcome> {
  const collector = new TextCollector(maxCharacters);
  let truncated = false;
  try {
    if (format === "pdf") await extractPdf(data, collector);
    else if (format === "docx") await extractDocx(data, collector);
    else await extractXlsx(data, collector, maxCharacters);
  } catch (error) {
    if (!(error instanceof TextLimitReached)) return { status: "skipped", reason: reasonOf(error) };
    truncated = true;
  }
  return { status: "extracted", sections: collector.sections(), truncated };
}
