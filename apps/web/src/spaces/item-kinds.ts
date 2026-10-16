import type { TFunction } from "i18next";

export const knownItemKinds = [
  "page",
  "folder",
  "link",
  "blogPost",
  "meetingSeries",
  "meetingTopic",
  "whiteboard",
] as const;
export type KnownItemKind = (typeof knownItemKinds)[number];

export function knownItemKind(kind: string | null | undefined): KnownItemKind | null {
  return (knownItemKinds as readonly string[]).includes(kind ?? "") ? (kind as KnownItemKind) : null;
}

export function itemKindLabel(t: TFunction, kind: string | null | undefined): string {
  const known = knownItemKind(kind);
  return known ? t(`trash.kinds.${known}`) : t("trash.kinds.other");
}
