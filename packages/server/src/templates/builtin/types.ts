import type { DocumentJson } from "@pagehall/editor-schema";
import type { Rhythm } from "../../meetings/schedule.js";
import type { ArticleType } from "../../spaces/schema.js";
import type { TemplateField } from "../fields.js";
import type { TemplateCategory } from "../schema.js";

export const templateLanguages = ["en", "de"] as const;
export type TemplateLanguage = (typeof templateLanguages)[number];

export interface BuiltInTemplateText {
  name: string;
  description: string;
  title: string;
  fields: TemplateField[];
  document: DocumentJson;
}

export interface SeriesDefaults {
  rhythm: Rhythm;
  durationMinutes: number;
}

export interface BuiltInTemplate {
  key: string;
  category: TemplateCategory;
  text: Record<TemplateLanguage, BuiltInTemplateText>;
  series?: SeriesDefaults;
  knowledgeBase?: boolean;
  articleType?: ArticleType;
}
