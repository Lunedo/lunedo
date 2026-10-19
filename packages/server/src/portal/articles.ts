import {
  type DocumentJson,
  extractHeadings,
  type NodeJson,
  type RenderContext,
  renderHtml,
} from "@pagehall/editor-schema";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/database.js";
import { exportTexts } from "../exports/texts.js";
import { defineJob, type JobQueue } from "../jobs/job-queue.js";
import type { Language } from "../mail/templates.js";
import { migrated } from "../spaces/documents.js";
import type { RenderedHeading } from "./schema.js";

export const ARTICLE_RENDERER = 1;
export const PORTAL_BASE_PLACEHOLDER = "/__portal__";
const TOC_LEVEL = 2;

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

function walk(node: NodeJson, visit: (node: NodeJson) => void): void {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

function references(document: DocumentJson): {
  images: Set<string>;
  pages: Set<string>;
  people: Set<string>;
} {
  const images = new Set<string>();
  const pages = new Set<string>();
  const people = new Set<string>();
  walk(document as NodeJson, (node) => {
    const attrs = (node.attrs ?? {}) as Record<string, unknown>;
    if (node.type === "image" && typeof attrs.attachmentId === "string") images.add(attrs.attachmentId);
    if (node.type === "mention" && typeof attrs.id === "string") people.add(attrs.id);
    for (const mark of node.marks ?? []) {
      const markAttrs = (mark.attrs ?? {}) as Record<string, unknown>;
      if (typeof markAttrs.pageId === "string") pages.add(markAttrs.pageId);
    }
    if (typeof attrs.pageId === "string") pages.add(attrs.pageId);
  });
  return { images, pages, people };
}

export class ArticleRenderer {
  readonly #database: Database;
  readonly #jobs: JobQueue | undefined;

  constructor(options: { database: Database; jobs?: JobQueue | undefined }) {
    this.#database = options.database;
    this.#jobs = options.jobs;
  }

  async queue(itemId: string): Promise<void> {
    const result = await this.#database.execute<{ version_id: string | null }>(sql`
      select t.published_version_id as version_id from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${itemId} and s.type = 'knowledgeBase'`);
    const versionId = result.rows[0]?.version_id;
    if (versionId) await this.#jobs?.enqueue(renderArticleJob, { itemId }, { idempotencyKey: versionId });
  }

  async rendered(versionId: string, language: Language): Promise<RenderedArticle | null> {
    const cached = await this.#database.execute<{ html: string; headings: RenderedHeading[] }>(sql`
      select html, headings from article_renders
      where version_id = ${versionId} and language = ${language} and renderer = ${ARTICLE_RENDERER}`);
    const row = cached.rows[0];
    if (row) return { versionId, html: row.html, headings: row.headings };
    return this.render(versionId, language);
  }

  async renderPublished(itemId: string, language: Language): Promise<RenderedArticle | null> {
    const result = await this.#database.execute<{ version_id: string | null }>(sql`
      select t.published_version_id as version_id from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${itemId} and s.type = 'knowledgeBase'`);
    const versionId = result.rows[0]?.version_id;
    return versionId ? this.rendered(versionId, language) : null;
  }

  async render(versionId: string, language: Language): Promise<RenderedArticle | null> {
    const found = await this.#database.execute<{
      item_id: string;
      space_id: string;
      document: unknown;
      schema_version: number;
    }>(sql`
      select v.item_id, t.space_id, v.document, v.schema_version from page_versions v
      join tree_items t on t.id = v.item_id where v.id = ${versionId}`);
    const row = found.rows[0];
    if (!row) return null;
    const document = migrated(row.document, row.schema_version);
    const context = {
      ...(await this.#context(row.space_id, document)),
      labels: exportTexts(language).labels,
    };
    const html = renderHtml(document, context);
    const headings = extractHeadings(document)
      .filter((heading) => heading.level <= TOC_LEVEL)
      .map((heading) => ({ id: heading.id, title: heading.text, level: heading.level }));
    await this.#database.execute(sql`
      insert into article_renders (version_id, language, renderer, html, headings)
      values (${versionId}, ${language}, ${ARTICLE_RENDERER}, ${html}, ${JSON.stringify(headings)}::jsonb)
      on conflict (version_id, language) do update set renderer = excluded.renderer, html = excluded.html,
        headings = excluded.headings, created_at = now()`);
    return { versionId, html, headings };
  }

  async #context(spaceId: string, document: DocumentJson): Promise<RenderContext> {
    const { images, pages, people } = references(document);
    const numbers = new Map<string, number>();
    if (pages.size > 0) {
      const result = await this.#database.execute<{ item_id: string; number: number }>(sql`
        select n.item_id, n.number from article_numbers n join tree_items t on t.id = n.item_id
        where n.space_id = ${spaceId} and t.space_id = ${spaceId}
          and n.item_id = any(${sql.param([...pages])}::uuid[])`);
      for (const entry of result.rows) numbers.set(entry.item_id, Number(entry.number));
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
    return {
      mention: (id) => {
        const name = names.get(id);
        return name ? { name } : null;
      },
      pageLink: (link) => {
        const number = link.pageId ? numbers.get(link.pageId) : undefined;
        if (number === undefined) return { href: "", title: "", accessible: false };
        return { href: `${PORTAL_BASE_PLACEHOLDER}/${number}`, title: link.title ?? "", accessible: true };
      },
      attachment: (id) => ({
        href: `${PORTAL_BASE_PLACEHOLDER}/files/${id}`,
        display: `${PORTAL_BASE_PLACEHOLDER}/files/${id}?size=display`,
        image: images.has(id),
      }),
      include: () => ({ state: "hidden" }),
      childPages: () => [],
      attachmentList: () => [],
      pageReport: () => [],
      decisionReport: () => [],
      taskReport: () => [],
      propertiesReport: () => ({ columns: [], rows: [], total: 0 }),
      contentByLabel: () => [],
      relatedLabels: () => [],
      embed: () => null,
      whiteboard: () => null,
      diagramReference: () => null,
      href: (href) => (href.startsWith("/") && !href.startsWith(`${PORTAL_BASE_PLACEHOLDER}/`) ? "" : href),
    };
  }
}
