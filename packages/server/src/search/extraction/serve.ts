import { parentPort } from "node:worker_threads";
import { extractSections } from "./extract.js";
import type { ExtractableFormat } from "./text.js";

export interface ExtractionRequest {
  format: ExtractableFormat;
  data: Uint8Array;
  maxCharacters: number;
}

export function serve(): void {
  parentPort?.once("message", (request: ExtractionRequest) => {
    extractSections(request.format, request.data, request.maxCharacters).then(
      (outcome) => parentPort?.postMessage(outcome),
      () => parentPort?.postMessage({ status: "skipped", reason: "unreadable" }),
    );
  });
}
