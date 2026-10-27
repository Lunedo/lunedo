import { type ContentLanguage, contentLanguages, OTHER_CONTENT_LANGUAGE } from "@lunedo/shared";
import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor } from "../database/database.js";
import { auditScopeOf, SpaceError } from "../spaces/common.js";
import { migrated } from "../spaces/documents.js";
import type { TreeItem, TreeService } from "../spaces/items.js";
import { signalSpaceChange } from "../spaces/signals.js";
import type { SpaceService } from "../spaces/spaces.js";
import { visibleItem } from "../spaces/visibility.js";

export const MAX_KNOWLEDGE_BASE_LANGUAGES = 30;

export type ArticleLanguage = Exclude<ContentLanguage, typeof OTHER_CONTENT_LANGUAGE>;

export const articleLanguages = contentLanguages.filter(
  (language): language is ArticleLanguage => language !== OTHER_CONTENT_LANGUAGE,
);

export function isArticleLanguage(value: unknown): value is ArticleLanguage {
  return typeof value === "string" && (articleLanguages as readonly string[]).includes(value);
}

export type TranslationState = "original" | "current" | "outdated" | "unpublished" | "missing";

export interface LanguageProgress {
  language: ArticleLanguage;
  translated: number;
  outdated: number;
  missing: number;
}

export interface LanguageSettings {
  spaceId: string;
  defaultLanguage: ArticleLanguage;
  languages: ArticleLanguage[];
  articles: number;
  progress: LanguageProgress[];
  searchUpdate: { remaining: number; total: number } | null;
}

export interface ArticleTranslation {
  language: ArticleLanguage;
  itemId: string | null;
  itemNumber: number | null;
  title: string | null;
  state: TranslationState;
  enabled: boolean;
}

export interface ArticleTranslations {
  sourceId: string;
  spaceId: string;
  defaultLanguage: ArticleLanguage;
  language: ArticleLanguage;
  translations: ArticleTranslation[];
}

export function translationState(source: SQL, translation: SQL): SQL {
  return sql`(case when ${translation}.published_version_id is null then 'unpublished'
    when (select sv.created_at from page_versions sv where sv.id = ${source}.published_version_id)
      > greatest((select tv.created_at from page_versions tv where tv.id = ${translation}.published_version_id),
        (select ar.reviewed_at from article_reviews ar where ar.item_id = ${translation}.id))
      then 'outdated' else 'current' end)`;
}

interface LanguageRow extends Record<string, unknown> {
  default_language: ArticleLanguage;
  languages: ArticleLanguage[];
}

