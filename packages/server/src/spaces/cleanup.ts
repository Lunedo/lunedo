import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import { organizationMembership } from "../authorization/space-access.js";
import type { Database, Transaction } from "../database/database.js";
import { afterKey, FIRST_PAGE, type Page, type PageRequest, pageLimit, toPage } from "../database/keyset.js";
import type { SettingsService } from "../settings/service.js";
import { auditScopeOf, SpaceError } from "./common.js";
import { lockSpaces } from "./items.js";
import { cleanupGraceDaysSetting } from "./settings.js";
import { ERASURE_REASON_MAX_LENGTH, type TrashService } from "./trash.js";

export type ProtectedSpaceKind = "personal" | "oneOnOne" | "confidential";

export interface FormerMember {
  id: string;
  name: string;
}

export interface OrphanedSpace {
  id: string;
  key: string;
  kind: ProtectedSpaceKind;
  storageBytes: number;
  pages: number;
  lastActivityAt: Date;
  orphanedAt: Date;
  formerMembers: FormerMember[];
}

interface OrphanedRow extends Record<string, unknown> {
  id: string;
  key: string;
  kind: ProtectedSpaceKind;
  storage: string;
  pages: string;
  last_activity_at: Date | string;
  orphaned_at: Date | string;
}

const PROTECTED = sql`(s.personal_of is not null or s.confidential)`;

function kindOf(space: SQL): SQL {
  return sql`(case when ${space}.personal_of is not null then 'personal'
    when ${space}.one_on_one then 'oneOnOne' else 'confidential' end)`;
}

export function activeHolderCondition(space: SQL): SQL {
  const member = organizationMembership(sql`${space}.organization_id`, sql`a.id`);
  return sql`(exists (select 1 from space_permissions sp join accounts a on a.id = sp.principal_id
    where sp.space_id = ${space}.id and sp.principal_kind = 'account' and a.state = 'active' and ${member})
    or exists (select 1 from space_permissions sp join group_members gm on gm.group_id = sp.principal_id
      join accounts a on a.id = gm.account_id
      where sp.space_id = ${space}.id and sp.principal_kind = 'group' and a.state = 'active'
        and (gm.expires_at is null or gm.expires_at > now()) and ${member}))`;
}

function heldBy(space: SQL, accountId: string): SQL {
  return sql`exists (select 1 from space_permissions sp where sp.space_id = ${space}.id and (
    (sp.principal_kind = 'account' and sp.principal_id = ${accountId})
    or (sp.principal_kind = 'group' and exists (select 1 from group_members gm
      where gm.group_id = sp.principal_id and gm.account_id = ${accountId}))))`;
}

