import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compares two secrets in constant time. Both values are hashed first so that neither
 * the content nor the length of the expected secret leaks through timing.
 */
export function secretsEqual(actual: string, expected: string): boolean {
  const a = createHash("sha256").update(actual, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}
