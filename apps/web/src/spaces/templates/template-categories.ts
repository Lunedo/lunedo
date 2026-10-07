export const TEMPLATE_CATEGORIES = [
  "meetings",
  "decisions",
  "projects",
  "engineering",
  "operations",
  "knowledge",
  "teams",
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];
