import {
  type DocumentJson,
  editorSchemaVersion,
  type NodeJson,
  validateDocument,
} from "@pagehall/editor-schema";
import { isUuid, uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import { accountScopeChain } from "../accounts/scope.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Database, Executor } from "../database/database.js";
import { languageSetting } from "../settings/builtin.js";
import type { SettingsService } from "../settings/service.js";
import { actorIdOf, auditScopeOf, SpaceError } from "../spaces/common.js";
import { DocumentInvalidError, migrated, type PageDocumentService } from "../spaces/documents.js";
import type { Placement, TreeItem, TreeService } from "../spaces/items.js";
import type { PeopleService } from "../spaces/people.js";
import type { PageMode } from "../spaces/schema.js";
import { builtInTemplates } from "./builtin/index.js";
import { type TemplateLanguage, templateLanguages } from "./builtin/types.js";
import { type TemplateField, templateFieldsSchema } from "./fields.js";
import type { TemplateCategory, TemplateLevel } from "./schema.js";

export const TEMPLATE_NAME_MAX_LENGTH = 100;
export const TEMPLATE_DESCRIPTION_MAX_LENGTH = 300;
export const TEMPLATE_TITLE_MAX_LENGTH = 255;
export const TEMPLATE_VALUE_MAX_LENGTH = 200;
const BUILT_IN_PREFIX = "builtin:";
const TITLE_FIELD = /\{([a-z][a-zA-Z0-9]{0,39})\}/g;

export type TemplateSource = TemplateLevel | "builtIn";

export interface PageTemplate {
  id: string;
  level: TemplateSource;
  organizationId: string | null;
  spaceId: string | null;
  name: string;
  description: string;
  category: TemplateCategory;
  title: string;
  fields: TemplateField[];
  document: DocumentJson;
  updatedAt: Date | null;
}

export interface TemplateInput {
  name: string;
  description: string;
  category: TemplateCategory;
  title: string;
  fields: TemplateField[];
  document: unknown;
}

export type TemplateScope =
  | { level: "instance" }
  | { level: "organization"; organizationId: string }
  | { level: "space"; spaceId: string };

type TemplateRow = {
  id: string;
  level: TemplateLevel;
  organization_id: string | null;
  space_id: string | null;
  name: string;
  description: string;
  category: TemplateCategory;
  title: string;
  fields: unknown;
  document: unknown;
  schema_version: number;
  updated_at: Date | string;
};

function toTemplate(row: TemplateRow): PageTemplate {
  return {
    id: row.id,
    level: row.level,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    name: row.name,
    description: row.description,
    category: row.category,
    title: row.title,
    fields: templateFieldsSchema.parse(row.fields),
    document: migrated(row.document, row.schema_version),
    updatedAt: new Date(row.updated_at),
  };
}

function walk(node: NodeJson, visit: (node: NodeJson) => void): void {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

function referencedFields(document: DocumentJson, title: string): Set<string> {
  const keys = new Set<string>();
  walk(document, (node) => {
    if (node.type === "templateField" && typeof node.attrs?.field === "string") keys.add(node.attrs.field);
  });
  for (const match of title.matchAll(TITLE_FIELD)) if (match[1]) keys.add(match[1]);
  return keys;
}

function cleanText(value: string, max: number, code: string, label: string, required: boolean): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if ((required && cleaned.length === 0) || cleaned.length > max) {
    throw new SpaceError(code, `${label} needs ${required ? 1 : 0} to ${max} characters`);
  }
  return cleaned;
}

export function cleanTemplate(
  input: TemplateInput,
): Omit<TemplateInput, "document"> & { document: DocumentJson } {
  const name = cleanText(input.name, TEMPLATE_NAME_MAX_LENGTH, "invalidTemplateName", "The name", true);
  const description = cleanText(
    input.description,
    TEMPLATE_DESCRIPTION_MAX_LENGTH,
    "invalidDescription",
    "The description",
    false,
  );
  const title = cleanText(input.title, TEMPLATE_TITLE_MAX_LENGTH, "invalidTitle", "The page title", true);
  const fields = templateFieldsSchema.safeParse(input.fields);
  if (!fields.success) {
    throw new SpaceError("invalidTemplateFields", "Each input field needs a unique key, a label and a type");
  }
  const validation = validateDocument(input.document);
  if (!validation.ok) throw new DocumentInvalidError(validation.problems);
  const known = new Set(fields.data.map((field) => field.key));
  const unknown = [...referencedFields(validation.document, title)].filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new SpaceError(
      "unknownTemplateField",
      "The content or title uses an input field that does not exist",
      {
        fields: unknown,
      },
    );
  }
  return {
    name,
    description,
    category: input.category,
    title,
    fields: fields.data,
    document: validation.document,
  };
}

