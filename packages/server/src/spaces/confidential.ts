import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import { activeAdministratorCondition, storedGrants } from "../authorization/space-access.js";
import type { Database, Transaction } from "../database/database.js";
import { afterKey, FIRST_PAGE, type Page, type PageRequest, pageLimit, toPage } from "../database/keyset.js";
import type { NotificationService } from "../notifications/service.js";
import { actorIdOf, auditScopeOf, SpaceError } from "./common.js";
import { signalSpaceChange } from "./signals.js";
import { ERASURE_REASON_MAX_LENGTH } from "./trash.js";

export interface ConfidentialSpaceSummary {
  id: string;
  key: string;
  createdAt: Date;
  members: number;
  activeMembers: number;
  pages: number;
  lastChangedAt: Date;
  needsAdministrator: boolean;
  deletable: boolean;
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

function activeHolder(space: ReturnType<typeof sql>): ReturnType<typeof sql> {
  return sql`exists (select 1 from space_permissions sp join accounts a on a.id = sp.principal_id
    where sp.space_id = ${space}.id and sp.principal_kind = 'account' and a.state = 'active')`;
}

function toSummary(row: SummaryRow): ConfidentialSpaceSummary {
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
    deletable: activeMembers === 0,
  };
}

function cleanReason(reason: string): string {
  const value = reason.replace(/\s+/g, " ").trim();
  if (value.length === 0 || value.length > ERASURE_REASON_MAX_LENGTH) {
    throw new SpaceError(
      "reasonRequired",
      `Name the reason for deleting the space in 1 to ${ERASURE_REASON_MAX_LENGTH} characters`,
    );
  }
  return value;
}

