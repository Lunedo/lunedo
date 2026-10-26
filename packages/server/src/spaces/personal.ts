import { uuidv7 } from "@lunedo/shared";
import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import { type AuthorizationService, ForbiddenError } from "../authorization/service.js";
import { activeAdministratorCondition, storedGrants } from "../authorization/space-access.js";
import type { Database, Transaction } from "../database/database.js";
import { afterKey, FIRST_PAGE, type Page, type PageRequest, pageLimit, toPage } from "../database/keyset.js";
import type { NotificationService } from "../notifications/service.js";
import { actorIdOf, auditScopeOf, isUniqueViolation, SpaceError } from "./common.js";
import { organizationSpaceManagers } from "./confidential.js";
import { insertPage } from "./items.js";
import { randomPersonalSpaceKey } from "./keys.js";
import { signalSpaceChange } from "./signals.js";
import type { Space, SpaceService } from "./spaces.js";
import { insertDefaultPageStatuses } from "./status.js";

export interface PersonalSpaceForReview {
  spaceId: string;
  key: string;
  name: string;
  ownerId: string | null;
  ownerName: string | null;
  ownerState: string | null;
  pages: number;
  remainingMembers: number;
  lastChangedAt: Date;
}

export interface PersonalSpaceSummary {
  id: string;
  key: string;
  createdAt: Date;
  members: number;
  activeMembers: number;
  pages: number;
  lastChangedAt: Date;
  needsAdministrator: boolean;
}

type SummaryRow = {
  id: string;
  key: string;
  created_at: Date | string;
  members: string;
  active_members: string;
  pages: string;
  last_changed_at: Date | string;
  has_administrator: boolean;
};

function remainingMember(space: SQL): SQL {
  return sql`(sp.space_id = ${space}.id and sp.principal_kind = 'account' and a.id = sp.principal_id
    and a.state = 'active' and a.type = 'standard' and a.id is distinct from ${space}.owner_account_id)`;
}

function summaryColumns(): SQL {
  return sql`s.id, s.key, s.created_at,
    (select count(*) from space_permissions sp where sp.space_id = s.id) as members,
    (select count(*) from space_permissions sp join accounts a on a.id = sp.principal_id
      where ${remainingMember(sql`s`)}) as active_members,
    (select count(*) from tree_items t where t.space_id = s.id and t.trash_entry_id is null
      and t.kind in ('page', 'blogPost')) as pages,
    greatest(s.updated_at, (select max(t.content_updated_at) from tree_items t where t.space_id = s.id))
      as last_changed_at,
    ${activeAdministratorCondition(storedGrants(sql`s.id`), sql`s.organization_id`)} as has_administrator`;
}

function toSummary(row: SummaryRow): PersonalSpaceSummary {
  const activeMembers = Number(row.active_members);
  return {
    id: row.id,
    key: row.key,
    createdAt: new Date(row.created_at),
    members: Number(row.members),
    activeMembers,
    pages: Number(row.pages),
    lastChangedAt: new Date(row.last_changed_at),
    needsAdministrator: !row.has_administrator && activeMembers > 0,
  };
}

const KEY_ATTEMPTS = 8;

