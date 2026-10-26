import { uuidv7 } from "@lunedo/shared";
import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import type { SettingsService } from "../settings/service.js";
import { actorIdOf, SpaceError } from "../spaces/common.js";
import type { PeopleService } from "../spaces/people.js";
import { spaceKeyFor, spaceNameFor, visibleItem } from "../spaces/visibility.js";
import type { BlogPost, BlogService } from "./blog.js";
import { organizationHomePageSetting, RECENT_VIEW_DAYS } from "./settings.js";
import type { TaskEntry, TaskService } from "./tasks.js";

export const MAX_STARS = 500;

export interface ContentReference {
  id: string;
  kind: "page" | "folder" | "link" | "blogPost" | "whiteboard";
  title: string;
  spaceId: string;
  spaceKey: string;
  spaceName: string;
  mySpace: boolean;
}

export interface StarredSpace {
  id: string;
  key: string;
  name: string;
  personal: boolean;
  mySpace: boolean;
}

export interface Starred {
  items: (ContentReference & { starredAt: Date })[];
  spaces: (StarredSpace & { starredAt: Date })[];
}

export interface Mention {
  id: string;
  item: ContentReference;
  commentId: string | null;
  actor: { id: string; name: string } | null;
  at: Date;
}

export interface ForYou {
  recent: (ContentReference & { viewedAt: Date })[];
  starred: Starred;
  tasks: TaskEntry[];
  mentions: Mention[];
  posts: BlogPost[];
}

type ReferenceRow = {
  id: string;
  kind: ContentReference["kind"];
  title: string;
  space_id: string;
  key: string;
  space_name: string;
  my_space: boolean;
};

function reference(row: ReferenceRow): ContentReference {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    spaceId: row.space_id,
    spaceKey: row.key,
    spaceName: row.space_name,
    mySpace: row.my_space,
  };
}

function mySpace(viewer: Principal): SQL {
  const accountId = actorIdOf(viewer);
  return accountId ? sql`coalesce(s.personal_of = ${accountId}, false)` : sql`false`;
}

