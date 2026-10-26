import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { MAX_CHUNK_LENGTH, MAX_CHUNKS_PER_SOURCE } from "../chunks.js";
import type { ExtractionRequest } from "./serve.js";
import type { ExtractableFormat, ExtractionOutcome, SkipReason } from "./text.js";

export interface ExtractionLimits {
  maxBytes: number;
  maxCharacters: number;
  timeoutMs: number;
  maxHeapMb: number;
}

export const DEFAULT_EXTRACTION_LIMITS: ExtractionLimits = {
  maxBytes: 50 * 1024 * 1024,
  maxCharacters: MAX_CHUNK_LENGTH * MAX_CHUNKS_PER_SOURCE,
  timeoutMs: 30_000,
  maxHeapMb: 256,
};

const WORKER_URL = new URL(`./extraction-worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url);
const YOUNG_GENERATION_MB = 32;
const STACK_MB = 4;
const MEMORY_CHECK_MS = 25;
const MEGABYTE = 1024 * 1024;

export class ExtractionAbortedError extends Error {
  override name = "ExtractionAbortedError";
}

export class TextExtractor {
  readonly limits: ExtractionLimits;

  constructor(limits: Partial<ExtractionLimits> = {}) {
    this.limits = { ...DEFAULT_EXTRACTION_LIMITS, ...limits };
  }

  async extract(
    format: ExtractableFormat,
    data: Uint8Array,
    signal?: AbortSignal,
  ): Promise<ExtractionOutcome> {
    if (data.byteLength > this.limits.maxBytes) return skipped("tooLarge");
    if (signal?.aborted) throw new ExtractionAbortedError("The extraction was stopped");
    const copy = new Uint8Array(data);
    const worker = new Worker(WORKER_URL, {
      resourceLimits: {
        maxOldGenerationSizeMb: this.limits.maxHeapMb,
        maxYoungGenerationSizeMb: YOUNG_GENERATION_MB,
        stackSizeMb: STACK_MB,
      },
      stdout: true,
      stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();
    return new Promise<ExtractionOutcome>((resolve, reject) => {
      let settled = false;
      const finish = (result: ExtractionOutcome | Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(watch);
        signal?.removeEventListener("abort", abort);
        void worker.terminate();
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      const timer = setTimeout(() => finish(skipped("timeLimit")), this.limits.timeoutMs);
      const watch = setInterval(() => {
        worker.getHeapStatistics().then(
          (statistics) => {
            if (statistics.used_heap_size + statistics.external_memory > this.limits.maxHeapMb * MEGABYTE) {
              finish(skipped("memoryLimit"));
            }
          },
          () => {},
        );
      }, MEMORY_CHECK_MS);
      const abort = () => finish(new ExtractionAbortedError("The extraction was stopped"));
      signal?.addEventListener("abort", abort, { once: true });
      worker.once("message", (outcome: ExtractionOutcome) => finish(outcome));
      worker.once("error", (error: Error & { code?: string }) =>
        finish(skipped(error.code === "ERR_WORKER_OUT_OF_MEMORY" ? "memoryLimit" : "unreadable")),
      );
      worker.once("exit", () => finish(skipped("unreadable")));
      const request: ExtractionRequest = { format, data: copy, maxCharacters: this.limits.maxCharacters };
      worker.postMessage(request, [copy.buffer]);
    });
  }
}

function skipped(reason: SkipReason): ExtractionOutcome {
  return { status: "skipped", reason };
}
