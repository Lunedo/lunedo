import {
  type DocumentJson,
  type EmbedService,
  excerptContent,
  extractHeadings,
  type IncludedContent,
  type IncludeRequest,
  includeRequest,
  MAX_INCLUDE_DEPTH,
  type NodeJson,
  type RenderContext,
  renderHtml,
  resolveEmbed,
} from "@pagehall/editor-schema";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { ANONYMOUS, type Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import type { EmbedServices } from "../embeds/embeds.js";
import { exportTexts } from "../exports/texts.js";
import { defineJob, type JobQueue } from "../jobs/job-queue.js";
import type { Language } from "../mail/templates.js";
import { migrated } from "../spaces/documents.js";
import { includeKey } from "../spaces/includes.js";
import { interfaceLanguage } from "./portals.js";
import type { RenderedHeading } from "./schema.js";

export const ARTICLE_RENDERER = 3;
export const PORTAL_BASE_PLACEHOLDER = "/__portal__";
const TOC_LEVEL = 2;
const MAX_INCLUDES = 50;

export const renderArticleJob = defineJob({
  name: "portal.render-article",
  payload: z.object({ itemId: z.uuid() }),
  retryLimit: 3,
  retryDelaySeconds: 30,
});

export interface RenderedArticle {
  versionId: string;
  html: string;
  headings: RenderedHeading[];
}

export interface ArticleAddresses {
  page(number: number): string;
  file(attachmentId: string, display: boolean): string;
}

export const PORTAL_ADDRESSES: ArticleAddresses = {
  page: (number) => `${PORTAL_BASE_PLACEHOLDER}/${number}`,
  file: (attachmentId, display) =>
    `${PORTAL_BASE_PLACEHOLDER}/files/${attachmentId}${display ? "?size=display" : ""}`,
};

export interface DocumentSource {
  spaceId: string;
  itemId: string | null;
  language: string;
  document: DocumentJson;
}

interface Included {
  id: string;
  number: number;
  title: string;
  document: DocumentJson;
}

function walk(node: NodeJson, visit: (node: NodeJson) => void): void {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

const INCLUDES = new Set(["includePage", "includeExcerpt"]);

function references(document: DocumentJson): {
  images: Set<string>;
  pages: Set<string>;
  people: Set<string>;
  includes: IncludeRequest[];
  embeds: boolean;
} {
  const images = new Set<string>();
  const pages = new Set<string>();
  const people = new Set<string>();
  const includes: IncludeRequest[] = [];
  let embeds = false;
  walk(document as NodeJson, (node) => {
    const attrs = (node.attrs ?? {}) as Record<string, unknown>;
    if (node.type === "image" && typeof attrs.attachmentId === "string") images.add(attrs.attachmentId);
    if (node.type === "mention" && typeof attrs.id === "string") people.add(attrs.id);
    if (INCLUDES.has(node.type)) includes.push(includeRequest({ type: node.type, attrs }));
    if (node.type === "embed") embeds = true;
    for (const mark of node.marks ?? []) {
      const markAttrs = (mark.attrs ?? {}) as Record<string, unknown>;
      if (typeof markAttrs.pageId === "string") pages.add(markAttrs.pageId);
    }
    if (typeof attrs.pageId === "string" && !INCLUDES.has(node.type)) pages.add(attrs.pageId);
  });
  return { images, pages, people, includes, embeds };
}

export function hasLiveParts(document: DocumentJson): boolean {
  const found = references(document);
  return found.includes.length > 0 || found.embeds || found.pages.size > 0 || found.people.size > 0;
}

export class ArticleRenderer {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #jobs: JobQueue | undefined;
  readonly #embeds: EmbedServices | undefined;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    jobs?: JobQueue | undefined;
    embeds?: EmbedServices | undefined;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#jobs = options.jobs;
    this.#embeds = options.embeds;
  }

  async queue(itemId: string): Promise<void> {
    const result = await this.#database.execute<{ version_id: string | null }>(sql`
      select t.published_version_id as version_id from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${itemId} and s.type = 'knowledgeBase'`);
    const versionId = result.rows[0]?.version_id;
    if (versionId) await this.#jobs?.enqueue(renderArticleJob, { itemId }, { idempotencyKey: versionId });
  }

  async rendered(
    versionId: string,
    language: Language,
    reader: Principal = ANONYMOUS,
  ): Promise<RenderedArticle | null> {
    const cached = await this.#database.execute<{ html: string; headings: RenderedHeading[] }>(sql`
      select html, headings from article_renders
      where version_id = ${versionId} and language = ${language} and renderer = ${ARTICLE_RENDERER}`);
    const row = cached.rows[0];
    if (row) return { versionId, html: row.html, headings: row.headings };
    return this.render(versionId, language, reader);
  }

  async renderPublished(itemId: string): Promise<RenderedArticle | null> {
    const result = await this.#database.execute<{ version_id: string | null; language: string }>(sql`
      select t.published_version_id as version_id,
        case when t.translation_of is null then kb.default_language else t.content_language end as language
      from tree_items t join spaces s on s.id = t.space_id join knowledge_bases kb on kb.space_id = s.id
      where t.id = ${itemId} and s.type = 'knowledgeBase'`);
    const row = result.rows[0];
    return row?.version_id ? this.rendered(row.version_id, interfaceLanguage(row.language)) : null;
  }

  async render(
    versionId: string,
    language: Language,
    reader: Principal = ANONYMOUS,
  ): Promise<RenderedArticle | null> {
    const source = await this.versionSource(versionId);
    if (!source) return null;
    const { html, headings } = await this.renderDocument(source, language, PORTAL_ADDRESSES, reader);
    if (!hasLiveParts(source.document)) {
      await this.#database.execute(sql`
        insert into article_renders (version_id, language, renderer, html, headings)
        values (${versionId}, ${language}, ${ARTICLE_RENDERER}, ${html}, ${JSON.stringify(headings)}::jsonb)
        on conflict (version_id, language) do update set renderer = excluded.renderer, html = excluded.html,
          headings = excluded.headings, created_at = now()`);
    }
    return { versionId, html, headings };
  }

  async versionSource(versionId: string): Promise<DocumentSource | null> {
    const found = await this.#database.execute<{
      item_id: string;
      space_id: string;
      document: unknown;
      schema_version: number;
      language: string | null;
    }>(sql`
      select v.item_id, t.space_id, v.document, v.schema_version,
        case when t.translation_of is null then kb.default_language else t.content_language end as language
      from page_versions v join tree_items t on t.id = v.item_id
      left join knowledge_bases kb on kb.space_id = t.space_id
      where v.id = ${versionId}`);
    const row = found.rows[0];
    if (!row) return null;
    return {
      spaceId: row.space_id,
      itemId: row.item_id,
      language: row.language ?? "en",
      document: migrated(row.document, row.schema_version),
    };
  }

  async renderDocument(
    source: DocumentSource,
    language: Language,
    addresses: ArticleAddresses,
    reader: Principal,
  ): Promise<{ html: string; headings: RenderedHeading[] }> {
    const embeds = await this.#embedServices(source.spaceId, source.document);
    const context = await this.#context(source, language, addresses, embeds, reader, [], {
      remaining: MAX_INCLUDES,
    });
    const html = renderHtml(source.document, context);
    const headings = extractHeadings(source.document)
      .filter((heading) => heading.level <= TOC_LEVEL)
      .map((heading) => ({ id: heading.id, title: heading.text, level: heading.level }));
    return { html, headings };
  }

  async #embedServices(spaceId: string, document: DocumentJson): Promise<EmbedService[]> {
    if (!this.#embeds || !references(document).embeds) return [];
    const result = await this.#database.execute<{ organization_id: string | null }>(
      sql`select organization_id from spaces where id = ${spaceId}`,
    );
    const organizationId = result.rows[0]?.organization_id;
    return organizationId ? this.#embeds.organization(organizationId) : [];
  }

  #shareable(item: SQL, source: DocumentSource): SQL {
    return sql`(${item}.kind = 'page' and ${item}.space_id = ${source.spaceId}
      and ${item}.reader_visible and ${item}.trash_entry_id is null and ${item}.archived_root_id is null
      and ${item}.published_version_id is not null
      and not exists (select 1 from page_restrictions r where r.kind = 'view' and r.item_id = any(${item}.path)
        and r.item_id <> all(coalesce((select i.path from tree_items i where i.id = ${source.itemId}), '{}'::uuid[]))))`;
  }

  async #included(source: DocumentSource, request: IncludeRequest): Promise<Included | null> {
    if (!request.pageId || !source.itemId) return null;
    const result = await this.#database.execute<{
      id: string;
      number: number | null;
      title: string;
      document: unknown;
      schema_version: number;
    }>(sql`
      select coalesce(tr.id, t.id) as id, n.number, coalesce(tv.title, v.title) as title,
        coalesce(tv.document, v.document) as document,
        coalesce(tv.schema_version, v.schema_version) as schema_version
      from tree_items t
      join page_versions v on v.id = t.published_version_id
      left join article_numbers n on n.item_id = t.id and n.space_id = t.space_id
      left join lateral (select x.id, x.published_version_id from tree_items x
        where x.translation_of = t.id and x.content_language = ${source.language}
          and ${this.#shareable(sql`x`, source)}
        limit 1) tr on true
      left join page_versions tv on tv.id = tr.published_version_id
      where t.id = ${request.pageId} and t.translation_of is null and ${this.#shareable(sql`t`, source)}`);
    const row = result.rows[0];
    if (!row || row.number === null) return null;
    return {
      id: row.id,
      number: Number(row.number),
      title: row.title,
      document: migrated(row.document, row.schema_version),
    };
  }

  async #includes(
    source: DocumentSource,
    language: Language,
    addresses: ArticleAddresses,
    embeds: EmbedService[],
    reader: Principal,
    chain: string[],
    budget: { remaining: number },
  ): Promise<Map<string, IncludedContent>> {
    const included = new Map<string, IncludedContent>();
    for (const request of references(source.document).includes) {
      const key = includeKey(request);
      if (included.has(key)) continue;
      if (!request.pageId) {
        included.set(key, { state: "hidden" });
        continue;
      }
      if (budget.remaining <= 0 || chain.length >= MAX_INCLUDE_DEPTH) {
        included.set(key, { state: "depth" });
        continue;
      }
      const target = await this.#included(source, request);
      if (!target) {
        included.set(key, { state: "hidden" });
        continue;
      }
      if (target.id === source.itemId || chain.includes(target.id)) {
        included.set(key, { state: "loop" });
        continue;
      }
      budget.remaining -= 1;
      const content = request.excerpt
        ? excerptContent(target.document, request.name)
        : (target.document.content ?? []);
      if (!content) {
        included.set(key, { state: "noExcerpt" });
        continue;
      }
      const shown: DocumentJson = { type: "doc", content };
      const nested = await this.#context(
        { ...source, document: shown },
        language,
        addresses,
        embeds,
        reader,
        [...chain, target.id],
        budget,
      );
      included.set(key, {
        state: "visible",
        title: target.title,
        href: addresses.page(target.number),
        document: shown,
        context: nested,
      });
    }
    return included;
  }

  async #context(
    source: DocumentSource,
    language: Language,
    addresses: ArticleAddresses,
    embeds: EmbedService[],
    reader: Principal,
    chain: string[],
    budget: { remaining: number },
  ): Promise<RenderContext> {
    const { spaceId, document } = source;
    const { images, pages, people } = references(document);
    const targets = new Map<string, { number: number; title: string }>();
    if (pages.size > 0) {
      const result = await this.#database.execute<{ item_id: string; number: number; title: string }>(sql`
        select t.id as item_id, n.number, v.title
        from tree_items t join spaces s on s.id = t.space_id
        join page_versions v on v.id = t.published_version_id
        join article_numbers n on n.item_id = t.id and n.space_id = t.space_id
        where t.id = any(${sql.param([...pages])}::uuid[]) and t.space_id = ${spaceId}
          and t.kind = 'page' and t.translation_of is null and t.reader_visible
          and ${this.#authorization.portalFilter(reader, sql`t`, sql`s`)}`);
      for (const entry of result.rows) {
        targets.set(entry.item_id, { number: Number(entry.number), title: entry.title });
      }
    }
    const names = new Map<string, string>();
    if (people.size > 0) {
      const result = await this.#database.execute<{ id: string; name: string }>(sql`
        select a.id, a.name from accounts a join spaces s on s.id = ${spaceId}
        where a.id = any(${sql.param([...people])}::uuid[]) and a.state <> 'anonymized'
          and exists (select 1 from memberships m where m.organization_id = s.organization_id
            and m.account_id = a.id)`);
      for (const entry of result.rows) names.set(entry.id, entry.name);
    }
    const included = await this.#includes(source, language, addresses, embeds, reader, chain, budget);
    return {
      labels: exportTexts(language).labels,
      mention: (id) => {
        const name = names.get(id);
        return name ? { name } : null;
      },
      pageLink: (link) => {
        const target = link.pageId ? targets.get(link.pageId) : undefined;
        if (!target) return { href: "", title: "", accessible: false };
        return { href: addresses.page(target.number), title: target.title, accessible: true };
      },
      attachment: (id) => ({
        href: addresses.file(id, false),
        display: addresses.file(id, true),
        image: images.has(id),
      }),
      include: (request) => included.get(includeKey(request)) ?? { state: "hidden" },
      childPages: () => [],
      attachmentList: () => [],
      pageReport: () => [],
      decisionReport: () => [],
      taskReport: () => [],
      propertiesReport: () => ({ columns: [], rows: [], total: 0 }),
      contentByLabel: () => [],
      relatedLabels: () => [],
      embed: (url) => resolveEmbed(url, embeds),
      whiteboard: () => null,
      diagramReference: () => null,
      href: (href) => (href.startsWith("/") && !href.startsWith(`${PORTAL_BASE_PLACEHOLDER}/`) ? "" : href),
    };
  }
}
