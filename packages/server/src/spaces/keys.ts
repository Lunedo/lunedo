import { randomInt } from "node:crypto";

export const SPACE_KEY_PATTERN = /^[A-Z0-9]{2,10}$/;
export const SPACE_KEY_MAX_LENGTH = 10;

const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeSpaceKey(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidSpaceKey(value: string): boolean {
  return SPACE_KEY_PATTERN.test(value);
}

function words(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ß/g, "ss")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0);
}

export function suggestSpaceKey(name: string): string {
  const parts = words(name);
  let key: string;
  if (parts.length === 0) key = "SPACE";
  else if (parts.length === 1) key = (parts[0] as string).slice(0, 6);
  else {
    key = parts.map((word) => (word === word.toUpperCase() && /[A-Z]/.test(word) ? word : word[0])).join("");
    if (key.length < 2) key = (parts[0] as string).slice(0, 4);
  }
  key = key.toUpperCase().slice(0, SPACE_KEY_MAX_LENGTH);
  return key.length >= 2 ? key : `${key}S`.padEnd(2, "S");
}

export function* spaceKeyCandidates(base: string): Generator<string> {
  yield base;
  for (let number = 2; number < 10_000; number++) {
    const suffix = String(number);
    yield base.slice(0, SPACE_KEY_MAX_LENGTH - suffix.length) + suffix;
  }
}

export function randomPersonalSpaceKey(): string {
  let key = "P";
  for (let index = 0; index < 7; index++) key += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)];
  return key;
}
