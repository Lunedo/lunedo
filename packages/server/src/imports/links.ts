import { slugify } from "@pagehall/editor-schema";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import { spaceKeyFor, visibleItem } from "../spaces/visibility.js";
import { titleKey } from "./confluence/staged.js";
import { ImportError } from "./errors.js";

export const CONFLUENCE_LINK_MAX_LENGTH = 2000;
const TINY_CODE = /^[A-Za-z0-9_-]{1,11}$/;
const PAGE_ID = /^\d{1,19}$/;

export type ConfluenceLink =
  | { readonly kind: "id"; readonly pageId: string }
  | { readonly kind: "title"; readonly spaceKey: string; readonly title: string; readonly blog: boolean };

export interface ResolvedLink {
  readonly itemId: string;
  readonly kind: "page" | "blogPost";
  readonly spaceKey: string;
  readonly title: string;
  readonly slug: string;
}

export function tinyLinkCode(pageId: string): string {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(pageId));
  return bytes
    .toString("base64")
    .replaceAll("/", "-")
    .replaceAll("+", "_")
    .replace(/[A=]+$/, "");
}

export function decodeTinyLink(code: string): string | null {
  if (!TINY_CODE.test(code)) return null;
  const base64 = code.replaceAll("-", "/").replaceAll("_", "+").padEnd(11, "A");
  const bytes = Buffer.from(`${base64}=`, "base64");
  if (bytes.length !== 8) return null;
  const id = bytes.readBigUInt64LE();
  return id > 0n ? id.toString() : null;
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part.replaceAll("+", " "));
  } catch {
    return part;
  }
}

export function parseConfluenceLink(input: string): ConfluenceLink | null {
  const value = input.trim();
  if (value.length === 0 || value.length > CONFLUENCE_LINK_MAX_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value, "https://confluence.invalid");
  } catch {
    return null;
  }
  const pageId = url.searchParams.get("pageId");
  if (pageId !== null) return PAGE_ID.test(pageId) ? { kind: "id", pageId } : null;
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  const tiny = segments.indexOf("x");
  if (tiny >= 0 && segments[tiny + 1] && tiny + 2 === segments.length) {
    const id = decodeTinyLink(segments[tiny + 1] as string);
    return id ? { kind: "id", pageId: id } : null;
  }
  const pages = segments.indexOf("pages");
  if (pages >= 0) {
    const rest = segments.slice(pages + 1);
    const id = rest.find((segment) => PAGE_ID.test(segment));
    if (id && (rest[0] === id || rest[0] === "edit-v2" || rest[0] === "edit"))
      return { kind: "id", pageId: id };
  }
  const blog = segments.indexOf("blog");
  if (blog >= 0 && segments.indexOf("spaces") >= 0) {
    const rest = segments.slice(blog + 1);
    const dated = rest.length >= 4 && /^\d{4}$/.test(rest[0] ?? "") ? rest.slice(3) : rest;
    const id = dated[0];
    if (id && PAGE_ID.test(id)) return { kind: "id", pageId: id };
  }
  const display = segments.indexOf("display");
  if (display >= 0) {
    const rest = segments.slice(display + 1);
    const spaceKey = rest[0] ? decode(rest[0]) : "";
    const dated =
      rest.length === 5 && /^\d{4}$/.test(rest[1] ?? "") && /^\d{2}$/.test(rest[2] ?? "") ? rest[4] : null;
    const title = dated ?? (rest.length === 2 ? rest[1] : undefined);
    if (!spaceKey || !title) return null;
    return { kind: "title", spaceKey, title: decode(title), blog: dated !== null };
  }
  return null;
}

export class ConfluenceLinkService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;

  constructor(options: { database: Database; authorization: AuthorizationService }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
  }

  async resolve(viewer: Principal, url: string): Promise<ResolvedLink> {
    const link = parseConfluenceLink(url);
    const found = link ? await this.#find(viewer, link) : null;
    if (!found) {
      throw new ImportError(
        "confluenceLinkNotFound",
        "No page you can open was imported from this Confluence link. Check the link, or ask someone with access.",
      );
    }
    return found;
  }

  async #find(viewer: Principal, link: ConfluenceLink): Promise<ResolvedLink | null> {
    const candidates =
      link.kind === "id"
        ? sql`
          select b.target_id as id, 0 as rank, b.recorded_at as at from import_baselines b
          where b.kind = 'page' and b.source_id = ${link.pageId} and b.target_id is not null
          union all
          select i.target_id, 1, i.created_at from import_items i
          where i.kind = 'page' and i.source_id = ${link.pageId}`
        : sql`
          select b.target_id as id, 0 as rank, b.recorded_at as at from import_titles n
          join import_baselines b on b.space_id = n.space_id and b.kind = 'page' and b.source_id = n.source_id
          where n.space_key = ${link.spaceKey.toLowerCase()} and n.title_key = ${titleKey(link.title)}
            and b.target_id is not null
          union all
          select t.id, 1, t.updated_at from imported_spaces x join tree_items t on t.space_id = x.space_id
          where x.source_space_key = ${link.spaceKey.toLowerCase()}
            and lower(trim(t.title)) = ${titleKey(link.title)}
            and t.kind = ${link.blog ? "blogPost" : "page"}`;
    const result = await this.#database.execute<{
      id: string;
      kind: "page" | "blogPost";
      title: string;
      space_key: string;
    }>(sql`
      with candidates as (${candidates})
      select t.id, t.kind::text as kind, t.title, ${spaceKeyFor(this.#authorization, viewer, sql`s`)} as space_key
      from candidates c join tree_items t on t.id = c.id join spaces s on s.id = t.space_id
      where t.kind in ('page', 'blogPost') and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
      order by c.rank, c.at desc, t.id
      limit 1`);
    const row = result.rows[0];
    return row
      ? {
          itemId: row.id,
          kind: row.kind,
          spaceKey: row.space_key,
          title: row.title,
          slug: slugify(row.title),
        }
      : null;
  }
}
