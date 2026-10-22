import { randomBytes } from "node:crypto";
import { crc32 } from "node:zlib";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const PREFIX = "ld_";
const SECRET_LENGTH = 43;
const CHECKSUM_LENGTH = 6;
const PATTERN = new RegExp(`^${PREFIX}[0-9A-Za-z]{${SECRET_LENGTH}}[0-9A-Za-z]{${CHECKSUM_LENGTH}}$`);

function base62(value: bigint, length: number): string {
  let result = "";
  let rest = value;
  while (rest > 0n) {
    result = ALPHABET[Number(rest % 62n)] + result;
    rest /= 62n;
  }
  return result.padStart(length, "0");
}

function checksum(body: string): string {
  return base62(BigInt(crc32(body)), CHECKSUM_LENGTH);
}

export function generateApiToken(): string {
  const secret = base62(BigInt(`0x${randomBytes(32).toString("hex")}`), SECRET_LENGTH);
  const body = `${PREFIX}${secret}`;
  return `${body}${checksum(body)}`;
}

export function isValidApiTokenFormat(token: string): boolean {
  if (!PATTERN.test(token)) return false;
  const body = token.slice(0, PREFIX.length + SECRET_LENGTH);
  return token.slice(PREFIX.length + SECRET_LENGTH) === checksum(body);
}

export function apiTokenPrefix(token: string): string {
  return token.slice(0, PREFIX.length + 6);
}
