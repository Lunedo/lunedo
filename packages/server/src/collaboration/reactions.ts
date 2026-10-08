import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { Database, Executor } from "../database/database.js";
import type { SettingsService } from "../settings/service.js";
import { actorIdOf, SpaceError } from "../spaces/common.js";
import type { PeopleService } from "../spaces/people.js";
import { signalSpaceChange } from "../spaces/signals.js";
import { reactionsEnabledSetting } from "./settings.js";

export const QUICK_REACTIONS = ["👍", "❤️", "🎉", "😄", "👀", "🙏"] as const;
export const MAX_REACTIONS_PER_PERSON = 20;
export const REACTION_PEOPLE_SHOWN = 20;

const EMOJI = /^\p{RGI_Emoji}$/v;

export interface ReactionSummary {
  emoji: string;
  count: number;
  reacted: boolean;
  people: { id: string; name: string }[];
}

interface Target {
  itemId: string;
  commentId: string | null;
}

export class ReactionService {
  readonly #database: Database;
  readonly #settings: SettingsService;
  readonly #people: PeopleService;

  constructor(options: { database: Database; settings: SettingsService; people: PeopleService }) {
    this.#database = options.database;
    this.#settings = options.settings;
    this.#people = options.people;
  }

  async enabled(itemId: string, executor: Executor = this.#database): Promise<boolean> {
    const result = await executor.execute<{ space_id: string; organization_id: string | null }>(sql`
      select t.space_id, s.organization_id from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${itemId}`);
    const row = result.rows[0];
    if (!row) return false;
    return this.#settings.get(reactionsEnabledSetting, {
      ...(row.organization_id ? { organization: row.organization_id } : {}),
      space: row.space_id,
    });
  }

  async #summaries(viewer: Principal, itemId: string, commentIds: string[] | null) {
    const viewerId = actorIdOf(viewer);
    const result = await this.#database.execute<{
      comment_id: string | null;
      emoji: string;
      count: string;
      reacted: boolean;
      people: { id: string; name: string }[];
      first: Date | string;
    }>(sql`
      select r.comment_id, r.emoji, count(*) as count, bool_or(r.account_id = ${viewerId}) as reacted,
        min(r.created_at) as first,
        (array_agg(json_build_object('id', a.id, 'name', ${this.#people.visibleName(viewer, sql`a`)})
          order by r.created_at))[1:${REACTION_PEOPLE_SHOWN}]
          as people
      from reactions r join accounts a on a.id = r.account_id
      where r.item_id = ${itemId}
        and ${commentIds === null ? sql`r.comment_id is null` : sql`r.comment_id = any(${sql.param(commentIds)}::uuid[])`}
      group by r.comment_id, r.emoji
      order by min(r.created_at)`);
    const summaries = new Map<string | null, ReactionSummary[]>();
    for (const row of result.rows) {
      summaries.set(row.comment_id, [
        ...(summaries.get(row.comment_id) ?? []),
        { emoji: row.emoji, count: Number(row.count), reacted: row.reacted, people: row.people },
      ]);
    }
    return summaries;
  }

  async forItem(
    viewer: Principal,
    itemId: string,
  ): Promise<{ enabled: boolean; reactions: ReactionSummary[] }> {
    if (!(await this.enabled(itemId))) return { enabled: false, reactions: [] };
    return { enabled: true, reactions: (await this.#summaries(viewer, itemId, null)).get(null) ?? [] };
  }

  async forComments(
    viewer: Principal,
    itemId: string,
    commentIds: string[],
  ): Promise<Map<string, ReactionSummary[]>> {
    if (commentIds.length === 0 || !(await this.enabled(itemId))) return new Map();
    const summaries = await this.#summaries(viewer, itemId, commentIds);
    return new Map([...summaries].filter((entry): entry is [string, ReactionSummary[]] => entry[0] !== null));
  }

  async #target(commentId: string): Promise<Target> {
    const result = await this.#database.execute<{ item_id: string }>(
      sql`select item_id from comments where id = ${commentId} and deleted_at is null`,
    );
    const itemId = result.rows[0]?.item_id;
    if (!itemId) throw new SpaceError("commentNotFound", "The comment does not exist");
    return { itemId, commentId };
  }

  async add(
    actor: Principal,
    target: { itemId: string } | { commentId: string },
    emoji: string,
  ): Promise<void> {
    const actorId = actorIdOf(actor);
    if (!actorId) throw new SpaceError("reactionsUnavailable", "Only people can react");
    if (!EMOJI.test(emoji)) throw new SpaceError("invalidEmoji", "A reaction is exactly one emoji");
    const resolved =
      "commentId" in target ? await this.#target(target.commentId) : { ...target, commentId: null };
    await this.#database.transaction(async (tx) => {
      if (!(await this.enabled(resolved.itemId, tx))) {
        throw new SpaceError("reactionsDisabled", "Reactions are turned off in this space");
      }
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`reactions:${actorId}:${resolved.itemId}`}, 0))`,
      );
      const count = await tx.execute<{ count: string }>(sql`
        select count(*) as count from reactions
        where item_id = ${resolved.itemId} and comment_id is not distinct from ${resolved.commentId}
          and account_id = ${actorId}`);
      if (Number(count.rows[0]?.count ?? 0) >= MAX_REACTIONS_PER_PERSON) {
        throw new SpaceError(
          "tooManyReactions",
          `One person can add up to ${MAX_REACTIONS_PER_PERSON} reactions`,
        );
      }
      await tx.execute(sql`
        insert into reactions (item_id, comment_id, account_id, emoji)
        values (${resolved.itemId}, ${resolved.commentId}, ${actorId}, ${emoji})
        on conflict do nothing`);
      await this.#signal(tx, resolved.itemId);
    });
  }

  async remove(
    actor: Principal,
    target: { itemId: string } | { commentId: string },
    emoji: string,
  ): Promise<void> {
    const actorId = actorIdOf(actor);
    if (!actorId) return;
    const resolved =
      "commentId" in target ? await this.#target(target.commentId) : { ...target, commentId: null };
    await this.#database.transaction(async (tx) => {
      await tx.execute(sql`
        delete from reactions
        where item_id = ${resolved.itemId} and comment_id is not distinct from ${resolved.commentId}
          and account_id = ${actorId} and emoji = ${emoji}`);
      await this.#signal(tx, resolved.itemId);
    });
  }

  async #signal(executor: Executor, itemId: string): Promise<void> {
    const result = await executor.execute<{ space_id: string }>(
      sql`select space_id from tree_items where id = ${itemId}`,
    );
    const spaceId = result.rows[0]?.space_id;
    if (spaceId) await signalSpaceChange(executor, { spaceId, kind: "reactions", itemId });
  }
}
