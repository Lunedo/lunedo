import { type DocumentJson, excerptContent, type IncludeRequest } from "@lunedo/editor-schema";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import { importedTitleCandidates } from "../imports/links.js";
import { itemAddress } from "./addresses.js";
import type { PageDocumentService } from "./documents.js";
import { readersWithoutAccess } from "./move-impact.js";
import { visibleItem } from "./visibility.js";

export interface IncludedPage {
  id: string;
  title: string;
  path: string;
  spaceId: string;
}

export type Inclusion = (
  | { state: "visible"; page: IncludedPage; document: DocumentJson }
  | { state: "noExcerpt"; page: IncludedPage }
) & { hiddenFromSomeReaders: boolean };

export function includeKey(request: IncludeRequest): string {
  return JSON.stringify([
    request.pageId,
    request.sourceSpace,
    request.sourceTitle,
    request.excerpt,
    request.name,
  ]);
}

export class IncludeService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #documents: PageDocumentService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    documents: PageDocumentService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#documents = options.documents;
  }

  async target(
    viewer: Principal,
    includingId: string,
    request: IncludeRequest,
  ): Promise<IncludedPage | null> {
    const visible = visibleItem(this.#authorization, viewer, sql`t`, sql`s`);
    const candidates = request.pageId
      ? sql`select ${request.pageId}::uuid as id, 0 as rank, now() as at`
      : request.sourceTitle && request.sourceSpace
        ? sql`${importedTitleCandidates(request.sourceSpace, request.sourceTitle, "page")}
            union all ${importedTitleCandidates(request.sourceSpace, request.sourceTitle, "blogPost")}`
        : null;
    if (!candidates) return null;
    const result = await this.#database.execute<{
      id: string;
      number: string;
      title: string;
      kind: string;
      key: string;
      space_id: string;
    }>(sql`
      with candidates as (${candidates})
      select t.id, t.number, t.title, t.kind::text as kind, s.key, s.id as space_id
      from candidates c join tree_items t on t.id = c.id join spaces s on s.id = t.space_id
      where t.kind in ('page', 'blogPost') and ${visible}
        ${
          request.pageId
            ? sql``
            : sql`and s.organization_id is not distinct from (
                select x.organization_id from tree_items i join spaces x on x.id = i.space_id where i.id = ${includingId})`
        }
      order by c.rank, c.at desc, t.id
      limit 1`);
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          title: row.title,
          path: itemAddress(row.kind, row.key, row.number, row.title) ?? "",
          spaceId: row.space_id,
        }
      : null;
  }

  async content(viewer: Principal, includingId: string, request: IncludeRequest): Promise<Inclusion | null> {
    const page = await this.target(viewer, includingId, request);
    if (!page) return null;
    const readable = await this.#documents.readable(page.id);
    if (!readable) return null;
    const included = { ...page, title: readable.title };
    const hiddenFromSomeReaders = await this.#hiddenFromSomeReaders(viewer, includingId, page.id);
    if (!request.excerpt) {
      return { state: "visible", page: included, document: readable.document, hiddenFromSomeReaders };
    }
    const excerpt = excerptContent(readable.document, request.name);
    return excerpt
      ? {
          state: "visible",
          page: included,
          document: { type: "doc", content: excerpt },
          hiddenFromSomeReaders,
        }
      : { state: "noExcerpt", page: included, hiddenFromSomeReaders };
  }

  async #hiddenFromSomeReaders(viewer: Principal, includingId: string, targetId: string): Promise<boolean> {
    if (includingId === targetId) return false;
    const editor = await this.#authorization.explain(viewer, "item.edit", { type: "item", id: includingId });
    if (!editor.allowed) return false;
    return readersWithoutAccess(this.#database, includingId, targetId);
  }
}
