import {
  articleSections,
  type DocumentJson,
  type NodeJson,
  plainText,
  sectionIconValue,
} from "@pagehall/editor-schema";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import { FIRST_PAGE, type Page, type PageRequest, pageLimit, toPage } from "../database/keyset.js";
import { actorIdOf, auditScopeOf, SpaceError } from "../spaces/common.js";
import { migrated } from "../spaces/documents.js";
import type { PeopleService } from "../spaces/people.js";
import type { SpacePermissionService } from "../spaces/permissions.js";
import type { ArticleType, KnowledgeBaseAudience } from "../spaces/schema.js";
import { signalSpaceChange } from "../spaces/signals.js";
import { audienceVisibility, type Space, type SpaceService } from "../spaces/spaces.js";
import { visibleItem } from "../spaces/visibility.js";
import type { PageTemplate, TemplateService } from "../templates/templates.js";

export const MAX_AUDIENCE_GROUPS = 100;
export const CATEGORY_LEVELS = 2;

const contactEmailSchema = z.email().max(254);

export interface AudienceGroup {
  id: string;
  name: string;
}

export interface KnowledgeBaseSettings {
  spaceId: string;
  audience: KnowledgeBaseAudience;
  groups: AudienceGroup[];
  contactEmail: string | null;
}

export interface AudienceImpact {
  widening: boolean;
  articles: number;
}

export type ContactSource = "category" | "parentCategory" | "knowledgeBase";

export interface Category {
  id: string;
  parentId: string | null;
  level: number;
  title: string;
  description: string;
  icon: string | null;
  contactEmail: string | null;
  effectiveContactEmail: string | null;
  contactSource: ContactSource | null;
  position: string;
  articles: number;
}

export interface CategoryReference {
  id: string;
  title: string;
}

export interface ArticleSummary {
  id: string;
  spaceId: string;
  title: string;
  type: ArticleType | null;
  number: number | null;
  slug: string;
  categoryPath: CategoryReference[];
  ownerId: string | null;
  ownerName: string | null;
  published: boolean;
  contentUpdatedAt: Date;
}

export interface ArticleSectionContent {
  key: string;
  title: string;
  icon: string | null;
  text: string;
  content: NodeJson[];
}

export interface Article extends ArticleSummary {
  spaceKey: string;
  templateId: string | null;
  contactEmail: string | null;
  version: number | null;
  sections: ArticleSectionContent[];
  document: DocumentJson | null;
}

export interface TemplateSections {
  templateId: string;
  name: string;
  articleType: ArticleType | null;
  builtIn: boolean;
  sections: { key: string; title: string; icon: string | null; required: boolean }[];
}

const AUDIENCE_COVERS: Record<KnowledgeBaseAudience, readonly KnowledgeBaseAudience[]> = {
  public: ["public", "signedIn", "groups", "portal"],
  signedIn: ["signedIn", "groups"],
  groups: ["groups"],
  portal: ["portal"],
};

export function audienceWidens(
  before: { audience: KnowledgeBaseAudience; groups: readonly string[] },
  after: { audience: KnowledgeBaseAudience; groups: readonly string[] },
): boolean {
  if (!AUDIENCE_COVERS[before.audience].includes(after.audience)) return true;
  if (before.audience === "groups" && after.audience === "groups") {
    return after.groups.some((group) => !before.groups.includes(group));
  }
  return false;
}

function cleanContact(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!contactEmailSchema.safeParse(trimmed).success) {
    throw new SpaceError("invalidContactEmail", "Enter an e-mail address such as help@example.org");
  }
  return trimmed;
}

type ArticleRow = {
  id: string;
  space_id: string;
  title: string;
  article_type: ArticleType | null;
  number: number | null;
  slug: string;
  category_ids: string[];
  category_titles: string[];
  owner_id: string | null;
  owner_name: string | null;
  published: boolean;
  content_updated_at: Date | string;
};