export type TemplateValues = Record<string, string>;

interface ResolvedValue {
  field: TemplateField;
  text: string;
  node: NodeJson | null;
}

function formatDate(iso: string, language: TemplateLanguage): string {
  return new Intl.DateTimeFormat(language === "de" ? "de-AT" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
}

function fill(nodes: NodeJson[] | undefined, values: Map<string, ResolvedValue>): NodeJson[] | undefined {
  if (!nodes) return nodes;
  const result: NodeJson[] = [];
  for (const node of nodes) {
    if (node.type === "templateField") {
      const value = values.get(String(node.attrs?.field ?? ""));
      if (!value?.node) continue;
      result.push(
        node.marks && value.node.type === "text" ? { ...value.node, marks: node.marks } : value.node,
      );
      continue;
    }
    result.push(node.content ? { ...node, content: fill(node.content, values) ?? [] } : node);
  }
  return result;
}

export class TemplateService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #settings: SettingsService;
  readonly #people: PeopleService;
  readonly #tree: TreeService;
  readonly #documents: PageDocumentService;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    settings: SettingsService;
    people: PeopleService;
    tree: TreeService;
    documents: PageDocumentService;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#settings = options.settings;
    this.#people = options.people;
    this.#tree = options.tree;
    this.#documents = options.documents;
  }

  async language(actor: Principal): Promise<TemplateLanguage> {
    if (actor.type !== "account") return "en";
    const chain = { ...(await accountScopeChain(this.#database, actor.id)), user: actor.id };
    const language = await this.#settings.get(languageSetting, chain);
    return (templateLanguages as readonly string[]).includes(language)
      ? (language as TemplateLanguage)
      : "en";
  }

  builtIn(language: TemplateLanguage): PageTemplate[] {
    return builtInTemplates.map((template) => {
      const text = template.text[language];
      return {
        id: `${BUILT_IN_PREFIX}${template.key}`,
        level: "builtIn",
        organizationId: null,
        spaceId: null,
        name: text.name,
        description: text.description,
        category: template.category,
        title: text.title,
        fields: text.fields,
        document: text.document,
        updatedAt: null,
      };
    });
  }

  async #rows(
    condition: ReturnType<typeof sql>,
    executor: Executor = this.#database,
  ): Promise<PageTemplate[]> {
    const result = await executor.execute<TemplateRow>(sql`
      select id, level, organization_id, space_id, name, description, category, title, fields, document,
        schema_version, updated_at
      from page_templates where ${condition}
      order by lower(name), id limit 1000`);
    return result.rows.map(toTemplate);
  }

  async list(scope: TemplateScope): Promise<PageTemplate[]> {
    switch (scope.level) {
      case "instance":
        return this.#rows(sql`level = 'instance'`);
      case "organization":
        return this.#rows(sql`level = 'organization' and organization_id = ${scope.organizationId}`);
      case "space":
        return this.#rows(sql`level = 'space' and space_id = ${scope.spaceId}`);
    }
  }

  async usable(actor: Principal, spaceId: string): Promise<PageTemplate[]> {
    const space = await this.#database.execute<{ organization_id: string | null }>(
      sql`select organization_id from spaces where id = ${spaceId}`,
    );
    const organizationId = space.rows[0]?.organization_id ?? null;
    const stored = await this.#rows(sql`level = 'instance'
      or (level = 'organization' and organization_id = ${organizationId})
      or (level = 'space' and space_id = ${spaceId})`);
    return [...this.builtIn(await this.language(actor)), ...stored];
  }

  async get(templateId: string, language: TemplateLanguage = "en"): Promise<PageTemplate | null> {
    if (templateId.startsWith(BUILT_IN_PREFIX)) {
      return this.builtIn(language).find((template) => template.id === templateId) ?? null;
    }
    if (!/^[0-9a-f-]{36}$/.test(templateId)) return null;
    return (await this.#rows(sql`id = ${templateId}`))[0] ?? null;
  }

  async scopeOf(templateId: string): Promise<TemplateScope | null> {
    const template = await this.get(templateId);
    if (!template || template.level === "builtIn") return null;
    if (template.level === "instance") return { level: "instance" };
    if (template.level === "organization" && template.organizationId) {
      return { level: "organization", organizationId: template.organizationId };
    }
    return template.spaceId ? { level: "space", spaceId: template.spaceId } : null;
  }

  async create(actor: Principal, scope: TemplateScope, input: TemplateInput): Promise<PageTemplate> {
    const clean = cleanTemplate(input);
    const id = uuidv7();
    await this.#database.transaction(async (tx) => {
      await tx.execute(sql`
        insert into page_templates (id, level, organization_id, space_id, name, description, category, title,
          document, schema_version, fields, created_by, updated_by)
        values (${id}, ${scope.level}, ${scope.level === "organization" ? scope.organizationId : null},
          ${scope.level === "space" ? scope.spaceId : null}, ${clean.name}, ${clean.description}, ${clean.category},
          ${clean.title}, ${JSON.stringify(clean.document)}::jsonb, ${editorSchemaVersion},
          ${JSON.stringify(clean.fields)}::jsonb, ${actorIdOf(actor)}, ${actorIdOf(actor)})`);
      if (scope.level !== "space") {
        const organizationId = scope.level === "organization" ? scope.organizationId : null;
        await this.#audit.record(tx, {
          name: "template.created",
          actor,
          targetId: id,
          fields: { name: clean.name, level: scope.level, organizationId },
          scope: auditScopeOf({ organizationId }),
        });
      }
    });
    const created = await this.get(id);
    if (!created) throw new SpaceError("templateNotFound", "The template does not exist");
    return created;
  }

  async saveFromPage(
    actor: Principal,
    spaceId: string,
    pageId: string,
    input: Omit<TemplateInput, "document" | "fields" | "title"> & { title?: string | undefined },
  ): Promise<PageTemplate> {
    const page = await this.#documents.snapshot(pageId);
    const located = await this.#tree.spaceOf(pageId);
    if (!page || located !== spaceId) throw new SpaceError("itemNotFound", "The page does not exist");
    const title = input.title ?? (await this.#tree.get(actor, pageId))?.title ?? input.name;
    return this.create(
      actor,
      { level: "space", spaceId },
      { ...input, title, fields: [], document: page.document },
    );
  }

  async update(actor: Principal, templateId: string, input: TemplateInput): Promise<PageTemplate> {
    const clean = cleanTemplate(input);
    const scope = await this.scopeOf(templateId);
    const current = await this.get(templateId);
    if (!scope || !current) throw new SpaceError("templateNotFound", "The template does not exist");
    await this.#database.transaction(async (tx) => {
      await tx.execute(sql`
        update page_templates set name = ${clean.name}, description = ${clean.description},
          category = ${clean.category}, title = ${clean.title}, document = ${JSON.stringify(clean.document)}::jsonb,
          schema_version = ${editorSchemaVersion}, fields = ${JSON.stringify(clean.fields)}::jsonb,
          updated_by = ${actorIdOf(actor)}, updated_at = now()
        where id = ${templateId}`);
      if (scope.level !== "space") {
        const changes = (["name", "description", "category", "title"] as const).filter(
          (key) => clean[key] !== current[key],
        ) as string[];
        if (JSON.stringify(clean.fields) !== JSON.stringify(current.fields)) changes.push("fields");
        if (JSON.stringify(clean.document) !== JSON.stringify(current.document)) changes.push("content");
        await this.#audit.record(tx, {
          name: "template.updated",
          actor,
          targetId: templateId,
          fields: {
            name: clean.name,
            level: scope.level,
            organizationId: scope.level === "organization" ? scope.organizationId : null,
            changes,
          },
          scope: auditScopeOf({
            organizationId: scope.level === "organization" ? scope.organizationId : null,
          }),
        });
      }
    });
    const updated = await this.get(templateId);
    if (!updated) throw new SpaceError("templateNotFound", "The template does not exist");
    return updated;
  }

  async delete(actor: Principal, templateId: string): Promise<void> {
    const scope = await this.scopeOf(templateId);
    const current = await this.get(templateId);
    if (!scope || !current) throw new SpaceError("templateNotFound", "The template does not exist");
    await this.#database.transaction(async (tx) => {
      await tx.execute(sql`delete from page_templates where id = ${templateId}`);
      if (scope.level !== "space") {
        const organizationId = scope.level === "organization" ? scope.organizationId : null;
        await this.#audit.record(tx, {
          name: "template.deleted",
          actor,
          targetId: templateId,
          fields: { name: current.name, level: scope.level, organizationId },
          scope: auditScopeOf({ organizationId }),
        });
      }
    });
  }

  async #resolve(
    actor: Principal,
    fields: TemplateField[],
    values: TemplateValues,
    language: TemplateLanguage,
  ): Promise<Map<string, ResolvedValue>> {
    const resolved = new Map<string, ResolvedValue>();
    const problems: string[] = [];
    const unknown = Object.keys(values).filter((key) => !fields.some((field) => field.key === key));
    if (unknown.length > 0) problems.push(...unknown);
    for (const field of fields) {
      const raw = (values[field.key] ?? "").trim();
      const value = raw === "" && field.type === "date" ? new Date().toISOString().slice(0, 10) : raw;
      if (value === "") {
        if (field.required) problems.push(field.key);
        resolved.set(field.key, { field, text: "", node: null });
        continue;
      }
      if (value.length > TEMPLATE_VALUE_MAX_LENGTH) {
        problems.push(field.key);
        continue;
      }
      switch (field.type) {
        case "text":
          resolved.set(field.key, { field, text: value, node: { type: "text", text: value } });
          break;
        case "choice":
          if (!field.options?.includes(value)) problems.push(field.key);
          else resolved.set(field.key, { field, text: value, node: { type: "text", text: value } });
          break;
        case "date":
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
            problems.push(field.key);
          } else {
            resolved.set(field.key, {
              field,
              text: formatDate(value, language),
              node: { type: "date", attrs: { date: value } },
            });
          }
          break;
        case "person": {
          const id = value.toLowerCase();
          if (!isUuid(id) || !(await this.#people.canSee(actor, id))) {
            problems.push(field.key);
            break;
          }
          const name = (await this.#people.names([id])).get(id) ?? "";
          resolved.set(field.key, { field, text: name, node: { type: "mention", attrs: { id } } });
          break;
        }
      }
    }
    if (problems.length > 0) {
      throw new SpaceError("invalidTemplateValues", "Some input values are missing or not valid", {
        fields: [...new Set(problems)],
      });
    }
    return resolved;
  }

  async instantiate(
    actor: Principal,
    spaceId: string,
    input: {
      templateId: string;
      values: TemplateValues;
      placement: Placement;
      title?: string | undefined;
      mode?: PageMode | undefined;
    },
  ): Promise<TreeItem> {
    const language = await this.language(actor);
    const template = (await this.usable(actor, spaceId)).find(
      (candidate) => candidate.id === input.templateId,
    );
    if (!template) throw new SpaceError("templateNotFound", "The template does not exist");
    const values = await this.#resolve(actor, template.fields, input.values, language);
    const title =
      input.title?.trim() ||
      template.title
        .replace(TITLE_FIELD, (_match, key: string) => values.get(key)?.text ?? "")
        .replace(/\s+/g, " ")
        .trim() ||
      template.name;
    const document = { ...template.document, content: fill(template.document.content, values) ?? [] };
    return this.#tree.create(actor, spaceId, {
      kind: "page",
      title,
      placement: input.placement,
      mode: input.mode,
      document,
    });
  }
}
