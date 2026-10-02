import type { TFunction } from "i18next";

type Untyped = (key: string, options?: Record<string, unknown>) => string;

export function translateKey(t: TFunction, key: string, options?: Record<string, unknown>): string {
  return (t as unknown as Untyped)(key, options);
}