function toSummary(row: ArticleRow): ArticleSummary {
  return {
    id: row.id,
    spaceId: row.space_id,
    title: row.title,
    type: row.article_type,
    number: row.number === null ? null : Number(row.number),
    slug: row.slug,
    categoryPath: row.category_ids.map((id, index) => ({ id, title: row.category_titles[index] ?? "" })),
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    published: row.published,
    contentUpdatedAt: new Date(row.content_updated_at),
  };
}

export class KnowledgeBaseService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #authorization: AuthorizationService;
  readonly #spaces: SpaceService;
  readonly #permissions: SpacePermissionService;
  readonly #people: PeopleService;
  readonly #templates: TemplateService;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    authorization: AuthorizationService;
    spaces: SpaceService;
    permissions: SpacePermissionService;
    people: PeopleService;
    templates: TemplateService;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#authorization = options.authorization;
    this.#spaces = options.spaces;
    this.#permissions = options.permissions;
    this.#people = options.people;
    this.#templates = options.templates;
  }

  async #requireKnowledgeBase(spaceId: string, executor: Executor = this.#database): Promise<Space> {
    const space = await this.#spaces.require(spaceId, executor);
    if (space.type !== "knowledgeBase" || !space.audience) {
      throw new SpaceError("notKnowledgeBase", "The space is not a knowledge base");
    }
    return space;
  }

  async #audienceGroups(executor: Executor, spaceId: string): Promise<AudienceGroup[]> {
    const result = await executor.execute<{ id: string; name: string }>(sql`
      select g.id, g.name from space_permissions sp join groups g on g.id = sp.principal_id
      where sp.space_id = ${spaceId} and sp.principal_kind = 'group' and sp.role = 'reader'
      order by lower(g.name), g.id`);
    return result.rows;
  }

  async settings(spaceId: string): Promise<KnowledgeBaseSettings> {
    const space = await this.#requireKnowledgeBase(spaceId);
    const contact = await this.#database.execute<{ contact_email: string | null }>(
      sql`select contact_email from knowledge_bases where space_id = ${spaceId}`,
    );
    return {
      spaceId,
      audience: space.audience as KnowledgeBaseAudience,
      groups: await this.#audienceGroups(this.#database, spaceId),
      contactEmail: contact.rows[0]?.contact_email ?? null,
    };
  }

  async #openArticles(executor: Executor, spaceId: string): Promise<number> {
    const result = await executor.execute<{ articles: number }>(sql`
      select count(*)::int as articles from tree_items t
      where t.space_id = ${spaceId} and t.kind = 'page' and t.trash_entry_id is null
        and not exists (select 1 from page_restrictions r where r.item_id = any(t.path) and r.kind = 'view')`);
    return Number(result.rows[0]?.articles ?? 0);
  }

  async audienceImpact(
    spaceId: string,
    change: { audience: KnowledgeBaseAudience; groupIds: readonly string[] },
  ): Promise<AudienceImpact> {
    const space = await this.#requireKnowledgeBase(spaceId);
    const groups = (await this.#audienceGroups(this.#database, spaceId)).map((group) => group.id);
    const widening = audienceWidens(
      { audience: space.audience as KnowledgeBaseAudience, groups },
      { audience: change.audience, groups: change.audience === "groups" ? change.groupIds : [] },
    );
    return { widening, articles: widening ? await this.#openArticles(this.#database, spaceId) : 0 };
  }

  async changeAudience(
    actor: Principal,
    spaceId: string,
    change: {
      audience: KnowledgeBaseAudience;
      groupIds: readonly string[];
      confirmWidening?: boolean | undefined;
    },
  ): Promise<KnowledgeBaseSettings> {
    const groupIds = [...new Set(change.groupIds.map((id) => id.toLowerCase()))];
    if (groupIds.length > MAX_AUDIENCE_GROUPS) {
      throw new SpaceError("tooManyGroups", `Choose up to ${MAX_AUDIENCE_GROUPS} groups`);
    }
    if (change.audience === "groups" && groupIds.length === 0) {
      throw new SpaceError(
        "audienceGroupsMissing",
        "Choose at least one group that may read the knowledge base",
      );
    }
    await this.#database.transaction(async (tx) => {
      const space = await this.#spaces.lock(tx, spaceId);
      if (space.type !== "knowledgeBase" || !space.audience) {
        throw new SpaceError("notKnowledgeBase", "The space is not a knowledge base");
      }
      const previous = await this.#audienceGroups(tx, spaceId);
      const before = { audience: space.audience, groups: previous.map((group) => group.id) };
      const after = {
        audience: change.audience,
        groups: change.audience === "groups" ? groupIds : before.groups,
      };
      const widened = audienceWidens(before, after);
      const articles = await this.#openArticles(tx, spaceId);
      if (widened && change.confirmWidening !== true) {
        throw new SpaceError(
          "audienceWidening",
          "More people will be able to read the knowledge base. Confirm the change to apply it.",
          { articles },
        );
      }
      if (change.audience === "groups")
        await this.#replaceGroups(tx, actor, spaceId, before.groups, groupIds);
      if (change.audience !== space.audience) {
        await tx.execute(sql`
          update spaces set audience = ${change.audience}, visibility = ${audienceVisibility(change.audience)},
            updated_at = now()
          where id = ${spaceId}`);
      }
      if (change.audience === space.audience && after.groups.join() === before.groups.join()) return;
      await this.#audit.record(tx, {
        name: "knowledgeBase.audienceChanged",
        actor,
        targetId: spaceId,
        fields: {
          name: space.name,
          audience: change.audience,
          previousAudience: space.audience,
          groupIds: after.groups,
          previousGroupIds: before.groups,
          widened,
          articles,
        },
        scope: auditScopeOf(space),
      });
      await signalSpaceChange(tx, { spaceId, kind: "access", itemId: null });
    });
    return this.settings(spaceId);
  }

  async #replaceGroups(
    tx: Transaction,
    actor: Principal,
    spaceId: string,
    current: readonly string[],
    next: readonly string[],
  ): Promise<void> {
    const stored = await tx.execute<{ id: string; principal_id: string; role: string }>(sql`
      select id, principal_id, role from space_permissions
      where space_id = ${spaceId} and principal_kind = 'group' and principal_id = any(${sql.param([...current, ...next])}::uuid[])`);
    for (const groupId of current.filter((id) => !next.includes(id))) {
      const permission = stored.rows.find((row) => row.principal_id === groupId && row.role === "reader");
      if (permission) {
        await this.#permissions.apply(
          actor,
          spaceId,
          { action: "remove", permissionId: permission.id },
          { tx },
        );
      }
    }
    for (const groupId of next.filter((id) => !current.includes(id))) {
      if (stored.rows.some((row) => row.principal_id === groupId)) continue;
      await this.#permissions.apply(
        actor,
        spaceId,
        { action: "grant", principalKind: "group", principalId: groupId, role: "reader" },
        { tx },
      );
    }
  }

  async setContactEmail(spaceId: string, contactEmail: string | null): Promise<KnowledgeBaseSettings> {
    const value = cleanContact(contactEmail);
    await this.#requireKnowledgeBase(spaceId);
    await this.#database.transaction(async (tx) => {
      await tx.execute(sql`
        insert into knowledge_bases (space_id, contact_email) values (${spaceId}, ${value})
        on conflict (space_id) do update set contact_email = excluded.contact_email, updated_at = now()`);
      await signalSpaceChange(tx, { spaceId, kind: "space", itemId: null });
    });
    return this.settings(spaceId);
  }

  #categoryLevel(item: SQL): SQL {
    return sql`(select count(*) from tree_items anc where anc.id = any(${item}.path) and anc.id <> ${item}.id)`;
  }

  async categories(viewer: Principal, spaceId: string): Promise<Category[]> {
    await this.#requireKnowledgeBase(spaceId);
    const result = await this.#database.execute<{
      id: string;
      parent_id: string | null;
      level: number;
      title: string;
      description: string;
      position: string;
      icon: string | null;
      contact_email: string | null;
      articles: number;
    }>(sql`
      select c.id, c.parent_id, cardinality(c.path) as level, c.title, c.description, c.position,
        kc.icon, kc.contact_email,
        (select count(*)::int from tree_items a join spaces sa on sa.id = a.space_id
          where a.space_id = c.space_id and a.kind = 'page' and c.id = any(a.path) and a.archived_root_id is null
            and ${visibleItem(this.#authorization, viewer, sql`a`, sql`sa`)}) as articles
      from tree_items c join spaces s on s.id = c.space_id
      left join knowledge_base_categories kc on kc.item_id = c.id
      where c.space_id = ${spaceId} and c.kind = 'folder' and cardinality(c.path) <= ${CATEGORY_LEVELS}
        and c.archived_root_id is null and ${visibleItem(this.#authorization, viewer, sql`c`, sql`s`)}
      order by cardinality(c.path), c.position, c.id
      limit 1000`);
    const fallback = (await this.settings(spaceId)).contactEmail;
    const rows = result.rows;
    const byId = new Map(rows.map((row) => [row.id, row]));
    return rows.map((row) => {
      const parent = row.parent_id ? byId.get(row.parent_id) : undefined;
      const [effective, source]: [string | null, ContactSource | null] = row.contact_email
        ? [row.contact_email, "category"]
        : parent?.contact_email
          ? [parent.contact_email, "parentCategory"]
          : fallback
            ? [fallback, "knowledgeBase"]
            : [null, null];
      return {
        id: row.id,
        parentId: row.parent_id,
        level: Number(row.level),
        title: row.title,
        description: row.description,
        icon: row.icon,
        contactEmail: row.contact_email,
        effectiveContactEmail: effective,
        contactSource: source,
        position: row.position,
        articles: Number(row.articles),
      };
    });
  }

  async #requireCategory(executor: Executor, itemId: string): Promise<{ spaceId: string }> {
    const result = await executor.execute<{ space_id: string; level: number }>(sql`
      select t.space_id, cardinality(t.path) as level from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${itemId} and t.kind = 'folder' and s.type = 'knowledgeBase' and t.trash_entry_id is null`);
    const row = result.rows[0];
    if (!row || Number(row.level) > CATEGORY_LEVELS) {
      throw new SpaceError(
        "notCategory",
        "Only folders on the first two levels of a knowledge base are categories with their own settings",
      );
    }
    return { spaceId: row.space_id };
  }

  async updateCategory(
    itemId: string,
    changes: { icon?: string | null | undefined; contactEmail?: string | null | undefined },
  ): Promise<void> {
    const contact = changes.contactEmail === undefined ? undefined : cleanContact(changes.contactEmail);
    if (changes.icon && !sectionIconValue.safeParse(changes.icon).success) {
      throw new SpaceError("invalidIcon", "Choose an icon from the list");
    }
    await this.#database.transaction(async (tx) => {
      const { spaceId } = await this.#requireCategory(tx, itemId);
      await tx.execute(
        sql`insert into knowledge_base_categories (item_id) values (${itemId}) on conflict do nothing`,
      );
      if (changes.icon !== undefined) {
        await tx.execute(sql`update knowledge_base_categories set icon = ${changes.icon}, updated_at = now()
          where item_id = ${itemId}`);
      }
      if (contact !== undefined) {
        await tx.execute(sql`update knowledge_base_categories set contact_email = ${contact}, updated_at = now()
          where item_id = ${itemId}`);
      }
      await signalSpaceChange(tx, { spaceId, kind: "tree", itemId });
    });
  }

  async categorySpace(itemId: string): Promise<string> {
    return (await this.#requireCategory(this.#database, itemId)).spaceId;
  }

  #articleSelect(viewer: Principal): SQL {
    const category = (
      index: number,
    ) => sql`(select c.id from tree_items c join spaces cs on cs.id = c.space_id
      where c.id = t.path[${index}] and c.kind = 'folder' and c.id <> t.id
        and ${visibleItem(this.#authorization, viewer, sql`c`, sql`cs`)})`;
    return sql`select t.id, t.space_id, t.title, t.article_type, an.number, article_slug(t.title) as slug,
        array_remove(array[${category(1)}, ${category(2)}], null) as category_ids,
        array(select c.title from tree_items c where c.id = any(array[${category(1)}, ${category(2)}])
          order by cardinality(c.path)) as category_titles,
        t.owner_id, ${this.#people.visibleName(viewer, sql`o`)} as owner_name,
        t.published_version_id is not null as published, t.content_updated_at
      from tree_items t join spaces s on s.id = t.space_id
      left join article_numbers an on an.item_id = t.id and an.space_id = t.space_id
      left join accounts o on o.id = t.owner_id`;
  }

  async articles(
    viewer: Principal,
    spaceId: string,
    options: {
      categoryId?: string | null | undefined;
      type?: ArticleType | "none" | undefined;
      page?: PageRequest | undefined;
    } = {},
  ): Promise<Page<ArticleSummary>> {
    await this.#requireKnowledgeBase(spaceId);
    const page = options.page ?? FIRST_PAGE;
    const category =
      options.categoryId === null
        ? sql`and cardinality(t.path) = 1`
        : options.categoryId
          ? sql`and ${options.categoryId}::uuid = any(t.path)`
          : sql``;
    const type =
      options.type === "none"
        ? sql`and t.article_type is null`
        : options.type
          ? sql`and t.article_type = ${options.type}`
          : sql``;
    const result = await this.#database.execute<ArticleRow & { sort_time: string }>(sql`
      select found.*, found.sort_key as sort_time from (select inner_found.*,
        to_char(inner_found.content_updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as sort_key from (${this.#articleSelect(viewer)}
        where t.space_id = ${spaceId} and t.kind = 'page' and t.archived_root_id is null
          and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)} ${category} ${type}) inner_found) found
      where true ${
        page.after
          ? sql`and (found.sort_key, found.id) < (${page.after[0] ?? ""}, ${page.after[1] ?? ""}::uuid)`
          : sql``
      }
      order by found.sort_key desc, found.id desc
      limit ${pageLimit(page)}`);
    return toPage(result.rows, page, (row) => [row.sort_time, row.id], toSummary);
  }

  async article(
    viewer: Principal,
    itemId: string,
    options: { draft?: boolean } = {},
  ): Promise<Article | null> {
    const result = await this.#database.execute<
      ArticleRow & {
        space_key: string;
        template_id: string | null;
        version_number: number | null;
        version_document: unknown;
        version_schema: number | null;
      }
    >(sql`
      select found.*, ps.key as space_key, pt.template_id, v.number as version_number,
        v.document as version_document, v.schema_version as version_schema
      from (${this.#articleSelect(viewer)}
        where t.id = ${itemId} and t.kind = 'page' and s.type = 'knowledgeBase'
          and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}) found
      join spaces ps on ps.id = found.space_id
      join tree_items pt on pt.id = found.id
      left join page_versions v on v.id = pt.published_version_id`);
    const row = result.rows[0];
    if (!row) return null;
    let document: DocumentJson | null = null;
    let version: number | null = row.version_number === null ? null : Number(row.version_number);
    if (options.draft) {
      const editable = await this.#authorization.explain(viewer, "item.edit", { type: "item", id: itemId });
      if (!editable.allowed)
        throw new SpaceError("draftNotVisible", "Only editors of the article see its draft");
      const draft = await this.#database.execute<{ snapshot: unknown; schema_version: number }>(
        sql`select snapshot, schema_version from page_documents where item_id = ${itemId}`,
      );
      const stored = draft.rows[0];
      document = stored ? migrated(stored.snapshot, stored.schema_version) : null;
      version = null;
    } else if (row.version_document !== null && row.version_schema !== null) {
      document = migrated(row.version_document, Number(row.version_schema));
    }
    const sections = document
      ? articleSections(document).map((section) => ({
          key: section.key,
          title: section.title,
          icon: section.icon,
          text: plainText({ type: "doc", content: section.content }),
          content: section.content,
        }))
      : [];
    return {
      ...toSummary(row),
      spaceKey: row.space_key,
      templateId: row.template_id,
      contactEmail: await this.#contactFor(row.space_id, row.category_ids),
      version,
      sections,
      document,
    };
  }

  async #contactFor(spaceId: string, categoryIds: readonly string[]): Promise<string | null> {
    const result = await this.#database.execute<{ contact_email: string | null }>(sql`
      select coalesce(
        (select contact_email from knowledge_base_categories where item_id = ${categoryIds[1] ?? null}::uuid),
        (select contact_email from knowledge_base_categories where item_id = ${categoryIds[0] ?? null}::uuid),
        (select contact_email from knowledge_bases where space_id = ${spaceId})) as contact_email`);
    return result.rows[0]?.contact_email ?? null;
  }

  async setArticleType(itemId: string, type: ArticleType | null): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const updated = await tx.execute<{ space_id: string }>(sql`
        update tree_items t set article_type = ${type}, updated_at = now()
        from spaces s where s.id = t.space_id and s.type = 'knowledgeBase' and t.id = ${itemId} and t.kind = 'page'
        returning t.space_id`);
      const row = updated.rows[0];
      if (!row)
        throw new SpaceError("invalidArticleType", "Only articles of a knowledge base have an article type");
      await signalSpaceChange(tx, { spaceId: row.space_id, kind: "tree", itemId });
    });
  }

  async #knowledgeBaseTemplates(actor: Principal, spaceId: string): Promise<PageTemplate[]> {
    return (await this.#templates.usable(actor, spaceId)).filter((template) => template.knowledgeBase);
  }

  async templateSections(actor: Principal, spaceId: string): Promise<TemplateSections[]> {
    await this.#requireKnowledgeBase(spaceId);
    const required = await this.#database.execute<{ template_id: string; section_key: string }>(sql`
      select template_id, section_key from knowledge_base_required_sections where space_id = ${spaceId}`);
    const marked = new Set(required.rows.map((row) => `${row.template_id}\n${row.section_key}`));
    return (await this.#knowledgeBaseTemplates(actor, spaceId)).map((template) => ({
      templateId: template.id,
      name: template.name,
      articleType: template.articleType,
      builtIn: template.level === "builtIn",
      sections: articleSections(template.document).map((section) => ({
        key: section.key,
        title: section.title,
        icon: section.icon,
        required: marked.has(`${template.id}\n${section.key}`),
      })),
    }));
  }

  async setRequired(
    actor: Principal,
    spaceId: string,
    templateId: string,
    sectionKey: string,
    required: boolean,
  ): Promise<TemplateSections[]> {
    await this.#requireKnowledgeBase(spaceId);
    const template = (await this.#knowledgeBaseTemplates(actor, spaceId)).find(
      (candidate) => candidate.id === templateId,
    );
    const section = template
      ? articleSections(template.document).find((found) => found.key === sectionKey)
      : null;
    if (!template || !section) {
      throw new SpaceError("sectionNotFound", "The template has no section with this key");
    }
    await this.#database.transaction(async (tx) => {
      if (required) {
        await tx.execute(sql`
          insert into knowledge_base_required_sections (space_id, template_id, section_key, section_title, created_by)
          values (${spaceId}, ${templateId}, ${sectionKey}, ${section.title}, ${actorIdOf(actor)})
          on conflict (space_id, template_id, section_key)
          do update set section_title = excluded.section_title, updated_at = now()`);
      } else {
        await tx.execute(sql`
          delete from knowledge_base_required_sections
          where space_id = ${spaceId} and template_id = ${templateId} and section_key = ${sectionKey}`);
      }
      await signalSpaceChange(tx, { spaceId, kind: "space", itemId: null });
    });
    return this.templateSections(actor, spaceId);
  }
}
