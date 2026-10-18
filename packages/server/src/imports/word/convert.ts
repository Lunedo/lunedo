import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { WordConversionReply, WordConversionRequest } from "./convert-serve.js";

export interface WordConversionLimits {
  readonly maxHeapMb: number;
  readonly timeoutMs: number;
}

export const WORD_CONVERSION_LIMITS: WordConversionLimits = { maxHeapMb: 768, timeoutMs: 120_000 };

export type WordConversion = WordConversionReply | { status: "tooLarge" };

const WORKER_URL = new URL(`./convert-worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url);
const YOUNG_GENERATION_MB = 32;
const STACK_MB = 4;

export function convertInWorker(
  request: WordConversionRequest,
  limits: WordConversionLimits = WORD_CONVERSION_LIMITS,
): Promise<WordConversion> {
  const worker = new Worker(WORKER_URL, {
    resourceLimits: {
      maxOldGenerationSizeMb: limits.maxHeapMb,
      maxYoungGenerationSizeMb: YOUNG_GENERATION_MB,
      stackSizeMb: STACK_MB,
    },
    stdout: true,
    stderr: true,
  });
  worker.stdout.resume();
  worker.stderr.resume();
  return new Promise<WordConversion>((resolve) => {
    let settled = false;
    const finish = (result: WordConversion) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ status: "tooLarge" }), limits.timeoutMs);
    worker.once("message", (reply: WordConversionReply) => finish(reply));
    worker.once("error", (error: Error & { code?: string }) =>
      finish(error.code === "ERR_WORKER_OUT_OF_MEMORY" ? { status: "tooLarge" } : { status: "damaged" }),
    );
    worker.once("exit", () => finish({ status: "damaged" }));
    worker.postMessage(request, [request.zip.buffer]);
  });
}
