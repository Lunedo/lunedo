import type { Readable } from "node:stream";
import type { DocumentJson, NodeJson } from "@pagehall/editor-schema";
import { uuidv7 } from "@pagehall/shared";
import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import type { AttachmentService } from "../files/attachments.js";
import { convertStorage, parseStorage } from "../imports/confluence/storage.js";
import { convertMarkdown } from "../imports/markdown/convert.js";
import type { ArticleRenderer } from "../portal/articles.js";
import { interfaceLanguage, type PortalService } from "../portal/portals.js";
import { SpaceError } from "../spaces/common.js";
import type { PageDocumentService } from "../spaces/documents.js";
import type { TreeService } from "../spaces/items.js";
import type { ArticleType } from "../spaces/schema.js";
import type { VersionService } from "../spaces/versions.js";
import { visibleItem } from "../spaces/visibility.js";
import { lastReviewedAt } from "./reviews.js";
import type { Article, ArticleSectionContent, KnowledgeBaseService } from "./service.js";
import { type ArticleLanguage, isArticleLanguage } from "./translations.js";

export const TOMBSTONE_DAYS = 90;
export const CHANGES_PAGE_SIZE = 50;
export const MAX_CHANGES_PAGE_SIZE = 200;
export const MAX_ARTICLE_SECTIONS = 50;
const SYNC_MARGIN_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const NOTE_MAX_LENGTH = 500;

export interface ArticleSectionInput {
  key: string;
  title?: string | undefined;
  icon?: string | null | undefined;
  markdown?: string | undefined;
  content?: unknown[] | undefined;
}

export interface ArticleWrite {
  title?: string | undefined;
  lead?: string | undefined;
  type?: ArticleType | null | undefined;
  categoryId?: string | null | undefined;
  sections?: ArticleSectionInput[] | undefined;
  versionNote?: string | undefined;
}

export interface ArticleCreate extends ArticleWrite {
  title: string;
  translationOf?: string | undefined;
  language?: string | undefined;
  publish?: boolean | undefined;
}

export interface ArticleImage {
  attachmentId: string;
  name: string;
  alt: string;
  url: string;
}

export interface ArticleSectionRecord extends ArticleSectionContent {
  html: string;
}

export interface ArticleRecord extends Omit<Article, "sections"> {
  sections: ArticleSectionRecord[];
  images: ArticleImage[];
  draft: boolean;
  publishedAt: Date | null;
  versionPublishedAt: Date | null;
  lastReviewedAt: Date | null;
  portalUrl: string | null;
}

export interface RemovedArticle {
  itemId: string;
  number: number | null;
  language: string | null;
  reason: "deleted" | "unpublished" | "moved";
  removedAt: Date;
}

export interface ArticleChanges {
  items: ArticleRecord[];
  removed: RemovedArticle[];
  nextCursor: string | null;
  nextChangedSince: Date;
}

interface ChangesCursor {
  key: string;
  itemId: string;
  until: string;
}

function encodeCursor(cursor: ChangesCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): ChangesCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ChangesCursor>;
    if (
      typeof parsed.key === "string" &&
      typeof parsed.itemId === "string" &&
      /^[0-9a-f-]{36}$/i.test(parsed.itemId) &&
      typeof parsed.until === "string" &&
      !Number.isNaN(Date.parse(parsed.until))
    ) {
      return { key: parsed.key, itemId: parsed.itemId, until: parsed.until };
    }
  } catch {}
  throw new SpaceError("invalidCursor", "The cursor is not valid. Start again without a cursor.");
}

function cleanNote(value: string | undefined): string | null {
  if (value === undefined) return null;
  const note = value.replace(/\s+/g, " ").trim();
  if (note.length > NOTE_MAX_LENGTH) {
    throw new SpaceError("invalidNote", `The note can have up to ${NOTE_MAX_LENGTH} characters`);
  }
  return note || null;
}

