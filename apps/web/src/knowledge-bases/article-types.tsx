import type { TFunction } from "i18next";
import { FileText, ListOrdered, type LucideIcon, TriangleAlert } from "lucide-react";
import { translateKey } from "../i18n/translate.js";
import type { ArticleType } from "./queries.js";

export const ARTICLE_TYPES: readonly ArticleType[] = ["howTo", "troubleshooting"];

const TYPE_ICONS: Record<ArticleType, LucideIcon> = { howTo: ListOrdered, troubleshooting: TriangleAlert };

export function knownArticleType(type: string | null | undefined): ArticleType | null {
  return (ARTICLE_TYPES as readonly string[]).includes(type ?? "") ? (type as ArticleType) : null;
}

export function articleTypeIcon(type: string | null): LucideIcon {
  const known = knownArticleType(type);
  return known ? TYPE_ICONS[known] : FileText;
}

export function articleTypeLabel(t: TFunction, type: string | null): string {
  const known = knownArticleType(type);
  if (known) return translateKey(t, `knowledgeBase.articleTypes.${known}`);
  return type ? t("knowledgeBase.articleTypes.other") : t("knowledgeBase.articleTypes.none");
}