export class PersonalSpaceService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #authorization: AuthorizationService;
  readonly #spaces: SpaceService;

  readonly #notifications: NotificationService;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    authorization: AuthorizationService;
    spaces: SpaceService;
    notifications: NotificationService;
  }) {
    this.#notifications = options.notifications;
    this.#database = options.database;
    this.#audit = options.audit;
    this.#authorization = options.authorization;
    this.#spaces = options.spaces;
  }

  async find(accountId: string): Promise<Space | null> {
    const result = await this.#database.execute<{ id: string }>(
      sql`select id from spaces where personal_of = ${accountId}`,
    );
    const id = result.rows[0]?.id;
    return id ? this.#spaces.get(id) : null;
  }

  async ensure(actor: Principal, overviewTitle: string): Promise<Space> {
    if (actor.type !== "account")
      throw new SpaceError("personalSpacesUnavailable", "Only accounts have personal spaces");
    const existing = await this.find(actor.id);
    if (existing) return existing;
    const decision = await this.#authorization.explain(actor, "instance.personalSpace.use", {
      type: "instance",
    });
    if (!decision.allowed) throw new ForbiddenError(decision);
    for (let attempt = 0; attempt < KEY_ATTEMPTS; attempt++) {
      try {
        const id = await this.#database.transaction(async (tx) => {
          const spaceId = uuidv7();
          const key = randomPersonalSpaceKey();
          const inserted = await tx.execute<{ id: string }>(sql`
            insert into spaces (id, personal_of, owner_account_id, key, name, visibility, created_by)
            values (${spaceId}, ${actor.id}, ${actor.id}, ${key}, '', 'private', ${actor.id})
            on conflict (personal_of) do nothing
            returning id`);
          if (!inserted.rows[0]) return null;
          await insertDefaultPageStatuses(tx, spaceId);
          await tx.execute(sql`
            insert into space_permissions (id, space_id, principal_kind, principal_id, role, created_by)
            values (${uuidv7()}, ${spaceId}, 'account', ${actor.id}, 'admin', ${actor.id})`);
          const overview = await insertPage(tx, {
            spaceId,
            parentId: null,
            title: overviewTitle,
            actorId: actor.id,
            mode: "publish",
            published: true,
          });
          await tx.execute(sql`update spaces set overview_item_id = ${overview} where id = ${spaceId}`);
          const scope = auditScopeOf({ organizationId: null });
          await this.#audit.record(tx, {
            name: "space.created",
            actor,
            targetId: spaceId,
            fields: { name: "", key, visibility: "private", personal: true, ownerId: actor.id },
            scope,
          });
          await signalSpaceChange(tx, { spaceId, kind: "space", itemId: null });
          return spaceId;
        });
        const space = id ? await this.#spaces.get(id) : await this.find(actor.id);
        if (space) return space;
      } catch (error) {
        if (!isUniqueViolation(error, "spaces_key_unique")) throw error;
      }
    }
    throw new SpaceError("keyTaken", "No free key could be found for the personal space");
  }

  async forReview(page: PageRequest = FIRST_PAGE): Promise<Page<PersonalSpaceForReview>> {
    const result = await this.#database.execute<{
      space_id: string;
      key: string;
      name: string;
      owner_id: string | null;
      owner_name: string | null;
      owner_state: string | null;
      pages: string;
      remaining: string;
      last_changed_at: Date | string;
      sort_name: string;
    }>(sql`
      select s.id as space_id, s.key, s.name, s.owner_account_id as owner_id, a.name as owner_name, a.state::text as owner_state,
        (select count(*) from tree_items t where t.space_id = s.id and t.kind = 'page') as pages,
        greatest(s.updated_at, coalesce((select max(t.content_updated_at) from tree_items t where t.space_id = s.id),
          s.updated_at)) as last_changed_at,
        lower(coalesce(a.name, '')) as sort_name,
        (select count(*) from space_permissions sp join accounts a on a.id = sp.principal_id
          where ${remainingMember(sql`s`)}) as remaining
      from spaces s left join accounts a on a.id = s.owner_account_id
      where s.personal_of is not null and s.deleted_at is null and (a.id is null or a.state <> 'active')
        ${page.after ? sql`and ${afterKey([sql`lower(coalesce(a.name, ''))`, sql`s.id`], page.after)}` : sql``}
      order by lower(coalesce(a.name, '')), s.id
      limit ${pageLimit(page)}`);
    return toPage(
      result.rows,
      page,
      (row) => [row.sort_name, row.space_id],
      (row) => ({
        spaceId: row.space_id,
        key: row.key,
        name: row.name,
        ownerId: row.owner_id,
        ownerName: row.owner_name,
        ownerState: row.owner_state,
        pages: Number(row.pages),
        remainingMembers: Number(row.remaining),
        lastChangedAt: new Date(row.last_changed_at),
      }),
    );
  }

  async forOrganization(
    organizationId: string,
    page: PageRequest = FIRST_PAGE,
  ): Promise<Page<PersonalSpaceSummary>> {
    const result = await this.#database.execute<SummaryRow>(sql`
      select ${summaryColumns()} from spaces s join accounts o on o.id = s.owner_account_id
      where s.personal_of is not null and s.deleted_at is null and o.state <> 'active'
        and o.home_organization_id = ${organizationId}
        and exists (select 1 from space_permissions sp join accounts a on a.id = sp.principal_id
          where ${remainingMember(sql`s`)})
        ${page.after ? sql`and ${afterKey([sql`s.key`, sql`s.id`], page.after)}` : sql``}
      order by s.key, s.id
      limit ${pageLimit(page)}`);
    return toPage(result.rows, page, (row) => [row.key, row.id], toSummary);
  }

  async remainingMembers(
    actor: Principal,
    spaceId: string,
    organizationId: string | null = null,
  ): Promise<{ id: string; name: string }[]> {
    return this.#database.transaction(async (tx) => {
      const summary = await this.#reviewed(tx, spaceId, organizationId);
      if (organizationId && !summary.needsAdministrator) return [];
      return (await this.#remaining(tx, spaceId, actor)).map(({ id, name }) => ({ id, name }));
    });
  }

  async appointAdministrator(
    actor: Principal,
    organizationId: string,
    spaceId: string,
    accountId: string,
  ): Promise<void> {
    if (actorIdOf(actor) === accountId) {
      throw new SpaceError(
        "selfAppointment",
        "Appoint someone else; nobody can extend their own permissions",
      );
    }
    await this.#database.transaction(async (tx) => {
      const summary = await this.#reviewed(tx, spaceId, organizationId);
      if (!summary.needsAdministrator) {
        throw new SpaceError(
          "spaceHasAdministrator",
          "The space has a space admin who manages its permissions",
        );
      }
      const member = (await this.#remaining(tx, spaceId, actor)).find(
        (candidate) => candidate.id === accountId,
      );
      if (!member) {
        throw new SpaceError(
          "invalidHolder",
          "Only a remaining member of the personal space can become its space admin",
        );
      }
      await tx.execute(sql`
        update space_permissions set role = 'admin', updated_at = now()
        where space_id = ${spaceId} and principal_kind = 'account' and principal_id = ${accountId}`);
      const scope = { type: "organization" as const, id: organizationId };
      await this.#audit.record(tx, {
        name: "space.personalAdministratorAppointed",
        actor,
        targetId: spaceId,
        fields: { key: summary.key, accountId },
        scope,
      });
      if (member.role !== "admin") {
        await this.#audit.record(tx, {
          name: "space.permissionChanged",
          actor,
          targetId: spaceId,
          fields: {
            name: "",
            principalKind: "account",
            principalId: accountId,
            role: "admin",
            previousRole: member.role as "reader" | "commenter" | "editor",
          },
          scope,
        });
      }
      await this.#notifications.notify(tx, {
        type: "space.administratorAppointed",
        recipients: [accountId],
        organizationId,
        targetId: spaceId,
        actor,
        params: { spaceName: summary.name, spaceKey: summary.key },
      });
      await signalSpaceChange(tx, { spaceId, kind: "access", itemId: null });
    });
  }

  async afterDeactivation(tx: Transaction, accountId: string): Promise<void> {
    const left = await tx.execute<{ id: string; key: string; organization_id: string }>(sql`
      select s.id, s.key, o.home_organization_id as organization_id from spaces s
      join accounts o on o.id = s.owner_account_id
      where s.owner_account_id = ${accountId} and s.personal_of is not null and s.deleted_at is null
        and o.home_organization_id is not null
        and exists (select 1 from space_permissions sp join accounts a on a.id = sp.principal_id
          where ${remainingMember(sql`s`)})
        and not ${activeAdministratorCondition(storedGrants(sql`s.id`), sql`s.organization_id`)}`);
    for (const space of left.rows) {
      const recipients = await organizationSpaceManagers(tx, space.organization_id);
      if (recipients.length === 0) continue;
      await this.#notifications.notify(tx, {
        type: "space.personalWithoutAdministrator",
        recipients,
        organizationId: space.organization_id,
        targetId: space.id,
        params: { spaceKey: space.key },
      });
    }
  }

  async #reviewed(tx: Transaction, spaceId: string, organizationId: string | null) {
    const result = await tx.execute<SummaryRow & { name: string }>(sql`
      select ${summaryColumns()}, s.name from spaces s join accounts o on o.id = s.owner_account_id
      where s.id = ${spaceId} and s.personal_of is not null and s.deleted_at is null and o.state <> 'active'
        ${organizationId ? sql`and o.home_organization_id = ${organizationId}` : sql``}
      for update of s`);
    const row = result.rows[0];
    if (!row)
      throw new SpaceError("spaceNotFound", "The personal space does not exist or its owner is active");
    return { ...toSummary(row), name: row.name };
  }

  async #remaining(
    tx: Transaction,
    spaceId: string,
    actor: Principal,
  ): Promise<{ id: string; name: string; role: string }[]> {
    const result = await tx.execute<{ id: string; name: string; role: string }>(sql`
      select a.id, a.name, sp.role::text as role from spaces s
      join space_permissions sp on sp.space_id = s.id join accounts a on a.id = sp.principal_id
      where s.id = ${spaceId} and ${remainingMember(sql`s`)} and a.id is distinct from ${actorIdOf(actor)}
      order by lower(a.name), a.id`);
    return result.rows;
  }

  async transfer(actor: Principal, spaceId: string, accountId: string): Promise<void> {
    if (actor.type === "account" && actor.id === accountId) {
      throw new SpaceError(
        "selfAppointment",
        "Choose someone else; instance roles never give access to content",
      );
    }
    await this.#database.transaction(async (tx) => {
      const space = await this.#spaces.lock(tx, spaceId);
      if (!space.personal) throw new SpaceError("spaceNotFound", "The personal space does not exist");
      const owner = await tx.execute<{ state: string }>(
        sql`select state from accounts where id = ${space.ownerId}`,
      );
      if (owner.rows[0]?.state === "active") {
        throw new SpaceError(
          "notUnderReview",
          "Only personal spaces of deactivated owners can be transferred",
        );
      }
      const remaining = await this.#remaining(tx, spaceId, actor);
      if (!remaining.some((member) => member.id === accountId)) {
        throw new SpaceError(
          "invalidHolder",
          "A personal space can go to one of its remaining active members only",
        );
      }
      await tx.execute(
        sql`update spaces set owner_account_id = ${accountId}, updated_at = now() where id = ${spaceId}`,
      );
      if (space.ownerId) {
        await tx.execute(sql`
          delete from space_permissions
          where space_id = ${spaceId} and principal_kind = 'account' and principal_id = ${space.ownerId}`);
      }
      await tx.execute(sql`
        insert into space_permissions (id, space_id, principal_kind, principal_id, role, created_by)
        values (${uuidv7()}, ${spaceId}, 'account', ${accountId}, 'admin', ${actor.type === "account" ? actor.id : null})
        on conflict on constraint space_permissions_holder_unique do update set role = 'admin', updated_at = now()`);
      await this.#audit.record(tx, {
        name: "space.personalTransferred",
        actor,
        targetId: spaceId,
        fields: { previousOwnerId: space.ownerId, ownerId: accountId },
        scope: auditScopeOf(space),
      });
      await signalSpaceChange(tx, { spaceId, kind: "access", itemId: null });
    });
  }
}
