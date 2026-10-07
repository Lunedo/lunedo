import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import { type AuthorizationService, ForbiddenError } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import { afterKey, FIRST_PAGE, type Page, type PageRequest, pageLimit, toPage } from "../database/keyset.js";
import { auditScopeOf, isUniqueViolation, SpaceError } from "./common.js";
import { insertPage } from "./items.js";
import { randomPersonalSpaceKey } from "./keys.js";
import { signalSpaceChange } from "./signals.js";
import type { Space, SpaceService } from "./spaces.js";

export interface PersonalSpaceForReview {
  spaceId: string;
  ownerId: string | null;
  ownerName: string | null;
  ownerState: string | null;
  pages: number;
  lastChangedAt: Date;
}

const KEY_ATTEMPTS = 8;

export class PersonalSpaceService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #authorization: AuthorizationService;
  readonly #spaces: SpaceService;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    authorization: AuthorizationService;
    spaces: SpaceService;
  }) {
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
          await tx.execute(sql`
            insert into space_permissions (id, space_id, principal_kind, principal_id, role, created_by)
            values (${uuidv7()}, ${spaceId}, 'account', ${actor.id}, 'admin', ${actor.id})`);
          const overview = await insertPage(tx, {
            spaceId,
            parentId: null,
            title: overviewTitle,
            actorId: actor.id,
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
      owner_id: string | null;
      owner_name: string | null;
      owner_state: string | null;
      pages: string;
      last_changed_at: Date | string;
      sort_name: string;
    }>(sql`
      select s.id as space_id, s.owner_account_id as owner_id, a.name as owner_name, a.state::text as owner_state,
        (select count(*) from tree_items t where t.space_id = s.id and t.kind = 'page') as pages,
        greatest(s.updated_at, coalesce((select max(t.content_updated_at) from tree_items t where t.space_id = s.id),
          s.updated_at)) as last_changed_at,
        lower(coalesce(a.name, '')) as sort_name
      from spaces s left join accounts a on a.id = s.owner_account_id
      where s.personal_of is not null and (a.id is null or a.state <> 'active')
        ${page.after ? sql`and ${afterKey([sql`lower(coalesce(a.name, ''))`, sql`s.id`], page.after)}` : sql``}
      order by lower(coalesce(a.name, '')), s.id
      limit ${pageLimit(page)}`);
    return toPage(
      result.rows,
      page,
      (row) => [row.sort_name, row.space_id],
      (row) => ({
        spaceId: row.space_id,
        ownerId: row.owner_id,
        ownerName: row.owner_name,
        ownerState: row.owner_state,
        pages: Number(row.pages),
        lastChangedAt: new Date(row.last_changed_at),
      }),
    );
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
      const target = await tx.execute<{ id: string }>(
        sql`select id from accounts where id = ${accountId} and state = 'active' and type = 'standard'`,
      );
      if (!target.rows[0]) {
        throw new SpaceError("invalidHolder", "A personal space can go to an active standard account only");
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
