import {
  type DocumentJson,
  isTemplateId,
  type NodeJson,
  templateFieldKey,
  titlePatternFields,
} from "@pagehall/editor-schema";
import { sql } from "drizzle-orm";
import type { Transaction } from "../database/database.js";
import type { TemplateLanguage } from "../templates/builtin/types.js";
import {
  MAX_CHOICE_OPTIONS,
  MAX_TEMPLATE_FIELDS,
  type TemplateField,
  templateFieldsSchema,
} from "../templates/fields.js";
import type { TemplateCategory } from "../templates/schema.js";
import type { XmlNode } from "./formats/xml.js";

export const IMPORTED_TEMPLATE_CATEGORY: TemplateCategory = "knowledge";

const MAX_FIELD_TEXT = 100;
const CURRENT_DATE = "currentDate";
const DATE_LABEL: Readonly<Record<TemplateLanguage, string>> = { en: "Date", de: "Datum" };

export interface TemplateVariables {
  readonly fields: TemplateField[];
  readonly variables: ReadonlyMap<string, string>;
}

function elements(node: XmlNode): XmlNode[] {
  return node.children.filter((child): child is XmlNode => typeof child !== "string");
}

function fieldText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD_TEXT);
}

function choices(node: XmlNode): string[] {
  const options: string[] = [];
  for (const option of elements(node)) {
    if (option.name !== "at:option") continue;
    const value = fieldText(option.attributes["at:value"] ?? "");
    if (value.length > 0 && !options.includes(value)) options.push(value);
  }
  return options.slice(0, MAX_CHOICE_OPTIONS);
}

export function templateVariables(root: XmlNode): TemplateVariables {
  const fields: TemplateField[] = [];
  const variables = new Map<string, string>();
  const declare = (name: string, field: () => Omit<TemplateField, "key" | "label" | "required">) => {
    if (variables.has(name)) return;
    const key = templateFieldKey(name);
    if (!key) return;
    const existing = fields.find((candidate) => candidate.key === key);
    if (!existing && fields.length >= MAX_TEMPLATE_FIELDS) return;
    variables.set(name, key);
    if (!existing) fields.push({ key, label: fieldText(name) || key, required: false, ...field() });
  };
  const visit = (node: XmlNode) => {
    for (const child of elements(node)) {
      const name = child.attributes["at:name"] ?? "";
      if (child.name === "at:declarations") {
        for (const declaration of elements(child)) {
          const declared = declaration.attributes["at:name"] ?? "";
          if (declaration.name === "at:list") {
            const options = choices(declaration);
            declare(declared, () => (options.length > 0 ? { type: "choice", options } : { type: "text" }));
          } else if (declaration.name === "at:string" || declaration.name === "at:textarea") {
            declare(declared, () => ({ type: "text" }));
          }
        }
        continue;
      }
      if (child.name === "at:var") declare(name, () => ({ type: "text" }));
      visit(child);
    }
  };
  visit(root);
  return { fields, variables };
}

export function mergeFields(
  declared: readonly TemplateField[],
  added: readonly TemplateField[],
): TemplateField[] {
  const keys = new Set(declared.map((field) => field.key));
  return [...declared, ...added.filter((field) => !keys.has(field.key))].slice(0, MAX_TEMPLATE_FIELDS);
}

function buttonFields(node: NodeJson, found: Map<string, Set<string>>): void {
  if (node.type === "templateButton") {
    const templateId = node.attrs?.templateId;
    const title = node.attrs?.title;
    if (typeof templateId === "string" && isTemplateId(templateId) && !templateId.startsWith("builtin:")) {
      const keys = found.get(templateId) ?? new Set<string>();
      for (const key of titlePatternFields(typeof title === "string" ? title : "")) keys.add(key);
      found.set(templateId, keys);
    }
  }
  for (const child of node.content ?? []) buttonFields(child, found);
}

export async function addButtonFields(
  tx: Transaction,
  document: DocumentJson,
  language: TemplateLanguage,
): Promise<void> {
  const found = new Map<string, Set<string>>();
  buttonFields(document, found);
  for (const [templateId, keys] of found) {
    if (keys.size === 0) continue;
    const row = await tx.execute<{ fields: unknown }>(
      sql`select fields from page_templates where id = ${templateId} for update`,
    );
    const stored = row.rows[0];
    if (!stored) continue;
    const parsed = templateFieldsSchema.safeParse(stored.fields);
    if (!parsed.success) continue;
    const fields = [...parsed.data];
    for (const key of keys) {
      if (fields.length >= MAX_TEMPLATE_FIELDS || fields.some((field) => field.key === key)) continue;
      fields.push(
        key === CURRENT_DATE
          ? { key, label: DATE_LABEL[language], type: "date", required: false }
          : { key, label: key, type: "text", required: false },
      );
    }
    if (fields.length === parsed.data.length) continue;
    await tx.execute(sql`
      update page_templates set fields = ${JSON.stringify(fields)}::jsonb, updated_at = now() where id = ${templateId}`);
  }
}
