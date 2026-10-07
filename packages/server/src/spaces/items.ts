import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import { type AuthorizationService, ForbiddenError } from "../authorization/service.js";
import { type AccessImpact, accessImpact } from "../authorization/space-access.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { SettingsService } from "../settings/service.js";
import { actorIdOf, currentGrants, SpaceError } from "./common.js";
import { insertInitialDocument, type PageDocumentService } from "./documents.js";
import { positionBetween } from "./fractional-index.js";
import type { PeopleService } from "./people.js";
import type { PageMode, PageWidth, TreeItemKind } from "./schema.js";
import { defaultPageModeSetting } from "./settings.js";
import { signalSpaceChange } from "./signals.js";
import { insertFirstVersion, type VersionService } from "./versions.js";
import { publishedFor, visibleItem } from "./visibility.js";

export const ITEM_TITLE_MAX_LENGTH = 255;
export const ITEM_DESCRIPTION_MAX_LENGTH = 1000;
export const LINK_URL_MAX_LENGTH = 2048;
export const MAX_TREE_PAGE = 500;

export interface ItemLink {
  itemId: string | null;
  url: string | null;
  accessible: boolean;
  inTrash: boolean;
  target: { spaceId: string; spaceKey: string; kind: TreeItemKind; title: string } | null;
}

export interface TreeItem {
  id: string;
  spaceId: string;
  parentId: string | null;
  kind: TreeItemKind;
  title: string;
  description: string;
  width: PageWidth;
  mode: PageMode;
  published: boolean;
  archived: boolean;
  position: string;
  hasChildren: boolean;
  link: ItemLink | null;
  creatorId: string | null;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
  contentUpdatedAt: Date;
}

export interface ItemDetails extends TreeItem {
  spaceKey: string;
  spaceName: string;
  ancestors: { id: string; kind: TreeItemKind; title: string }[];
}

export interface Placement {
  parentId: string | null;
  beforeId?: string | null | undefined;
  afterId?: string | null | undefined;
}

type ItemRow = {
  id: string;
  space_id: string;
  parent_id: string | null;
  kind: TreeItemKind;
  title: string;
  description: string;
  width: PageWidth;
  mode: PageMode;
  published: boolean;
  archived: boolean;
  position: string;
  has_children: boolean;
  link_item_id: string | null;
  link_url: string | null;
  link_accessible: boolean | null;
  link_in_trash: boolean | null;
  link_space_id: string | null;
  link_space_key: string | null;
  link_kind: TreeItemKind | null;
  link_title: string | null;
  creator_id: string | null;
  owner_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  content_updated_at: Date | string;
};

function cleanTitle(title: string): string {
  const value = title.replace(/\s+/g, " ").trim();
  if (value.length === 0 || value.length > ITEM_TITLE_MAX_LENGTH) {
    throw new SpaceError("invalidTitle", `The title needs 1 to ${ITEM_TITLE_MAX_LENGTH} characters`);
  }
  return value;
}

function cleanDescription(description: string): string {
  const value = description.trim();
  if (value.length > ITEM_DESCRIPTION_MAX_LENGTH) {
    throw new SpaceError(
      "invalidDescription",
      `The description can have up to ${ITEM_DESCRIPTION_MAX_LENGTH} characters`,
    );
  }
  return value;
}

export function cleanLinkUrl(url: string): string {
  const value = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SpaceError("invalidLinkUrl", "Enter a full address that starts with http:// or https://");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    value.length > LINK_URL_MAX_LENGTH ||
    parsed.username ||
    parsed.password
  ) {
    throw new SpaceError("invalidLinkUrl", "Enter a full address that starts with http:// or https://");
  }
  return parsed.toString();
}

