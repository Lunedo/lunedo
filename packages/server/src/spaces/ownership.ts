import { uuidv7 } from "@lunedo/shared";
import { type SQL, sql } from "drizzle-orm";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import { accountItemCondition } from "../authorization/item-access.js";
import { type AuthorizationService, ForbiddenError } from "../authorization/service.js";
import { organizationMembership } from "../authorization/space-access.js";
import type { ContentActivity } from "../collaboration/content.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { NotificationService } from "../notifications/service.js";
import { actorIdOf, auditScopeOf, SpaceError } from "./common.js";
import type { PeopleService } from "./people.js";
import type { TreeItemKind } from "./schema.js";
import { signalSpaceChange } from "./signals.js";
import { visibleItem } from "./visibility.js";

export const MAX_OWNER_CANDIDATES = 20;
export const MAX_UNOWNED_PAGE = 100;

export type OwnerLoss = "none" | "deactivated" | "membershipEnded";

export interface ItemOwner {
  id: string;
  name: string | null;
  jobTitle: string | null;
  pictureRef: string | null;
  email: string | null;
  active: boolean;
}

export interface UnownedItem {
  id: string;
  spaceId: string;
  spaceKey: string;
  spaceName: string;
  kind: TreeItemKind;
  title: string;
  formerOwner: { id: string; name: string | null } | null;
  reason: OwnerLoss;
}

export interface UnownedPage {
  items: UnownedItem[];
  hidden: number;
  next: [string, string] | null;
}

export interface OwnershipChange {
  id: string;
  previousOwner: { id: string; name: string | null } | null;
  owner: { id: string; name: string | null } | null;
  actor: { id: string; name: string | null } | null;
  changedAt: Date;
}

export interface OwnerCandidate {
  id: string;
  name: string;
  email: string | null;
}

const ownedKinds = sql`array['page', 'folder', 'link', 'blogPost', 'meetingSeries', 'whiteboard']::tree_item_kind[]`;

export function ownerActiveCondition(item: SQL, space: SQL): SQL {
  return sql`exists (select 1 from accounts oa where oa.id = ${item}.owner_id and (oa.state = 'placeholder'
    or (oa.state in ('active', 'invited') and (${space}.organization_id is null
      or ${organizationMembership(sql`${space}.organization_id`, sql`oa.id`)}))))`;
}

export function managedItemCondition(item: SQL, space: SQL): SQL {
  return sql`(${item}.kind = any(${ownedKinds}) and ${item}.trash_entry_id is null
    and ${item}.archived_root_id is null and ${space}.deleted_at is null and ${space}.archived_at is null
    and not ${space}.quarantined)`;
}

function unownedCondition(item: SQL, space: SQL): SQL {
  return sql`(${managedItemCondition(item, space)} and not ${ownerActiveCondition(item, space)})`;
}