export class ArticleTranslationService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #audit: AuditLog;
  readonly #spaces: SpaceService;
  readonly #tree: TreeService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    audit: AuditLog;
    spaces: SpaceService;
    tree: TreeService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#audit = options.audit;
    this.#spaces = options.spaces;
    this.#tree = options.tree;
  }

  async #languages(executor: Executor, spaceId: string): Promise<LanguageRow> {
    const result = await executor.execute<LanguageRow>(sql`
      select kb.default_language, kb.languages from knowledge_bases kb join spaces s on s.id = kb.space_id
      where kb.space_id = ${spaceId} and s.type = 'knowledgeBase'`);
    const row = result.rows[0];
    if (!row) throw new SpaceError("notKnowledgeBase", "The space is not a knowledge base");
    return row;
  }

  async settings(spaceId: string): Promise<LanguageSettings> {
    const languages = await this.#languages(this.#database, spaceId);
    const counts = await this.#database.execute<{
      language: string;
      translated: number;
      outdated: number;
    }>(sql`
      select tr.content_language as language,
        count(*) filter (where ${translationState(sql`src`, sql`tr`)} = 'current')::int as translated,
        count(*) filter (where ${translationState(sql`src`, sql`tr`)} = 'outdated')::int as outdated
      from tree_items tr join tree_items src on src.id = tr.translation_of
      where tr.space_id = ${spaceId} and tr.trash_entry_id is null and tr.archived_root_id is null
        and src.trash_entry_id is null and src.archived_root_id is null and src.published_version_id is not null
      group by 1`);
    const total = await this.#database.execute<{ articles: number }>(sql`
      select count(*)::int as articles from tree_items t
      where t.space_id = ${spaceId} and t.kind = 'page' and t.translation_of is null
        and t.trash_entry_id is null and t.archived_root_id is null and t.published_version_id is not null`);
    const articles = Number(total.rows[0]?.articles ?? 0);
    const indexing = await this.#database.execute<{ remaining: number; total: number }>(sql`
      select count(p.item_id)::int as remaining, count(*)::int as total from tree_items t
      left join search_pending_items p on p.item_id = t.id
      where t.space_id = ${spaceId} and t.kind = 'page' and t.trash_entry_id is null`);
    const remaining = Number(indexing.rows[0]?.remaining ?? 0);
    const byLanguage = new Map(counts.rows.map((row) => [row.language, row]));
    return {
      spaceId,
      defaultLanguage: languages.default_language,
      languages: languages.languages,
      articles,
      progress: languages.languages
        .filter((language) => language !== languages.default_language)
        .map((language) => {
          const row = byLanguage.get(language);
          const translated = Number(row?.translated ?? 0) + Number(row?.outdated ?? 0);
          return {
            language,
            translated,
            outdated: Number(row?.outdated ?? 0),
            missing: Math.max(articles - translated, 0),
          };
        }),
      searchUpdate:
        remaining > 0
          ? { remaining, total: Math.max(Number(indexing.rows[0]?.total ?? 0), remaining) }
          : null,
    };
  }

  async update(
    actor: Principal,
    spaceId: string,
    change: { defaultLanguage?: string | undefined; languages?: readonly string[] | undefined },
  ): Promise<LanguageSettings> {
    await this.#database.transaction(async (tx) => {
      const space = await this.#spaces.lock(tx, spaceId);
      const current = await this.#languages(tx, spaceId);
      const defaultLanguage = change.defaultLanguage ?? current.default_language;
      if (!isArticleLanguage(defaultLanguage)) {
        throw new SpaceError("invalidLanguage", "Choose a language from the list");
      }
      const requested = change.languages ?? current.languages;
      if (!requested.every(isArticleLanguage)) {
        throw new SpaceError("invalidLanguage", "Choose a language from the list");
      }
      const languages = [...new Set([defaultLanguage, ...requested])] as ArticleLanguage[];
      if (languages.length > MAX_KNOWLEDGE_BASE_LANGUAGES) {
        throw new SpaceError(
          "tooManyLanguages",
          `A knowledge base can have up to ${MAX_KNOWLEDGE_BASE_LANGUAGES} languages`,
        );
      }
      if (defaultLanguage !== current.default_language) {
        const clash = await tx.execute<{ translations: number }>(sql`
          select count(*)::int as translations from tree_items
          where space_id = ${spaceId} and translation_of is not null and content_language = ${defaultLanguage}`);
        const translations = Number(clash.rows[0]?.translations ?? 0);
        if (translations > 0) {
          throw new SpaceError(
            "defaultLanguageTranslated",
            "Articles already have translations into this language. Delete those translations before you make it the default language.",
            { translations },
          );
        }
      }
      if (defaultLanguage === current.default_language && languages.join() === current.languages.join()) {
        return;
      }
      await tx.execute(sql`
        update knowledge_bases set default_language = ${defaultLanguage},
          languages = ${sql.param(languages)}::text[], updated_at = now()
        where space_id = ${spaceId}`);
      if (defaultLanguage !== current.default_language) {
        await tx.execute(sql`
          select search_mark_item(t.id, interval '0') from tree_items t
          where t.space_id = ${spaceId} and t.kind = 'page'`);
      }
      await this.#audit.record(tx, {
        name: "knowledgeBase.languagesChanged",
        actor,
        targetId: spaceId,
        scope: auditScopeOf(space),
        fields: {
          name: space.name,
          defaultLanguage,
          previousDefaultLanguage: current.default_language,
          languages,
          previousLanguages: current.languages,
        },
      });
      await signalSpaceChange(tx, { spaceId, kind: "space", itemId: null });
    });
    return this.settings(spaceId);
  }

  async translations(viewer: Principal, itemId: string): Promise<ArticleTranslations | null> {
    const found = await this.#database.execute<{
      source_id: string;
      space_id: string;
      language: ArticleLanguage | null;
    }>(sql`
      select coalesce(t.translation_of, t.id) as source_id, t.space_id,
        case when t.translation_of is null then null else t.content_language end as language
      from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${itemId} and t.kind = 'page' and s.type = 'knowledgeBase'
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}`);
    const row = found.rows[0];
    if (!row) return null;
    const languages = await this.#languages(this.#database, row.space_id);
    const result = await this.#database.execute<{
      id: string;
      number: number | string;
      language: ArticleLanguage;
      title: string;
      state: TranslationState;
    }>(sql`
      select tr.id, tr.number, tr.content_language as language, coalesce(v.title, tr.title) as title,
        ${translationState(sql`src`, sql`tr`)} as state
      from tree_items tr join tree_items src on src.id = tr.translation_of
      join spaces s on s.id = tr.space_id
      left join page_versions v on v.id = tr.published_version_id
      where tr.translation_of = ${row.source_id} and tr.trash_entry_id is null and tr.archived_root_id is null
        and ${visibleItem(this.#authorization, viewer, sql`tr`, sql`s`)}
      order by tr.content_language`);
    const source = await this.#database.execute<{
      id: string;
      number: number | string;
      title: string;
      visible: boolean;
    }>(sql`
      select t.id, t.number, coalesce(v.title, t.title) as title,
        ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)} as visible
      from tree_items t join spaces s on s.id = t.space_id left join page_versions v on v.id = t.published_version_id
      where t.id = ${row.source_id}`);
    const original = source.rows[0];
    const byLanguage = new Map(result.rows.map((entry) => [entry.language, entry]));
    const shown = new Set<ArticleLanguage>([...languages.languages, ...byLanguage.keys()]);
    shown.delete(languages.default_language);
    const translations: ArticleTranslation[] = [
      {
        language: languages.default_language,
        itemId: original?.visible ? original.id : null,
        itemNumber: original?.visible ? Number(original.number) : null,
        title: original?.visible ? original.title : null,
        state: "original",
        enabled: true,
      },
      ...[...shown].sort().map((language) => {
        const entry = byLanguage.get(language);
        return {
          language,
          itemId: entry?.id ?? null,
          itemNumber: entry ? Number(entry.number) : null,
          title: entry?.title ?? null,
          state: entry?.state ?? ("missing" as const),
          enabled: languages.languages.includes(language),
        };
      }),
    ];
    return {
      sourceId: row.source_id,
      spaceId: row.space_id,
      defaultLanguage: languages.default_language,
      language: row.language ?? languages.default_language,
      translations,
    };
  }

  async create(actor: Principal, itemId: string, language: string): Promise<TreeItem> {
    if (!isArticleLanguage(language))
      throw new SpaceError("invalidLanguage", "Choose a language from the list");
    const found = await this.#database.execute<{
      space_id: string;
      translation_of: string | null;
      title: string;
      draft_title: string | null;
      article_type: "howTo" | "troubleshooting" | null;
      description: string;
      template_id: string | null;
      version_document: unknown;
      version_schema: number | null;
      draft_document: unknown;
      draft_schema: number | null;
    }>(sql`
      select t.space_id, t.translation_of, t.title, d.draft_title, t.article_type, t.description, t.template_id,
        v.document as version_document, v.schema_version as version_schema,
        d.snapshot as draft_document, d.schema_version as draft_schema
      from tree_items t join spaces s on s.id = t.space_id
      left join page_versions v on v.id = t.published_version_id
      left join page_documents d on d.item_id = t.id
      where t.id = ${itemId} and t.kind = 'page' and s.type = 'knowledgeBase' and t.trash_entry_id is null`);
    const source = found.rows[0];
    if (!source)
      throw new SpaceError("translationSource", "Only articles of a knowledge base can be translated");
    if (source.translation_of !== null)
      throw new SpaceError("translationSource", "Translate the original article");
    const languages = await this.#languages(this.#database, source.space_id);
    if (language === languages.default_language || !languages.languages.includes(language)) {
      throw new SpaceError(
        "languageNotEnabled",
        "Enable the language in the knowledge base settings before you add a translation into it",
      );
    }
    const existing = await this.#database.execute<{ id: string }>(sql`
      select id from tree_items where translation_of = ${itemId} and content_language = ${language}`);
    const taken = existing.rows[0];
    if (taken) {
      const visible = await this.#authorization.authorize(actor, "item.view", { type: "item", id: taken.id });
      throw new SpaceError(
        "translationExists",
        "The article already has a translation into this language",
        visible ? { translationId: taken.id } : {},
      );
    }
    await this.#authorization.require(actor, "item.edit", { type: "item", id: itemId });
    const document =
      source.version_document !== null && source.version_schema !== null
        ? migrated(source.version_document, Number(source.version_schema))
        : source.draft_document !== null && source.draft_schema !== null
          ? migrated(source.draft_document, Number(source.draft_schema))
          : undefined;
    try {
      return await this.#tree.create(actor, source.space_id, {
        kind: "page",
        title: source.draft_title ?? source.title,
        description: source.description,
        placement: { parentId: itemId },
        mode: "publish",
        document,
        articleType: source.article_type,
        ...(source.template_id ? { templateId: source.template_id } : {}),
        translation: { of: itemId, language },
      });
    } catch (error) {
      const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
      if (cause?.code === "23505" && cause.constraint === "tree_items_translation_unique") {
        throw new SpaceError("translationExists", "The article already has a translation into this language");
      }
      throw error;
    }
  }
}