function toItem(row: ItemRow): TreeItem {
  const isLink = row.kind === "link";
  const accessible = row.link_url !== null || row.link_accessible === true;
  return {
    id: row.id,
    spaceId: row.space_id,
    parentId: row.parent_id,
    kind: row.kind,
    title: isLink && !accessible ? "" : row.title,
    description: row.description,
    width: row.width,
    mode: row.mode,
    published: row.published,
    archived: row.archived,
    position: row.position,
    hasChildren: row.has_children,
    link: isLink
      ? {
          itemId: accessible ? row.link_item_id : null,
          url: row.link_url,
          accessible,
          inTrash: !accessible && row.link_in_trash === true,
          target:
            accessible && row.link_space_id && row.link_space_key && row.link_kind && row.link_title !== null
              ? {
                  spaceId: row.link_space_id,
                  spaceKey: row.link_space_key,
                  kind: row.link_kind,
                  title: row.link_title,
                }
              : null,
        }
      : null,
    creatorId: row.creator_id,
    ownerId: row.owner_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    contentUpdatedAt: new Date(row.content_updated_at),
  };
}

export async function insertPage(
  tx: Transaction,
  input: {
    spaceId: string;
    parentId: string | null;
    title: string;
    actorId: string | null;
    mode: PageMode;
    published?: boolean;
  },
): Promise<string> {
  const id = uuidv7();
  const position = await endPosition(tx, input.spaceId, input.parentId);
  await tx.execute(sql`
    insert into tree_items (id, space_id, parent_id, kind, position, title, mode, creator_id, owner_id)
    values (${id}, ${input.spaceId}, ${input.parentId}, 'page', ${position}, ${cleanTitle(input.title)},
      ${input.mode}, ${input.actorId}, ${input.actorId})`);
  await insertInitialDocument(tx, id, input.actorId);
  if (input.published) await insertFirstVersion(tx, id, input.actorId);
  return id;
}

export async function defaultPageMode(
  settings: SettingsService,
  space: { id: string; organizationId: string | null },
): Promise<PageMode> {
  return settings.get(defaultPageModeSetting, {
    ...(space.organizationId ? { organization: space.organizationId } : {}),
    space: space.id,
  });
}

async function endPosition(executor: Executor, spaceId: string, parentId: string | null): Promise<string> {
  const result = await executor.execute<{ position: string | null }>(sql`
    select max(position) as position from tree_items
    where space_id = ${spaceId} and parent_id is not distinct from ${parentId}`);
  return positionBetween(result.rows[0]?.position ?? null, null);
}

export async function lockSpaces(tx: Transaction, spaceIds: string[]): Promise<void> {
  for (const id of [...new Set(spaceIds)].sort()) {
    const result = await tx.execute<{ id: string }>(sql`select id from spaces where id = ${id} for update`);
    if (!result.rows[0]) throw new SpaceError("spaceNotFound", "The space does not exist");
  }
}