export class OwnershipService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #people: PeopleService;
  readonly #audit: AuditLog;
  readonly #notifications: NotificationService;
  readonly #activity: ContentActivity;
  readonly #administrators: (executor: Executor, spaceId: string) => Promise<string[]>;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    people: PeopleService;
    audit: AuditLog;
    notifications: NotificationService;
    activity: ContentActivity;
    administrators: (executor: Executor, spaceId: string) => Promise<string[]>;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#people = options.people;
    this.#audit = options.audit;
    this.#notifications = options.notifications;
    this.#activity = options.activity;
    this.#administrators = options.administrators;
  }

  async owner(viewer: Principal, itemId: string): Promise<ItemOwner | null> {
    const result = await this.#database.execute<{
      owner_id: string | null;
      active: boolean;
      email: string | null;
    }>(sql`
      select t.owner_id, ${ownerActiveCondition(sql`t`, sql`s`)} as active,
        case when ${this.#people.colleagueCondition(viewer, sql`t.owner_id`)} then oa.email end as email
      from tree_items t join spaces s on s.id = t.space_id left join accounts oa on oa.id = t.owner_id
      where t.id = ${itemId}`);
    const row = result.rows[0];
    if (!row?.owner_id) return null;
    const person = (await this.#people.visiblePeople(viewer, [row.owner_id])).get(row.owner_id);
    return {
      id: row.owner_id,
      name: person?.name ?? null,
      jobTitle: person?.jobTitle ?? null,
      pictureRef: person?.pictureRef ?? null,
      email: person ? row.email : null,
      active: row.active,
    };
  }

  async canTransfer(actor: Principal, itemId: string, executor: Executor = this.#database): Promise<boolean> {
    const managed = await executor.execute<{ managed: boolean }>(sql`
      select ${managedItemCondition(sql`t`, sql`s`)} as managed
      from tree_items t join spaces s on s.id = t.space_id where t.id = ${itemId}`);
    if (managed.rows[0]?.managed !== true) return false;
    const fresh = executor !== this.#database;
    const options = { executor, fresh };
    const visible = await this.#authorization.explain(
      actor,
      "item.view",
      { type: "item", id: itemId },
      options,
    );
    if (!visible.allowed) return false;
    const decision = await this.#authorization.explain(
      actor,
      "item.transferOwnership",
      { type: "item", id: itemId },
      options,
    );
    return decision.allowed;
  }

  async #requireTransfer(tx: Transaction, actor: Principal, itemId: string): Promise<void> {
    const visible = await this.#authorization.explain(
      actor,
      "item.view",
      { type: "item", id: itemId },
      { executor: tx, fresh: true },
    );
    if (!visible.allowed) throw new SpaceError("itemNotFound", "The item does not exist");
    const decision = await this.#authorization.explain(
      actor,
      "item.transferOwnership",
      { type: "item", id: itemId },
      { executor: tx, fresh: true },
    );
    if (!decision.allowed) throw new ForbiddenError(decision);
  }

  async candidates(actor: Principal, itemId: string, search: string): Promise<OwnerCandidate[]> {
    if (!(await this.canTransfer(actor, itemId))) {
      throw new SpaceError("itemNotFound", "The item does not exist");
    }
    const term = search.trim();
    const pattern = `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const result = await this.#database.execute<{ id: string; name: string; email: string | null }>(sql`
      select a.id, a.name,
        case when ${this.#people.colleagueCondition(actor, sql`a.id`)} then a.email end as email
      from accounts a cross join tree_items t join spaces s on s.id = t.space_id
      where t.id = ${itemId} and a.state = 'active' and a.id is distinct from t.owner_id
        and ${this.#people.visibleCondition(actor, sql`a.id`)}
        and ${accountItemCondition(sql`a.id`, sql`t`, sql`s`, "editor", { editRestriction: true })}
        ${term ? sql`and (a.name ilike ${pattern} or (a.email ilike ${pattern} and ${this.#people.colleagueCondition(actor, sql`a.id`)}))` : sql``}
      order by lower(a.name), a.id
      limit ${MAX_OWNER_CANDIDATES}`);
    return result.rows.map((row) => ({ id: row.id, name: row.name, email: row.email }));
  }

  async transfer(actor: Principal, itemId: string, ownerId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const located = await tx.execute<{
        space_id: string;
        title: string;
        owner_id: string | null;
        organization_id: string | null;
        managed: boolean;
      }>(sql`
        select t.space_id, t.title, t.owner_id, s.organization_id, ${managedItemCondition(sql`t`, sql`s`)} as managed
        from tree_items t join spaces s on s.id = t.space_id where t.id = ${itemId} for update of t`);
      const item = located.rows[0];
      if (!item) throw new SpaceError("itemNotFound", "The item does not exist");
      await this.#requireTransfer(tx, actor, itemId);
      if (!item.managed) {
        throw new SpaceError(
          "ownershipNotTransferable",
          "The owner of archived content, of content in the trash and of meeting topics cannot be changed here",
        );
      }
      if (item.owner_id === ownerId) return;
      const visible = await this.#people.canSee(actor, ownerId, tx);
      const edit = visible
        ? await this.#authorization.explain(
            accountPrincipal(ownerId),
            "item.edit",
            { type: "item", id: itemId },
            { executor: tx, fresh: true },
          )
        : null;
      if (!edit?.allowed) {
        throw new SpaceError(
          "ownerNeedsEditAccess",
          "The new owner needs edit access to the item. Choose someone who can edit it, or give them access first.",
        );
      }
      await tx.execute(
        sql`update tree_items set owner_id = ${ownerId}, updated_at = now() where id = ${itemId}`,
      );
      await tx.execute(sql`
        insert into item_ownership_changes (id, item_id, previous_owner_id, owner_id, actor_id)
        values (${uuidv7()}, ${itemId}, ${item.owner_id}, ${ownerId}, ${actorIdOf(actor)})`);
      await this.#audit.record(tx, {
        name: "page.ownerTransferred",
        actor,
        targetId: itemId,
        fields: { spaceId: item.space_id, title: item.title, previousOwnerId: item.owner_id, ownerId },
        scope: auditScopeOf({ organizationId: item.organization_id }),
      });
      await signalSpaceChange(tx, { spaceId: item.space_id, kind: "tree", itemId });
      await this.#activity.ownerChanged(tx, itemId, { actorId: actorIdOf(actor), ownerId });
    });
  }

  async history(viewer: Principal, itemId: string): Promise<OwnershipChange[]> {
    const result = await this.#database.execute<{
      id: string;
      previous_owner_id: string | null;
      owner_id: string | null;
      actor_id: string | null;
      changed_at: Date | string;
    }>(sql`
      select id, previous_owner_id, owner_id, actor_id, changed_at from item_ownership_changes
      where item_id = ${itemId} order by changed_at desc, id desc limit 200`);
    const names = await this.#people.visibleNames(
      viewer,
      result.rows
        .flatMap((row) => [row.previous_owner_id, row.owner_id, row.actor_id])
        .filter((id): id is string => id !== null),
    );
    const person = (id: string | null) => (id ? { id, name: names.get(id) ?? null } : null);
    return result.rows.map((row) => ({
      id: row.id,
      previousOwner: person(row.previous_owner_id),
      owner: person(row.owner_id),
      actor: person(row.actor_id),
      changedAt: new Date(row.changed_at),
    }));
  }

  async #unowned(viewer: Principal, scope: SQL, after: [string, string] | null): Promise<UnownedPage> {
    const visible = visibleItem(this.#authorization, viewer, sql`t`, sql`s`);
    const result = await this.#database.execute<{
      id: string;
      space_id: string;
      key: string;
      space_name: string;
      kind: TreeItemKind;
      title: string;
      owner_id: string | null;
      owner_state: string | null;
      sort_title: string;
    }>(sql`
      select t.id, t.space_id, s.key, s.name as space_name, t.kind, t.title, t.owner_id, oa.state::text as owner_state,
        lower(t.title) as sort_title
      from tree_items t join spaces s on s.id = t.space_id left join accounts oa on oa.id = t.owner_id
      where ${scope} and ${unownedCondition(sql`t`, sql`s`)} and ${visible}
        ${after ? sql`and (lower(t.title), t.id) > (${after[0]}, ${after[1]}::uuid)` : sql``}
      order by lower(t.title), t.id
      limit ${MAX_UNOWNED_PAGE + 1}`);
    const hidden = await this.#database.execute<{ count: number }>(sql`
      select count(*)::int as count from tree_items t join spaces s on s.id = t.space_id
      where ${scope} and ${unownedCondition(sql`t`, sql`s`)} and not ${visible}`);
    const rows = result.rows.slice(0, MAX_UNOWNED_PAGE);
    const names = await this.#people.visibleNames(
      viewer,
      rows.map((row) => row.owner_id).filter((id): id is string => id !== null),
    );
    const last = rows.at(-1);
    return {
      items: rows.map((row) => ({
        id: row.id,
        spaceId: row.space_id,
        spaceKey: row.key,
        spaceName: row.space_name,
        kind: row.kind,
        title: row.title,
        formerOwner: row.owner_id ? { id: row.owner_id, name: names.get(row.owner_id) ?? null } : null,
        reason:
          row.owner_id === null
            ? "none"
            : row.owner_state === "active" || row.owner_state === "invited"
              ? "membershipEnded"
              : "deactivated",
      })),
      hidden: Number(hidden.rows[0]?.count ?? 0),
      next: result.rows.length > MAX_UNOWNED_PAGE && last ? [last.sort_title, last.id] : null,
    };
  }

  spaceUnowned(
    viewer: Principal,
    spaceId: string,
    after: [string, string] | null = null,
  ): Promise<UnownedPage> {
    return this.#unowned(viewer, sql`t.space_id = ${spaceId}`, after);
  }

  organizationUnowned(
    viewer: Principal,
    organizationId: string,
    after: [string, string] | null = null,
  ): Promise<UnownedPage> {
    return this.#unowned(viewer, sql`s.organization_id = ${organizationId} and not s.confidential`, after);
  }

  async afterDeactivation(tx: Transaction, accountId: string): Promise<void> {
    await this.#notifyOwnerLoss(tx, accountId, sql`true`);
  }

  async afterMembershipEnded(tx: Transaction, organizationId: string, accountId: string): Promise<void> {
    await this.#notifyOwnerLoss(tx, accountId, sql`s.organization_id = ${organizationId}`);
  }

  async #notifyOwnerLoss(tx: Transaction, accountId: string, scope: SQL): Promise<void> {
    const affected = await tx.execute<{
      space_id: string;
      key: string;
      name: string;
      organization_id: string | null;
      items: number;
    }>(sql`
      select s.id as space_id, s.key, s.name, s.organization_id, count(*)::int as items
      from tree_items t join spaces s on s.id = t.space_id
      where t.owner_id = ${accountId} and ${scope} and ${unownedCondition(sql`t`, sql`s`)}
      group by s.id, s.key, s.name, s.organization_id
      order by s.id`);
    for (const space of affected.rows) {
      const recipients = (await this.#administrators(tx, space.space_id)).filter((id) => id !== accountId);
      if (recipients.length > 0) {
        await this.#notifications.notify(tx, {
          type: "ownership.orphaned",
          recipients,
          organizationId: space.organization_id,
          targetId: space.space_id,
          params: {
            spaceId: space.space_id,
            spaceName: space.name,
            spaceKey: space.key,
            items: Number(space.items),
          },
        });
      }
      await signalSpaceChange(tx, { spaceId: space.space_id, kind: "tree", itemId: null });
    }
  }
}