export class ConfidentialSpaceService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #notifications: NotificationService;

  constructor(options: { database: Database; audit: AuditLog; notifications: NotificationService }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#notifications = options.notifications;
  }

  #summaryColumns() {
    return sql`s.id, s.key, s.created_at,
      (select count(*) from space_permissions sp where sp.space_id = s.id) as members,
      (select count(*) from space_permissions sp join accounts a on a.id = sp.principal_id
        where sp.space_id = s.id and sp.principal_kind = 'account' and a.state = 'active') as active_members,
      (select count(*) from tree_items t where t.space_id = s.id and t.trash_entry_id is null
        and t.kind in ('page', 'blogPost')) as pages,
      greatest(s.updated_at, (select max(t.content_updated_at) from tree_items t where t.space_id = s.id))
        as last_changed_at,
      ${activeAdministratorCondition(storedGrants(sql`s.id`), sql`s.organization_id`)} as has_administrator`;
  }

  async list(
    organizationId: string,
    page: PageRequest = FIRST_PAGE,
  ): Promise<Page<ConfidentialSpaceSummary>> {
    const result = await this.#database.execute<SummaryRow>(sql`
      select ${this.#summaryColumns()} from spaces s
      where s.organization_id = ${organizationId} and s.confidential and s.deleted_at is null
        ${page.after ? sql`and ${afterKey([sql`s.key`, sql`s.id`], page.after)}` : sql``}
      order by s.key, s.id
      limit ${pageLimit(page)}`);
    return toPage(result.rows, page, (row) => [row.key, row.id], toSummary);
  }

  async count(organizationId: string): Promise<number> {
    const result = await this.#database.execute<{ count: string }>(sql`
      select count(*) as count from spaces
      where organization_id = ${organizationId} and confidential and deleted_at is null`);
    return Number(result.rows[0]?.count ?? 0);
  }

  async #summary(tx: Transaction, organizationId: string, spaceId: string) {
    const result = await tx.execute<SummaryRow>(sql`
      select ${this.#summaryColumns()} from spaces s
      where s.id = ${spaceId} and s.organization_id = ${organizationId} and s.confidential
        and s.deleted_at is null
      for update of s`);
    const row = result.rows[0];
    if (!row) throw new SpaceError("spaceNotFound", "The space does not exist");
    return toSummary(row);
  }

  async remainingMembers(
    actor: Principal,
    organizationId: string,
    spaceId: string,
  ): Promise<{ id: string; name: string }[]> {
    return this.#database.transaction(async (tx) => {
      const summary = await this.#summary(tx, organizationId, spaceId);
      if (!summary.needsAdministrator) return [];
      const result = await tx.execute<{ id: string; name: string }>(sql`
        select a.id, a.name from space_permissions sp join accounts a on a.id = sp.principal_id
        where sp.space_id = ${spaceId} and sp.principal_kind = 'account' and a.state = 'active'
          and a.id is distinct from ${actorIdOf(actor)}
        order by lower(a.name), a.id`);
      return result.rows;
    });
  }

  async appointAdministrator(
    actor: Principal,
    organizationId: string,
    spaceId: string,
    accountId: string,
  ): Promise<void> {
    if (actor.type === "account" && actor.id === accountId) {
      throw new SpaceError(
        "selfAppointment",
        "Appoint someone else; nobody can extend their own permissions",
      );
    }
    await this.#database.transaction(async (tx) => {
      const summary = await this.#summary(tx, organizationId, spaceId);
      if (!summary.needsAdministrator) {
        throw new SpaceError(
          "spaceHasAdministrator",
          "The space has a space admin who manages its permissions",
        );
      }
      const member = await tx.execute<{ role: string }>(sql`
        select sp.role from space_permissions sp join accounts a on a.id = sp.principal_id
        where sp.space_id = ${spaceId} and sp.principal_kind = 'account' and sp.principal_id = ${accountId}
          and a.state = 'active'`);
      const previous = member.rows[0]?.role;
      if (!previous) {
        throw new SpaceError(
          "invalidHolder",
          "Only a remaining member of the confidential space can become its space admin",
        );
      }
      await tx.execute(sql`
        update space_permissions set role = 'admin', updated_at = now()
        where space_id = ${spaceId} and principal_kind = 'account' and principal_id = ${accountId}`);
      const scope = auditScopeOf({ organizationId });
      await this.#audit.record(tx, {
        name: "space.confidentialAdministratorAppointed",
        actor,
        targetId: spaceId,
        fields: { key: summary.key, accountId },
        scope,
      });
      if (previous !== "admin") {
        await this.#audit.record(tx, {
          name: "space.permissionChanged",
          actor,
          targetId: spaceId,
          fields: {
            name: "",
            principalKind: "account",
            principalId: accountId,
            role: "admin",
            previousRole: previous as "reader" | "commenter" | "editor",
          },
          scope,
        });
      }
      await signalSpaceChange(tx, { spaceId, kind: "access", itemId: null });
    });
  }

  async delete(
    actor: Principal,
    organizationId: string,
    spaceId: string,
    input: { confirmation: string; reason: string },
  ): Promise<void> {
    const reason = cleanReason(input.reason);
    await this.#database.transaction(async (tx) => {
      const summary = await this.#summary(tx, organizationId, spaceId);
      if (!summary.deletable) {
        throw new SpaceError(
          "spaceHasMembers",
          "Active members remain; only they can decide about the space",
        );
      }
      if (input.confirmation.trim().toUpperCase() !== summary.key) {
        throw new SpaceError("confirmationMismatch", "Type the key of the space exactly to delete it");
      }
      await this.#audit.record(tx, {
        name: "space.confidentialDeleted",
        actor,
        targetId: spaceId,
        fields: { key: summary.key, reason },
        scope: auditScopeOf({ organizationId }),
      });
      await signalSpaceChange(tx, { spaceId, kind: "space", itemId: null });
      await signalSpaceChange(tx, { spaceId, kind: "access", itemId: null });
      await tx.execute(sql`delete from setting_values where level = 'space' and scope_id = ${spaceId}`);
      await tx.execute(sql`delete from spaces where id = ${spaceId}`);
    });
  }

  async afterDeactivation(tx: Transaction, accountId: string): Promise<void> {
    const orphaned = await tx.execute<{ id: string; key: string; organization_id: string }>(sql`
      select s.id, s.key, s.organization_id from spaces s
      where s.confidential and s.deleted_at is null
        and exists (select 1 from space_permissions sp where sp.space_id = s.id
          and sp.principal_kind = 'account' and sp.principal_id = ${accountId} and sp.role = 'admin')
        and not ${activeAdministratorCondition(storedGrants(sql`s.id`), sql`s.organization_id`)}
        and ${activeHolder(sql`s`)}`);
    for (const space of orphaned.rows) {
      const administrators = await tx.execute<{ account_id: string }>(sql`
        select distinct a.id as account_id from role_assignments ra
        left join custom_roles cr on cr.id = ra.custom_role_id
        join accounts a on a.state = 'active' and (
          (ra.principal_kind = 'account' and a.id = ra.principal_id)
          or (ra.principal_kind = 'group' and exists (select 1 from group_members gm
            where gm.group_id = ra.principal_id and gm.account_id = a.id
              and (gm.expires_at is null or gm.expires_at > now()))))
        where ra.scope = 'organization' and ra.organization_id = ${space.organization_id}
          and (ra.expires_at is null or ra.expires_at > now())
          and (ra.built_in_role in ('owner', 'administrator') or cr.areas ->> 'spaces' = 'manage')`);
      if (administrators.rows.length === 0) continue;
      await this.#notifications.notify(tx, {
        type: "space.confidentialWithoutAdministrator",
        recipients: administrators.rows.map((row) => row.account_id),
        organizationId: space.organization_id,
        targetId: space.id,
        params: { spaceKey: space.key },
      });
    }
  }
}