export class TreeService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #documents: PageDocumentService;
  readonly #people: PeopleService;
  readonly #versions: VersionService;
  readonly #settings: SettingsService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    documents: PageDocumentService;
    people: PeopleService;
    versions: VersionService;
    settings: SettingsService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#documents = options.documents;
    this.#people = options.people;
    this.#versions = options.versions;
    this.#settings = options.settings;
  }

  async #modeFor(spaceId: string, requested: PageMode | undefined): Promise<PageMode> {
    if (requested) return requested;
    const space = await this.#database.execute<{ organization_id: string | null }>(
      sql`select organization_id from spaces where id = ${spaceId}`,
    );
    return defaultPageMode(this.#settings, {
      id: spaceId,
      organizationId: space.rows[0]?.organization_id ?? null,
    });
  }

  async followTitleLink(
    actor: Principal,
    sourceItemId: string,
    target: { spaceId: string; title: string },
  ): Promise<{ itemId: string; created: boolean }> {
    const title = cleanTitle(target.title);
    const readable = await this.#authorization.explain(actor, "space.view", {
      type: "space",
      id: target.spaceId,
    });
    if (!readable.allowed) throw new ForbiddenError(readable);
    let itemId = await this.findByTitle(target.spaceId, title);
    let created = false;
    if (!itemId) {
      await this.#requireEdit(actor, target.spaceId);
      itemId = await this.#database.transaction(async (tx) => {
        await lockSpaces(tx, [target.spaceId]);
        const existing = await this.findByTitle(target.spaceId, title, tx);
        if (existing) return existing;
        created = true;
        const id = await insertPage(tx, {
          spaceId: target.spaceId,
          parentId: null,
          title,
          actorId: actorIdOf(actor),
          mode: await this.#modeFor(target.spaceId, undefined),
        });
        await signalSpaceChange(tx, { spaceId: target.spaceId, kind: "tree", itemId: id });
        return id;
      });
    }
    const editable = await this.#authorization.explain(actor, "item.edit", {
      type: "item",
      id: sourceItemId,
    });
    if (editable.allowed) {
      await this.#documents.resolveTitleLinks(actor, sourceItemId, {
        spaceId: target.spaceId,
        title,
        pageId: itemId,
      });
    }
    return { itemId, created };
  }

  #select(viewer: Principal) {
    return sql`select t.id, t.space_id, t.parent_id, t.kind, t.title, t.description, t.width, t.mode,
        (t.kind <> 'page' or t.mode = 'live' or t.published_version_id is not null) as published,
        (t.archived_root_id is not null) as archived, t.position,
        exists (select 1 from tree_items c where c.parent_id = t.id and c.trash_entry_id is null
          and ${publishedFor(this.#authorization, viewer, sql`c`, sql`ts`)}) as has_children,
        t.link_item_id, t.link_url,
        (lt.id is not null and ${visibleItem(this.#authorization, viewer, sql`lt`, sql`ls`)}) as link_accessible,
        (lt.trash_entry_id is not null and ${this.#authorization.spaceFilter(viewer, sql`ls`)}) as link_in_trash,
        lt.space_id as link_space_id, ls.key as link_space_key, lt.kind as link_kind, lt.title as link_title,
        t.creator_id, t.owner_id, t.created_at, t.updated_at, t.content_updated_at
      from tree_items t
      join spaces ts on ts.id = t.space_id
      left join tree_items lt on lt.id = t.link_item_id
      left join spaces ls on ls.id = lt.space_id`;
  }

  async children(
    viewer: Principal,
    spaceId: string,
    parentId: string | null,
    options: { after?: string | undefined; limit?: number } = {},
  ): Promise<{ items: TreeItem[]; next: string | null }> {
    const limit = Math.min(Math.max(options.limit ?? MAX_TREE_PAGE, 1), MAX_TREE_PAGE);
    const result = await this.#database.execute<ItemRow>(sql`
      ${this.#select(viewer)}
      where t.space_id = ${spaceId}
        and coalesce(t.parent_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(${parentId}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        and t.trash_entry_id is null
        and ${
          parentId === null
            ? sql`t.archived_root_id is null`
            : sql`t.archived_root_id is not distinct from (select archived_root_id from tree_items where id = ${parentId})`
        }
        and ${publishedFor(this.#authorization, viewer, sql`t`, sql`ts`)}
        ${options.after ? sql`and t.position > ${options.after}` : sql``}
      order by t.position
      limit ${limit + 1}`);
    const rows = result.rows.slice(0, limit);
    return {
      items: rows.map(toItem),
      next: result.rows.length > limit ? (rows.at(-1)?.position ?? null) : null,
    };
  }

  async get(
    viewer: Principal,
    itemId: string,
    executor: Executor = this.#database,
  ): Promise<TreeItem | null> {
    const result = await executor.execute<ItemRow>(sql`${this.#select(viewer)} where t.id = ${itemId}`);
    const row = result.rows[0];
    return row ? toItem(row) : null;
  }

  async details(viewer: Principal, itemId: string): Promise<ItemDetails | null> {
    const item = await this.get(viewer, itemId);
    if (!item) return null;
    const space = await this.#database.execute<{ key: string; name: string; editor: boolean }>(
      sql`select s.key, s.name, ${this.#authorization.spaceFilter(viewer, sql`s`, "editor")} as editor
        from spaces s where s.id = ${item.spaceId}`,
    );
    const ancestors = await this.ancestors(itemId);
    const hidden = space.rows[0]?.editor
      ? new Set<string>()
      : await this.#unpublished(ancestors.map((a) => a.id));
    return {
      ...item,
      spaceKey: space.rows[0]?.key ?? "",
      spaceName: space.rows[0]?.name ?? "",
      ancestors: ancestors.filter((ancestor) => !hidden.has(ancestor.id)),
    };
  }

  async #unpublished(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const result = await this.#database.execute<{ id: string }>(sql`
      select id from tree_items where id = any(${sql.param(ids)}::uuid[])
        and kind = 'page' and mode = 'publish' and published_version_id is null`);
    return new Set(result.rows.map((row) => row.id));
  }

  async ancestors(
    itemId: string,
    executor: Executor = this.#database,
  ): Promise<{ id: string; kind: TreeItemKind; title: string }[]> {
    const result = await executor.execute<{
      id: string;
      kind: TreeItemKind;
      title: string;
      depth: number;
    }>(sql`
      with recursive up as (
        select p.id, p.kind, p.title, p.parent_id, 1 as depth
        from tree_items t join tree_items p on p.id = t.parent_id where t.id = ${itemId}
        union all
        select p.id, p.kind, p.title, p.parent_id, up.depth + 1
        from up join tree_items p on p.id = up.parent_id where up.depth < 1000
      )
      select id, kind, title, depth from up order by depth desc`);
    return result.rows.map((row) => ({ id: row.id, kind: row.kind, title: row.title }));
  }

  async #placementPosition(
    tx: Transaction,
    spaceId: string,
    placement: Placement,
    movingId: string | null,
  ): Promise<string> {
    const parentId = placement.parentId;
    const sibling = async (id: string) => {
      const result = await tx.execute<{ position: string; parent_id: string | null; space_id: string }>(
        sql`select position, parent_id, space_id from tree_items where id = ${id}`,
      );
      const row = result.rows[0];
      if (!row || row.space_id !== spaceId || row.parent_id !== parentId || id === movingId) {
        throw new SpaceError("invalidPlacement", "The neighbor is not a sibling at the target place");
      }
      return row.position;
    };
    const neighbor = async (position: string, direction: "before" | "after") => {
      const result = await tx.execute<{ position: string }>(sql`
        select position from tree_items
        where space_id = ${spaceId} and parent_id is not distinct from ${parentId}
          and id is distinct from ${movingId}
          and position ${direction === "after" ? sql`>` : sql`<`} ${position}
        order by position ${direction === "after" ? sql`asc` : sql`desc`} limit 1`);
      return result.rows[0]?.position ?? null;
    };
    if (placement.afterId) {
      const lower = await sibling(placement.afterId);
      return positionBetween(lower, await neighbor(lower, "after"));
    }
    if (placement.beforeId) {
      const upper = await sibling(placement.beforeId);
      return positionBetween(await neighbor(upper, "before"), upper);
    }
    const last = await tx.execute<{ position: string | null }>(sql`
      select max(position) as position from tree_items
      where space_id = ${spaceId} and parent_id is not distinct from ${parentId}
        and id is distinct from ${movingId}`);
    return positionBetween(last.rows[0]?.position ?? null, null);
  }

  async #checkParent(tx: Transaction, spaceId: string, parentId: string | null): Promise<void> {
    if (parentId === null) return;
    const parent = await tx.execute<{ space_id: string; kind: TreeItemKind; in_tree: boolean }>(
      sql`select space_id, kind, (trash_entry_id is null and archived_root_id is null) as in_tree
        from tree_items where id = ${parentId}`,
    );
    const row = parent.rows[0];
    if (!row || row.space_id !== spaceId || !row.in_tree) {
      throw new SpaceError("invalidPlacement", "The parent is not in the target space");
    }
    if (row.kind === "link") throw new SpaceError("invalidPlacement", "Links cannot contain items");
  }

  async create(
    actor: Principal,
    spaceId: string,
    input: {
      kind: TreeItemKind;
      title: string;
      description?: string | undefined;
      placement: Placement;
      link?: { itemId?: string | null | undefined; url?: string | null | undefined } | undefined;
      mode?: PageMode | undefined;
      document?: unknown;
    },
  ): Promise<TreeItem> {
    const title = cleanTitle(input.title);
    const description = cleanDescription(input.description ?? "");
    let linkItemId: string | null = null;
    let linkUrl: string | null = null;
    if (input.kind === "link") {
      if (input.link?.url) linkUrl = cleanLinkUrl(input.link.url);
      else if (input.link?.itemId) {
        linkItemId = input.link.itemId;
        const target = await this.#authorization.explain(actor, "item.view", {
          type: "item",
          id: linkItemId,
        });
        if (!target.allowed) throw new SpaceError("invalidLinkTarget", "The linked item does not exist");
        const kind = await this.#database.execute<{ kind: TreeItemKind }>(
          sql`select kind from tree_items where id = ${linkItemId}`,
        );
        if (kind.rows[0]?.kind === "link") {
          throw new SpaceError("invalidLinkTarget", "Links can point to pages and folders only");
        }
      } else throw new SpaceError("invalidLinkTarget", "A link needs a page, a folder or an address");
    }
    const actorId = actorIdOf(actor);
    const mode = input.kind === "page" ? await this.#modeFor(spaceId, input.mode) : "live";
    const id = await this.#database.transaction(async (tx) => {
      await lockSpaces(tx, [spaceId]);
      await this.#checkParent(tx, spaceId, input.placement.parentId);
      const position = await this.#placementPosition(tx, spaceId, input.placement, null);
      const itemId = uuidv7();
      await tx.execute(sql`
        insert into tree_items (id, space_id, parent_id, kind, position, title, description, link_item_id, link_url,
          mode, creator_id, owner_id)
        values (${itemId}, ${spaceId}, ${input.placement.parentId}, ${input.kind}, ${position}, ${title},
          ${description}, ${linkItemId}, ${linkUrl}, ${mode}, ${actorId}, ${actorId})`);
      if (input.kind === "page") await insertInitialDocument(tx, itemId, actorId, input.document);
      await signalSpaceChange(tx, { spaceId, kind: "tree", itemId });
      return itemId;
    });
    const created = await this.get(actor, id);
    if (!created) throw new Error("The item was not created");
    return created;
  }

  async update(
    actor: Principal,
    itemId: string,
    changes: { title?: string | undefined; description?: string | undefined; width?: PageWidth | undefined },
  ): Promise<TreeItem> {
    await this.#database.transaction(async (tx) => {
      const current = await tx.execute<{ space_id: string; kind: TreeItemKind }>(
        sql`select space_id, kind from tree_items where id = ${itemId} for update`,
      );
      const row = current.rows[0];
      if (!row) throw new SpaceError("itemNotFound", "The item does not exist");
      let title = changes.title === undefined ? undefined : cleanTitle(changes.title);
      const description =
        changes.description === undefined ? undefined : cleanDescription(changes.description);
      if (title !== undefined && (await this.#versions.renameDraft(tx, itemId, title))) {
        await signalSpaceChange(tx, { spaceId: row.space_id, kind: "draft", itemId });
        title = undefined;
      }
      await tx.execute(sql`
        update tree_items set
          title = coalesce(${title ?? null}, title),
          description = coalesce(${description ?? null}, description),
          width = coalesce(${changes.width ?? null}::page_width, width),
          updated_at = now()
        where id = ${itemId}`);
      await signalSpaceChange(tx, { spaceId: row.space_id, kind: "tree", itemId });
    });
    const item = await this.get(actor, itemId);
    if (!item) throw new SpaceError("itemNotFound", "The item does not exist");
    return item;
  }

  async moveImpact(actor: Principal, itemId: string, targetSpaceId: string): Promise<AccessImpact> {
    const source = await this.#database.execute<{ space_id: string }>(
      sql`select space_id from tree_items where id = ${itemId}`,
    );
    const sourceSpaceId = source.rows[0]?.space_id;
    if (!sourceSpaceId) throw new SpaceError("itemNotFound", "The item does not exist");
    await this.#requireEdit(actor, sourceSpaceId);
    await this.#requireEdit(actor, targetSpaceId);
    const state = async (spaceId: string) => {
      const space = await this.#database.execute<{
        organization_id: string | null;
        visibility: "private" | "organization" | "instance";
      }>(sql`select organization_id, visibility from spaces where id = ${spaceId}`);
      const row = space.rows[0];
      if (!row) throw new SpaceError("spaceNotFound", "The space does not exist");
      return {
        organizationId: row.organization_id,
        visibility: row.visibility,
        grants: await currentGrants(this.#database, spaceId),
      };
    };
    return accessImpact(this.#database, await state(sourceSpaceId), await state(targetSpaceId), (account) =>
      this.#people.visibleCondition(actor, account),
    );
  }

  async move(
    actor: Principal,
    itemId: string,
    target: Placement & { spaceId?: string | undefined },
  ): Promise<TreeItem> {
    const located = await this.#database.execute<{ space_id: string }>(
      sql`select space_id from tree_items where id = ${itemId}`,
    );
    const sourceSpaceId = located.rows[0]?.space_id;
    if (!sourceSpaceId) throw new SpaceError("itemNotFound", "The item does not exist");
    const targetSpaceId = target.spaceId ?? sourceSpaceId;
    await this.#requireEdit(actor, sourceSpaceId);
    if (targetSpaceId !== sourceSpaceId) await this.#requireEdit(actor, targetSpaceId);

    await this.#database.transaction(async (tx) => {
      await lockSpaces(tx, [sourceSpaceId, targetSpaceId]);
      const current = await tx.execute<{ space_id: string; parent_id: string | null; in_tree: boolean }>(
        sql`select space_id, parent_id, (trash_entry_id is null and archived_root_id is null) as in_tree
          from tree_items where id = ${itemId} for update`,
      );
      const row = current.rows[0];
      if (!row?.in_tree) throw new SpaceError("itemNotFound", "The item does not exist");
      if (row.space_id !== sourceSpaceId) {
        throw new SpaceError("itemMoved", "Someone else moved the item at the same moment; try again");
      }
      if (target.parentId === itemId) {
        throw new SpaceError("moveIntoDescendant", "An item cannot be moved below itself");
      }
      await this.#checkParent(tx, targetSpaceId, target.parentId);
      if (target.parentId !== null) {
        const cycle = await tx.execute<{ found: boolean }>(sql`
          with recursive up as (
            select id, parent_id, 1 as depth from tree_items where id = ${target.parentId}
            union all
            select t.id, t.parent_id, up.depth + 1 from tree_items t join up on t.id = up.parent_id
            where up.depth < 1000
          )
          select exists (select 1 from up where id = ${itemId}) as found`);
        if (cycle.rows[0]?.found) {
          throw new SpaceError("moveIntoDescendant", "An item cannot be moved below its own descendant");
        }
      }
      if (targetSpaceId !== sourceSpaceId) {
        const overview = await tx.execute<{ id: string }>(
          sql`select id from spaces where overview_item_id = ${itemId}`,
        );
        if (overview.rows[0]) {
          throw new SpaceError("overviewPage", "The overview page of a space stays in its space");
        }
      }
      const position = await this.#placementPosition(tx, targetSpaceId, target, itemId);
      await tx.execute(sql`
        update tree_items set parent_id = ${target.parentId}, position = ${position}, updated_at = now()
        where id = ${itemId}`);
      if (targetSpaceId !== sourceSpaceId) {
        await tx.execute(sql`
          with recursive down as (
            select id from tree_items where id = ${itemId}
            union all
            select t.id from tree_items t join down on t.parent_id = down.id
          )
          update tree_items set space_id = ${targetSpaceId}, updated_at = now() where id in (select id from down)`);
        await signalSpaceChange(tx, { spaceId: targetSpaceId, kind: "tree", itemId });
      }
      await signalSpaceChange(tx, { spaceId: sourceSpaceId, kind: "tree", itemId });
    });
    const moved = await this.get(actor, itemId);
    if (!moved) throw new SpaceError("itemNotFound", "The item does not exist");
    return moved;
  }

  async #requireEdit(actor: Principal, spaceId: string): Promise<void> {
    const decision = await this.#authorization.explain(actor, "space.edit", { type: "space", id: spaceId });
    if (!decision.allowed) throw new ForbiddenError(decision);
  }

  async convert(actor: Principal, itemId: string, kind: "page" | "folder"): Promise<TreeItem> {
    await this.#database.transaction(async (tx) => {
      const current = await tx.execute<{ space_id: string; kind: TreeItemKind }>(
        sql`select space_id, kind from tree_items where id = ${itemId} for update`,
      );
      const row = current.rows[0];
      if (!row) throw new SpaceError("itemNotFound", "The item does not exist");
      if (row.kind === "link") throw new SpaceError("invalidConversion", "Links cannot be converted");
      if (row.kind === kind) return;
      const overview = await tx.execute<{ id: string }>(
        sql`select id from spaces where overview_item_id = ${itemId}`,
      );
      if (overview.rows[0]) {
        throw new SpaceError("overviewPage", "The overview page of a space stays a page");
      }
      await tx.execute(sql`update tree_items set kind = ${kind}, updated_at = now() where id = ${itemId}`);
      if (kind === "page") {
        const document = await tx.execute<{ item_id: string }>(
          sql`select item_id from page_documents where item_id = ${itemId}`,
        );
        if (!document.rows[0]) await insertInitialDocument(tx, itemId, actorIdOf(actor));
      }
      await signalSpaceChange(tx, { spaceId: row.space_id, kind: "tree", itemId });
    });
    const item = await this.get(actor, itemId);
    if (!item) throw new SpaceError("itemNotFound", "The item does not exist");
    return item;
  }

  async search(
    viewer: Principal,
    options: {
      query: string;
      spaceId?: string | undefined;
      kinds?: TreeItemKind[] | undefined;
      limit?: number | undefined;
    },
  ): Promise<(TreeItem & { spaceKey: string; spaceName: string })[]> {
    const term = options.query.trim();
    const pattern = `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    const kinds = options.kinds ?? ["page", "folder"];
    const result = await this.#database.execute<ItemRow & { space_key: string; space_name: string }>(sql`
      select found.*, s.key as space_key, s.name as space_name from (${this.#select(viewer)}
        where t.trash_entry_id is null and t.archived_root_id is null
          and ${publishedFor(this.#authorization, viewer, sql`t`, sql`ts`)}) found
      join spaces s on s.id = found.space_id
      where ${this.#authorization.spaceFilter(viewer, sql`s`)}
        and found.kind = any(${sql.param(kinds)}::tree_item_kind[])
        ${options.spaceId ? sql`and found.space_id = ${options.spaceId}` : sql``}
        ${term ? sql`and found.title ilike ${pattern}` : sql``}
      order by (lower(found.title) = lower(${term})) desc, (found.title ilike ${`${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`}) desc,
        found.content_updated_at desc
      limit ${limit}`);
    return result.rows.map((row) => ({ ...toItem(row), spaceKey: row.space_key, spaceName: row.space_name }));
  }

  async findByTitle(
    spaceId: string,
    title: string,
    executor: Executor = this.#database,
  ): Promise<string | null> {
    const result = await executor.execute<{ id: string }>(sql`
      select id from tree_items where space_id = ${spaceId} and kind = 'page' and lower(title) = lower(${title.trim()})
        and trash_entry_id is null
      order by created_at limit 1`);
    return result.rows[0]?.id ?? null;
  }

  async spaceOf(itemId: string, executor: Executor = this.#database): Promise<string | null> {
    const result = await executor.execute<{ space_id: string }>(
      sql`select space_id from tree_items where id = ${itemId}`,
    );
    return result.rows[0]?.space_id ?? null;
  }
}
