import type { Readable } from "node:stream";
import type { Principal } from "../accounts/principal.js";
import { OwnerSlots } from "../auth/concurrency.js";
import { FileTooLargeError } from "../files/files.js";

export interface MarkupBudget {
  elements: number;
  attributes: number;
}

const ATTRIBUTE_VALUE = /=[ \t\r\n]*["']/g;

export function takeMarkup(input: string, budget: MarkupBudget): boolean {
  for (let index = input.indexOf("<"); index !== -1; index = input.indexOf("<", index + 1)) {
    budget.elements -= 1;
    if (budget.elements < 0) return false;
  }
  ATTRIBUTE_VALUE.lastIndex = 0;
  while (ATTRIBUTE_VALUE.exec(input) !== null) {
    budget.attributes -= 1;
    if (budget.attributes < 0) return false;
  }
  return true;
}

export class SanitizerBusyError extends Error {
  override name = "SanitizerBusyError";
  readonly retryAfterSeconds = 2;

  constructor() {
    super(
      "Too many drawings and diagrams are being uploaded or checked at the moment; try again in a few seconds",
    );
  }
}

export const MAX_PARALLEL_SANITIZATIONS = 4;
export const MAX_PARALLEL_SANITIZATIONS_PER_ACCOUNT = 1;

export const sanitizerSlots = new OwnerSlots(
  MAX_PARALLEL_SANITIZATIONS,
  MAX_PARALLEL_SANITIZATIONS_PER_ACCOUNT,
  () => new SanitizerBusyError(),
);

export const MAX_PARALLEL_UPLOADS = 32;
export const MAX_PARALLEL_UPLOADS_PER_ACCOUNT = 2;

export const uploadSlots = new OwnerSlots(
  MAX_PARALLEL_UPLOADS,
  MAX_PARALLEL_UPLOADS_PER_ACCOUNT,
  () => new SanitizerBusyError(),
);

export function attributeWarning(level: string, message: string): boolean {
  return level === "warning" && /attribute/i.test(message);
}

export const UPLOAD_READ_TIMEOUT_MS = 30_000;

export class UploadTimeoutError extends Error {
  override name = "UploadTimeoutError";

  constructor(readonly timeoutMs: number) {
    super(`The upload did not arrive within ${Math.round(timeoutMs / 1000)} seconds`);
  }
}

export async function readDrawingUpload(owner: Principal, body: Readable, maxBytes: number): Promise<Buffer> {
  try {
    return await uploadSlots.run(owner, () => readUpload(body, maxBytes));
  } catch (error) {
    if (error instanceof SanitizerBusyError) body.resume();
    throw error;
  }
}

export async function readUpload(
  body: Readable,
  maxBytes: number,
  timeoutMs = UPLOAD_READ_TIMEOUT_MS,
): Promise<Buffer> {
  const timer = setTimeout(() => body.destroy(new UploadTimeoutError(timeoutMs)), timeoutMs);
  const parts: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of body) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      size += part.length;
      if (size > maxBytes) {
        body.destroy();
        throw new FileTooLargeError(maxBytes);
      }
      parts.push(part);
    }
  } finally {
    clearTimeout(timer);
  }
  return Buffer.concat(parts);
}