function walk(node: NodeJson, visit: (node: NodeJson) => void): void {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

export class ArticleApiService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #knowledgeBases: KnowledgeBaseService;
  readonly #tree: TreeService;
  readonly #documents: PageDocumentService;
  readonly #versions: VersionService;
  readonly #attachments: AttachmentService;
  readonly #renderer: ArticleRenderer;
  readonly #portals: PortalService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    knowledgeBases: KnowledgeBaseService;
    tree: TreeService;
    documents: PageDocumentService;
    versions: VersionService;
    attachments: AttachmentService;
    renderer: ArticleRenderer;
    portals: PortalService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#knowledgeBases = options.knowledgeBases;
    this.#tree = options.tree;
    this.#documents = options.documents;
    this.#versions = options.versions;
    this.#attachments = options.attachments;
    this.#renderer = options.renderer;
    this.#portals = options.portals;
  }

  async record(
    viewer: Principal,
    itemId: string,
    options: { draft?: boolean; origin: string; publishedOnly?: boolean },
  ): Promise<ArticleRecord | null> {
    const article = await this.#knowledgeBases.article(viewer, itemId, { draft: options.draft ?? false });
    if (!article) return null;
    const draft = options.draft === true;
    if (!draft && options.publishedOnly && article.version === null) return null;
    return this.#present(viewer, article, draft, options.origin);
  }

  async #present(
    viewer: Principal,
    article: Article,
    draft: boolean,
    origin: string,
  ): Promise<ArticleRecord> {
    const document: DocumentJson = article.document ?? { type: "doc", content: [] };
    const addresses = await this.#addresses(article, origin);
    const language = interfaceLanguage(article.language);
    const sections: ArticleSectionRecord[] = [];
    for (const section of article.sections) {
      const rendered = await this.#renderer.renderDocument(
        {
          spaceId: article.spaceId,
          itemId: article.id,
          language: article.language,
          document: { type: "doc", content: section.content },
        },
        language,
        addresses.renderer,
        viewer,
        { readerView: false },
      );
      sections.push({ ...section, html: rendered.html });
    }
    const images: { attachmentId: string; alt: string }[] = [];
    walk(document as NodeJson, (node) => {
      const attrs = (node.attrs ?? {}) as Record<string, unknown>;
      if (node.type === "image" && typeof attrs.attachmentId === "string") {
        images.push({
          attachmentId: attrs.attachmentId,
          alt: typeof attrs.alt === "string" ? attrs.alt : "",
        });
      }
    });
    const names = new Map<string, string>();
    if (images.length > 0) {
      const found = await this.#database.execute<{ id: string; name: string }>(sql`
        select id, name from attachments where item_id = ${article.id}
          and id = any(${sql.param(images.map((image) => image.attachmentId))}::uuid[])`);
      for (const row of found.rows) names.set(row.id, row.name);
    }
    const dates = await this.#database.execute<{
      published_at: Date | string | null;
      version_published_at: Date | string | null;
      reviewed_at: Date | string | null;
    }>(sql`
      select r.published_at, v.created_at as version_published_at, ${lastReviewedAt(sql`t`)} as reviewed_at
      from tree_items t left join article_reviews r on r.item_id = t.id
      left join page_versions v on v.id = t.published_version_id
      where t.id = ${article.id}`);
    const row = dates.rows[0];
    const date = (value: Date | string | null | undefined) => (value ? new Date(value) : null);
    return {
      ...article,
      sections,
      images: images
        .filter((image) => names.has(image.attachmentId))
        .map((image) => ({
          attachmentId: image.attachmentId,
          name: names.get(image.attachmentId) ?? "",
          alt: image.alt,
          url: addresses.renderer.file(image.attachmentId, true),
        })),
      draft,
      publishedAt: date(row?.published_at),
      versionPublishedAt: draft ? null : date(row?.version_published_at),
      lastReviewedAt: date(row?.reviewed_at),
      portalUrl:
        draft || article.number === null || article.version === null
          ? null
          : addresses.article(article.number, article.slug),
    };
  }

  async #addresses(article: Article, origin: string) {
    const config = await this.#portals.config(article.spaceId);
    const root = config?.domain ? `https://${config.domain}` : `${origin}/help/${config?.path ?? ""}`;
    const base = config && article.language !== config.defaultLanguage ? `${root}/${article.language}` : root;
    return {
      article: (number: number, slug: string) => `${base}/${number}${slug ? `-${slug}` : ""}`,
      renderer: {
        page: (number: number) => `${base}/${number}`,
        file: (attachmentId: string, display: boolean) =>
          `${origin}/api/v1/attachments/${attachmentId}/content${display ? "?size=display" : ""}`,
      },
    };
  }

  async changes(
    viewer: Principal,
    spaceId: string,
    options: {
      changedSince: Date | null;
      cursor: string | null;
      limit?: number;
      draft?: boolean;
      origin: string;
    },
  ): Promise<ArticleChanges> {
    const now = Date.now();
    const since = options.changedSince;
    if (since && since.getTime() < now - TOMBSTONE_DAYS * DAY_MS) {
      throw new SpaceError(
        "changedSinceTooOld",
        `Deleted articles are known for ${TOMBSTONE_DAYS} days. Fetch all articles again without changedSince.`,
        { maxDays: TOMBSTONE_DAYS },
      );
    }
    const kb = await this.#database.execute<{ found: boolean }>(
      sql`select exists (select 1 from spaces where id = ${spaceId} and type = 'knowledgeBase') as found`,
    );
    if (!kb.rows[0]?.found) throw new SpaceError("notKnowledgeBase", "The space is not a knowledge base");
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;
    const until = cursor ? new Date(cursor.until) : new Date(now - SYNC_MARGIN_MS);
    const limit = Math.min(Math.max(options.limit ?? CHANGES_PAGE_SIZE, 1), MAX_CHANGES_PAGE_SIZE);
    const draft = options.draft === true;
    const drafts: SQL = draft
      ? sql`union all
        select t.id as item_id, t.space_id, n.number,
          case when t.translation_of is null then kb.default_language else t.content_language end as language,
          null::timestamptz as removed_at, null::text as removed_reason, false as removed_restricted,
          greatest(d.changed_at, t.updated_at) as changed_at
        from tree_items t join page_documents d on d.item_id = t.id
        join knowledge_bases kb on kb.space_id = t.space_id
        left join article_numbers n on n.item_id = coalesce(t.translation_of, t.id) and n.space_id = t.space_id
        where t.space_id = ${spaceId} and t.kind = 'page' and t.trash_entry_id is null and t.archived_root_id is null`
      : sql``;
    const listed = await this.#database.execute<{
      item_id: string;
      number: number | null;
      language: string | null;
      removed_at: Date | string | null;
      removed_reason: RemovedArticle["reason"] | null;
      changed_key: string;
      present: boolean;
    }>(sql`
      with candidates as (
        select a.item_id, a.space_id, a.number, a.language, a.removed_at, a.removed_reason, a.removed_restricted,
          a.changed_at
        from article_sync a where a.space_id = ${spaceId}
        ${drafts}
      ),
      merged as (
        select distinct on (item_id) * from candidates order by item_id, changed_at desc
      ),
      keyed as (
        select m.*, to_char(m.changed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as changed_key
        from merged m
        where ${since ? sql`m.changed_at > ${since}::timestamptz` : sql`m.removed_at is null`}
      )
      select k.item_id, k.number, k.language, k.removed_at, k.removed_reason, k.changed_key,
        (k.removed_at is null) as present
      from keyed k
      where ((k.removed_at is not null and not k.removed_restricted) or exists (select 1 from tree_items t join spaces s on s.id = t.space_id
          where t.id = k.item_id and t.space_id = ${spaceId}
            and ${
              draft
                ? this.#authorization.itemFilter(viewer, sql`t`, sql`s`, "editor", { editRestriction: true })
                : visibleItem(this.#authorization, viewer, sql`t`, sql`s`)
            }))
        ${cursor ? sql`and (k.changed_key, k.item_id) > (${cursor.key}, ${cursor.itemId}::uuid)` : sql``}
      order by k.changed_key, k.item_id
      limit ${limit + 1}`);
    const rows = listed.rows.slice(0, limit);
    const items: ArticleRecord[] = [];
    const removed: RemovedArticle[] = [];
    for (const row of rows) {
      if (!row.present) {
        removed.push({
          itemId: row.item_id,
          number: row.number === null ? null : Number(row.number),
          language: row.language,
          reason: row.removed_reason ?? "deleted",
          removedAt: new Date(row.removed_at ?? Date.now()),
        });
        continue;
      }
      const record = await this.record(viewer, row.item_id, {
        draft,
        origin: options.origin,
        publishedOnly: true,
      });
      if (record) items.push(record);
    }
    const last = rows.at(-1);
    return {
      items,
      removed,
      nextCursor:
        listed.rows.length > limit && last
          ? encodeCursor({ key: last.changed_key, itemId: last.item_id, until: until.toISOString() })
          : null,
      nextChangedSince: until,
    };
  }

  async pruneRemoved(): Promise<number> {
    const result = await this.#database.execute(sql`
      delete from article_sync where removed_at < now() - make_interval(days => ${TOMBSTONE_DAYS})`);
    return result.rowCount ?? 0;
  }

  async #requireArticle(itemId: string): Promise<{ spaceId: string; published: boolean }> {
    const found = await this.#database.execute<{ space_id: string; published: boolean }>(sql`
      select t.space_id, t.published_version_id is not null as published
      from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${itemId} and t.kind = 'page' and s.type = 'knowledgeBase' and t.trash_entry_id is null`);
    const row = found.rows[0];
    if (!row) throw new SpaceError("notArticle", "The item is not an article of a knowledge base");
    return { spaceId: row.space_id, published: row.published };
  }

  async #document(actor: Principal, itemId: string, sections: ArticleSectionInput[]): Promise<DocumentJson> {
    if (sections.length > MAX_ARTICLE_SECTIONS) {
      throw new SpaceError("tooManySections", `An article can have up to ${MAX_ARTICLE_SECTIONS} sections`);
    }
    const files = await this.#attachments.list(actor, itemId, "draft");
    const content: NodeJson[] = [];
    for (const section of sections) {
      const blocks = section.content
        ? (section.content as NodeJson[])
        : await this.#fromMarkdown(section.markdown ?? "", files);
      content.push({
        type: "section",
        attrs: { key: section.key, title: section.title ?? "", icon: section.icon ?? null },
        content: blocks.length > 0 ? blocks : [{ type: "paragraph" }],
      });
    }
    return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
  }

  async #fromMarkdown(
    markdown: string,
    files: readonly { id: string; name: string; version: number }[],
  ): Promise<NodeJson[]> {
    if (markdown.trim() === "") return [];
    const byName = new Map(files.map((file) => [file.name.toLowerCase(), file]));
    const converted = convertMarkdown(markdown, {
      page: () => null,
      file: (target) => byName.get(decodeURIComponent(target).toLowerCase())?.name ?? null,
      problem: () => undefined,
    });
    const root = await parseStorage(converted.body);
    const page = convertStorage(root, {
      page: () => ({ kind: "external", href: null }),
      attachment: (reference) => {
        const file = byName.get(reference.fileName.toLowerCase());
        return file ? { attachmentId: file.id, name: file.name, version: file.version } : null;
      },
      person: () => null,
      space: () => null,
      newId: () => uuidv7(),
    });
    return page.document.content ?? [];
  }

  async #mayPublish(actor: Principal, itemId: string): Promise<boolean> {
    return (await this.#authorization.decide(actor, "item.publish", { type: "item", id: itemId })).allowed;
  }

  async #setDraftNote(itemId: string, note: string | null): Promise<void> {
    if (note === null) return;
    await this.#database.execute(
      sql`update page_documents set draft_note = ${note} where item_id = ${itemId}`,
    );
  }

  async create(
    actor: Principal,
    spaceId: string,
    input: ArticleCreate,
    origin: string,
  ): Promise<ArticleRecord> {
    const note = cleanNote(input.versionNote);
    const kb = await this.#database.execute<{ default_language: string; languages: string[] }>(sql`
      select kb.default_language, kb.languages from knowledge_bases kb join spaces s on s.id = kb.space_id
      where kb.space_id = ${spaceId} and s.type = 'knowledgeBase'`);
    const languages = kb.rows[0];
    if (!languages) throw new SpaceError("notKnowledgeBase", "The space is not a knowledge base");
    let translation: { of: string; language: ArticleLanguage } | undefined;
    let parentId = input.categoryId ?? null;
    if (input.translationOf) {
      const language = input.language ?? "";
      if (!isArticleLanguage(language) || language === languages.default_language) {
        throw new SpaceError(
          "invalidLanguage",
          "Give the language of the translation, other than the default",
        );
      }
      if (!languages.languages.includes(language)) {
        throw new SpaceError(
          "languageNotEnabled",
          "Enable the language in the knowledge base settings before you add a translation into it",
        );
      }
      await this.#authorization.require(actor, "item.editDraft", { type: "item", id: input.translationOf });
      translation = { of: input.translationOf, language };
      parentId = input.translationOf;
    } else if (input.language && input.language !== languages.default_language) {
      throw new SpaceError(
        "invalidLanguage",
        "New articles are in the default language. Add a translation with translationOf.",
      );
    }
    if (input.publish) await this.#requirePublishLevel(actor, spaceId);
    const created = await this.#tree.create(actor, spaceId, {
      kind: "page",
      title: input.title,
      description: input.lead ?? "",
      placement: { parentId },
      mode: "publish",
      document: { type: "doc", content: [{ type: "paragraph" }] },
      articleType: input.type ?? null,
      ...(translation ? { translation } : {}),
    });
    if (input.sections) {
      await this.#documents.replace(
        actor,
        created.id,
        await this.#document(actor, created.id, input.sections),
      );
    }
    if (input.publish) {
      await this.#versions.publish(actor, created.id, note ? { note } : {});
      await this.#renderer.queue(created.id);
    } else {
      await this.#setDraftNote(created.id, note);
    }
    const record = await this.record(actor, created.id, { draft: !input.publish, origin });
    if (!record) throw new SpaceError("itemNotFound", "The article was not created");
    return record;
  }

  async #requirePublishLevel(actor: Principal, spaceId: string): Promise<void> {
    const decision = await this.#authorization.decide(actor, "space.edit", { type: "space", id: spaceId });
    if (!decision.allowed) {
      throw new SpaceError(
        "publishNotAllowed",
        "This token or account may only save drafts. A person publishes them in Pagehall.",
      );
    }
  }

  async saveDraft(
    actor: Principal,
    itemId: string,
    input: ArticleWrite,
    origin: string,
  ): Promise<ArticleRecord> {
    const note = cleanNote(input.versionNote);
    const article = await this.#requireArticle(itemId);
    const immediate = input.type !== undefined || input.categoryId !== undefined || input.lead !== undefined;
    if (immediate && article.published && !(await this.#mayPublish(actor, itemId))) {
      throw new SpaceError(
        "publishNotAllowed",
        "Type, category and lead of a published article change at once for readers. Only those who may publish can change them; save the sections and title as a draft instead.",
      );
    }
    if (input.title !== undefined || input.lead !== undefined) {
      await this.#tree.update(actor, itemId, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.lead !== undefined ? { description: input.lead } : {}),
      });
    }
    if (input.type !== undefined) await this.#knowledgeBases.setArticleType(itemId, input.type);
    if (input.categoryId !== undefined) {
      await this.#tree.move(actor, itemId, { parentId: input.categoryId });
    }
    if (input.sections) {
      await this.#documents.replace(actor, itemId, await this.#document(actor, itemId, input.sections));
    }
    await this.#setDraftNote(itemId, note);
    const record = await this.record(actor, itemId, { draft: true, origin });
    if (!record) throw new SpaceError("itemNotFound", "The article does not exist");
    return record;
  }

  async addImage(
    actor: Principal,
    itemId: string,
    input: { name: string; body: Readable; contentLength?: number | undefined },
  ) {
    await this.#requireArticle(itemId);
    return this.#attachments.upload(actor, itemId, input);
  }

  async publish(
    actor: Principal,
    itemId: string,
    input: { versionNote?: string | undefined },
    origin: string,
  ): Promise<ArticleRecord> {
    await this.#requireArticle(itemId);
    const note = cleanNote(input.versionNote);
    const published = await this.#versions.publish(actor, itemId, note ? { note } : {});
    if (published.created) await this.#renderer.queue(itemId);
    const record = await this.record(actor, itemId, { origin });
    if (!record) throw new SpaceError("itemNotFound", "The article does not exist");
    return record;
  }
}
