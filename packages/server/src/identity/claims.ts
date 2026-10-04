export interface ReceivedClaim {
  name: string;
  values: string[];
}

const WITHHELD = /token|secret|password|passw|pwd|hash|nonce|code_verifier|assertion|signature|^sid$/i;
const MAX_CLAIMS = 100;
const MAX_VALUES = 50;
const MAX_LENGTH = 500;

export function isWithheldClaim(name: string): boolean {
  return WITHHELD.test(name);
}

function shorten(value: string): string {
  return value.length > MAX_LENGTH ? `${value.slice(0, MAX_LENGTH)}…` : value;
}

function withoutWithheld(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutWithheld);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !isWithheldClaim(key))
        .map(([key, item]) => [key, withoutWithheld(item)]),
    );
  }
  return value;
}

function textOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(withoutWithheld(value));
}

export function receivedClaims(source: Record<string, unknown> | ReadonlyMap<string, readonly unknown[]>) {
  const entries: [string, unknown[]][] =
    source instanceof Map
      ? [...source.entries()].map(([name, values]) => [name, [...values]])
      : Object.entries(source).map(([name, value]) => [name, Array.isArray(value) ? value : [value]]);
  return entries
    .filter(([name]) => !isWithheldClaim(name))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MAX_CLAIMS)
    .map(
      ([name, values]): ReceivedClaim => ({
        name,
        values: values
          .map(textOf)
          .filter((value): value is string => value !== null)
          .slice(0, MAX_VALUES)
          .map(shorten),
      }),
    );
}
