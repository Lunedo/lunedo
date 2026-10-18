import { ApiError } from "../api/request.js";

export const BUSY_RETRIES = 5;
const DEFAULT_RETRY_SECONDS = 2;

export type Wait = (milliseconds: number) => Promise<void>;

const sleep: Wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function uploadQueue<T>(
  upload: (file: File) => Promise<T>,
  wait: Wait = sleep,
): (file: File) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  const attempt = async (file: File, retry: number): Promise<T> => {
    try {
      return await upload(file);
    } catch (failure) {
      if (!(failure instanceof ApiError) || failure.code !== "busy" || retry >= BUSY_RETRIES) throw failure;
      await wait((failure.problem.retryAfterSeconds ?? DEFAULT_RETRY_SECONDS) * 1000);
      return attempt(file, retry + 1);
    }
  };
  return (file) => {
    const result = tail.then(() => attempt(file, 0));
    tail = result.catch(() => undefined);
    return result;
  };
}