function belongsTo(organizationId: string): SQL {
  return sql`(s.organization_id = ${organizationId} or (s.personal_of is not null and exists (
    select 1 from accounts o where o.id = coalesce(s.owner_account_id, s.personal_of)
      and o.home_organization_id = ${organizationId})))`;
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

export class SpaceCleanupService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #settings: SettingsService;
  readonly #trash: TrashService;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    settings: SettingsService;
    trash: TrashService;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#settings = options.settings;
    this.#trash = options.trash;
  }

  async graceDays(organizationId: string): Promise<number> {
    return this.#settings.get(cleanupGraceDaysSetting, { organization: organizationId });
  }

  #due(organizationId: string, graceDays: number): SQL {
    return sql`${PROTECTED} and s.deleted_at is null and ${belongsTo(organizationId)}
      and s.orphaned_at is not null and s.orphaned_at <= now() - make_interval(days => ${graceDays})
      and not ${activeHolderCondition(sql`s`)}`;
  }

  async list(organizationId: string, page: PageRequest = FIRST_PAGE): Promise<Page<OrphanedSpace>> {
    const graceDays = await this.graceDays(organizationId);
    const result = await this.#database.execute<OrphanedRow>(sql`
      select s.id, s.key, ${kindOf(sql`s`)} as kind, s.orphaned_at,
        (select count(*) from tree_items t where t.space_id = s.id and t.trash_entry_id is null
          and t.kind in ('page', 'blogPost')) as pages,
        (select coalesce(sum(f.size), 0) from stored_files f where f.id in (
          select av.file_id from attachment_versions av
          join attachments at on at.id = av.attachment_id
          join tree_items t on t.id = at.item_id
          where t.space_id = s.id)) as storage,
        greatest(s.updated_at, coalesce((select max(t.content_updated_at) from tree_items t
          where t.space_id = s.id), s.updated_at)) as last_activity_at
      from spaces s
      where ${this.#due(organizationId, graceDays)}
        ${page.after ? sql`and ${afterKey([sql`s.key`, sql`s.id`], page.after)}` : sql``}
      order by s.key, s.id
      limit ${pageLimit(page)}`);
    const paged = toPage(
      result.rows,
      page,
      (row) => [row.key, row.id],
      (row) => row,
    );
    const ids = paged.items.map((row) => row.id);
    const members = new Map<string, FormerMember[]>();
    if (ids.length > 0) {
      const holders = await this.#database.execute<{ space_id: string; id: string; name: string }>(sql`
        select sp.space_id, a.id, a.name from space_permissions sp join accounts a on a.id = sp.principal_id
        where sp.space_id = any(${sql.param(ids)}::uuid[]) and sp.principal_kind = 'account'
        order by lower(a.name), a.id`);
      for (const holder of holders.rows) {
        members.set(holder.space_id, [
          ...(members.get(holder.space_id) ?? []),
          { id: holder.id, name: holder.name },
        ]);
      }
    }
    return {
      items: paged.items.map((row) => ({
        id: row.id,
        key: row.key,
        kind: row.kind,
        storageBytes: Number(row.storage),
        pages: Number(row.pages),
        lastActivityAt: new Date(row.last_activity_at),
        orphanedAt: new Date(row.orphaned_at),
        formerMembers: members.get(row.id) ?? [],
      })),
      next: paged.next,
    };
  }

  async delete(
    actor: Principal,
    organizationId: string,
    spaceId: string,
    input: { confirmation: string; reason: string },
  ): Promise<void> {
    const reason = cleanReason(input.reason);
    const graceDays = await this.graceDays(organizationId);
    await this.#database.transaction(async (tx) => {
      await lockSpaces(tx, [spaceId]);
      const found = await tx.execute<{
        key: string;
        name: string;
        kind: ProtectedSpaceKind;
        due: boolean;
      }>(sql`
        select s.key, s.name, ${kindOf(sql`s`)} as kind, (${this.#due(organizationId, graceDays)}) as due
        from spaces s
        where s.id = ${spaceId} and ${PROTECTED} and s.deleted_at is null and ${belongsTo(organizationId)}`);
      const space = found.rows[0];
      if (!space) throw new SpaceError("spaceNotFound", "The space does not exist");
      if (!space.due) {
        throw new SpaceError(
          "notInCleanup",
          "Only spaces without active members whose waiting period has passed can be deleted here",
        );
      }
      if (input.confirmation.trim().toUpperCase() !== space.key) {
        throw new SpaceError("confirmationMismatch", "Type the key of the space exactly to delete it");
      }
      await this.#trash.moveSpaceToTrash(tx, actor, spaceId, space.name || space.key);
      await this.#audit.record(tx, {
        name: "space.cleanupDeleted",
        actor,
        targetId: spaceId,
        fields: { key: space.key, kind: space.kind, reason },
        scope: auditScopeOf({ organizationId }),
      });
    });
  }

  async afterDeactivation(tx: Transaction, accountId: string): Promise<void> {
    await this.#markOrphaned(tx, accountId, null);
  }

  async afterMembershipEnded(tx: Transaction, organizationId: string, accountId: string): Promise<void> {
    await this.#markOrphaned(tx, accountId, organizationId);
  }

  async afterAccessChange(tx: Transaction, spaceId: string): Promise<void> {
    await tx.execute(sql`
      update spaces s set orphaned_at = case when ${activeHolderCondition(sql`s`)} then null else now() end
      where s.id = ${spaceId} and ${PROTECTED} and s.deleted_at is null`);
  }

  async #markOrphaned(tx: Transaction, accountId: string, organizationId: string | null): Promise<void> {
    await tx.execute(sql`
      update spaces s set orphaned_at = now()
      where ${PROTECTED} and s.deleted_at is null
        ${organizationId ? sql`and s.organization_id = ${organizationId}` : sql``}
        and ${heldBy(sql`s`, accountId)}
        and not ${activeHolderCondition(sql`s`)}`);
  }

  async afterActivity(tx: Transaction, accountId: string): Promise<void> {
    await tx.execute(sql`
      update spaces s set orphaned_at = null
      where ${PROTECTED} and s.orphaned_at is not null and ${heldBy(sql`s`, accountId)}
        and ${activeHolderCondition(sql`s`)}`);
  }
}
