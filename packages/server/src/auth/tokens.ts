import { createHash, randomBytes } from "node:crypto";

/** A random token of 256 bits, base64url-encoded, for cookies and links. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored as SHA-256 hashes only; they have enough entropy that no slow hash is needed. */
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/** Whether a string can be a token from `generateToken`, checked before any database lookup. */
export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