export class HomeService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #settings: SettingsService;
  readonly #tasks: TaskService;
  readonly #blog: BlogService;
  readonly #people: PeopleService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    settings: SettingsService;
    tasks: TaskService;
    blog: BlogService;
    people: PeopleService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#settings = options.settings;
    this.#tasks = options.tasks;
    this.#blog = options.blog;
    this.#people = options.people;
  }

  #account(actor: Principal): string {
    const accountId = actorIdOf(actor);
    if (!accountId) throw new SpaceError("personalOnly", "Only people have starred items and a home page");
    return accountId;
  }

  async star(
    actor: Principal,
    target: { itemId: string } | { spaceId: string },
    starred: boolean,
  ): Promise<void> {
    const accountId = this.#account(actor);
    const itemId = "itemId" in target ? target.itemId : null;
    const spaceId = "spaceId" in target ? target.spaceId : null;
    await this.#database.transaction(async (tx) => {
      if (!starred) {
        await tx.execute(sql`
          delete from stars where account_id = ${accountId}
            and ${itemId ? sql`item_id = ${itemId}` : sql`space_id = ${spaceId}`}`);
        return;
      }
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`stars:${accountId}`}, 0))`);
      const count = await tx.execute<{ count: string }>(
        sql`select count(*) as count from stars where account_id = ${accountId}`,
      );
      if (Number(count.rows[0]?.count ?? 0) >= MAX_STARS) {
        throw new SpaceError("tooManyStars", `You can star up to ${MAX_STARS} items and spaces`);
      }
      await tx.execute(sql`
        insert into stars (id, account_id, item_id, space_id) values (${uuidv7()}, ${accountId}, ${itemId}, ${spaceId})
        on conflict do nothing`);
    });
  }

  async isStarred(actor: Principal, target: { itemId: string } | { spaceId: string }): Promise<boolean> {
    const accountId = actorIdOf(actor);
    if (!accountId) return false;
    const result = await this.#database.execute(sql`
      select 1 from stars where account_id = ${accountId}
        and ${"itemId" in target ? sql`item_id = ${target.itemId}` : sql`space_id = ${target.spaceId}`}`);
    return result.rows.length > 0;
  }

  async starred(viewer: Principal): Promise<Starred> {
    const accountId = this.#account(viewer);
    const items = await this.#database.execute<ReferenceRow & { created_at: Date | string }>(sql`
      select t.id, t.kind, t.title, t.space_id, ${spaceKeyFor(this.#authorization, viewer, sql`s`)} as key,
        ${spaceNameFor(this.#authorization, viewer, sql`s`)} as space_name, ${mySpace(viewer)} as my_space, st.created_at
      from stars st join tree_items t on t.id = st.item_id join spaces s on s.id = t.space_id
      where st.account_id = ${accountId} and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
      order by st.created_at desc limit ${MAX_STARS}`);
    const spaces = await this.#database.execute<{
      id: string;
      key: string;
      name: string;
      personal: boolean;
      my_space: boolean;
      created_at: Date | string;
    }>(sql`
      select s.id, s.key, s.name, s.personal_of is not null as personal, ${mySpace(viewer)} as my_space,
        st.created_at
      from stars st join spaces s on s.id = st.space_id
      where st.account_id = ${accountId} and ${this.#authorization.spaceFilter(viewer, sql`s`)}
      order by st.created_at desc limit ${MAX_STARS}`);
    return {
      items: items.rows.map((row) => ({ ...reference(row), starredAt: new Date(row.created_at) })),
      spaces: spaces.rows.map((row) => ({
        id: row.id,
        key: row.key,
        name: row.name,
        personal: row.personal,
        mySpace: row.my_space,
        starredAt: new Date(row.created_at),
      })),
    };
  }

  async recordView(actor: Principal, itemId: string): Promise<void> {
    const accountId = actorIdOf(actor);
    if (!accountId) return;
    await this.#database.execute(sql`
      insert into recent_views (account_id, item_id) values (${accountId}, ${itemId})
      on conflict (account_id, item_id) do update set viewed_at = now(), views = least(recent_views.views + 1, 1000000)`);
  }

  async recent(viewer: Principal, limit = 20): Promise<(ContentReference & { viewedAt: Date })[]> {
    const accountId = this.#account(viewer);
    const result = await this.#database.execute<ReferenceRow & { viewed_at: Date | string }>(sql`
      select t.id, t.kind, t.title, t.space_id, ${spaceKeyFor(this.#authorization, viewer, sql`s`)} as key,
        ${spaceNameFor(this.#authorization, viewer, sql`s`)} as space_name, ${mySpace(viewer)} as my_space, v.viewed_at
      from recent_views v join tree_items t on t.id = v.item_id join spaces s on s.id = t.space_id
      where v.account_id = ${accountId}
        and v.viewed_at > now() - make_interval(days => ${RECENT_VIEW_DAYS})
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
      order by v.viewed_at desc limit ${Math.min(Math.max(limit, 1), 100)}`);
    return result.rows.map((row) => ({ ...reference(row), viewedAt: new Date(row.viewed_at) }));
  }

  async removeOldViews(): Promise<number> {
    const result = await this.#database.execute(sql`
      delete from recent_views where viewed_at <= now() - make_interval(days => ${RECENT_VIEW_DAYS})`);
    return result.rowCount ?? 0;
  }

  async mentions(viewer: Principal, limit = 20): Promise<Mention[]> {
    const accountId = this.#account(viewer);
    const result = await this.#database.execute<
      ReferenceRow & {
        mention_id: string;
        comment_id: string | null;
        actor_id: string | null;
        actor_name: string | null;
        notified_at: Date | string;
      }
    >(sql`
      select m.id as mention_id, m.comment_id, m.actor_id, ${this.#people.visibleName(viewer, sql`a`)} as actor_name, m.notified_at,
        t.id, t.kind, t.title, t.space_id, ${spaceKeyFor(this.#authorization, viewer, sql`s`)} as key,
        ${spaceNameFor(this.#authorization, viewer, sql`s`)} as space_name, ${mySpace(viewer)} as my_space
      from content_mentions m join tree_items t on t.id = m.item_id join spaces s on s.id = t.space_id
      left join accounts a on a.id = m.actor_id
      left join comments c on c.id = m.comment_id
      left join comments r on r.id = coalesce(c.parent_id, c.id)
      where m.account_id = ${accountId} and m.notified_at is not null
        and (m.comment_id is null or (c.deleted_at is null
          and (r.quote is null or r.quote_public or ${this.#authorization.itemFilter(viewer, sql`t`, sql`s`, "editor")})))
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
      order by m.notified_at desc limit ${Math.min(Math.max(limit, 1), 100)}`);
    return result.rows.map((row) => ({
      id: row.mention_id,
      item: reference(row),
      commentId: row.comment_id,
      actor: row.actor_id && row.actor_name ? { id: row.actor_id, name: row.actor_name } : null,
      at: new Date(row.notified_at),
    }));
  }

  async forYou(viewer: Principal): Promise<ForYou> {
    const [recent, starred, tasks, mentions, posts] = await Promise.all([
      this.recent(viewer, 8),
      this.starred(viewer),
      this.#tasks.list(viewer, { assignee: "me", status: "open", due: "next7Days", limit: 10 }),
      this.mentions(viewer, 8),
      this.#blog.recent(viewer, 5),
    ]);
    return { recent, starred, tasks: tasks.items, mentions, posts };
  }

  async organizationHomePage(viewer: Principal, organizationId: string): Promise<ContentReference | null> {
    const itemId = await this.#settings.get(organizationHomePageSetting, { organization: organizationId });
    if (!itemId) return null;
    const result = await this.#database.execute<ReferenceRow>(sql`
      select t.id, t.kind, t.title, t.space_id, ${spaceKeyFor(this.#authorization, viewer, sql`s`)} as key,
        ${spaceNameFor(this.#authorization, viewer, sql`s`)} as space_name, ${mySpace(viewer)} as my_space
      from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${itemId} and s.organization_id = ${organizationId} and t.archived_root_id is null
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}`);
    const row = result.rows[0];
    return row ? reference(row) : null;
  }

  async setOrganizationHomePage(
    actor: Principal,
    organizationId: string,
    itemId: string | null,
  ): Promise<ContentReference | null> {
    if (itemId) {
      const result = await this.#database.execute<{ kind: string }>(sql`
        select t.kind from tree_items t join spaces s on s.id = t.space_id
        where t.id = ${itemId} and s.organization_id = ${organizationId} and t.trash_entry_id is null
          and s.deleted_at is null and ${visibleItem(this.#authorization, actor, sql`t`, sql`s`)}`);
      if (result.rows[0]?.kind !== "page") {
        throw new SpaceError("invalidHomePage", "Choose a page from a space of this organization");
      }
    }
    await this.#settings.set(
      organizationHomePageSetting,
      { organization: organizationId },
      "organization",
      itemId,
    );
    return itemId ? this.organizationHomePage(actor, organizationId) : null;
  }
}
