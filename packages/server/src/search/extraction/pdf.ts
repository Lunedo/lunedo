import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextCollector } from "./text.js";

export class EncryptedFileError extends Error {
  override name = "EncryptedFileError";
}

interface TextItem {
  str?: string;
  hasEOL?: boolean;
}

export async function extractPdf(data: Uint8Array, collector: TextCollector): Promise<void> {
  const task = getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    disableAutoFetch: true,
    stopAtErrors: false,
    verbosity: 0,
  });
  try {
    const document = await task.promise.catch((error: unknown) => {
      if (error instanceof Error && error.name === "PasswordException") {
        throw new EncryptedFileError("The PDF file needs a password");
      }
      throw error;
    });
    collector.section("");
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      for (const item of content.items as TextItem[]) {
        if (item.str) collector.append(item.str);
        if (item.hasEOL) collector.newline();
        else if (item.str) collector.append(" ");
      }
      collector.newline();
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
}
