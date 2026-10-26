import { uuidv7 } from "@lunedo/shared";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import { accountItemCondition } from "../authorization/item-access.js";
import { type AuthorizationService, ForbiddenError } from "../authorization/service.js";
import { spaceRoleConditionFor } from "../authorization/space-access.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { NotificationService } from "../notifications/service.js";
import { auditScopeOf, SpaceError } from "../spaces/common.js";
import type { PeopleService } from "../spaces/people.js";
import type { SpacePermissionService } from "../spaces/permissions.js";
import type { SpaceRole } from "../spaces/schema.js";
import type { PageAccessService } from "./page-access.js";
import type { AccessRequestStatus, ShareRole } from "./schema.js";

export const ACCESS_REQUEST_MESSAGE_MAX_LENGTH = 1000;
const REQUESTS_PER_DAY = 30;

export interface AccessRequest {
  id: string;
  requester: { id: string; name: string | null; email: string | null };
  spaceId: string;
  spaceName: string;
  itemId: string | null;
  itemTitle: string | null;
  message: string;
  status: AccessRequestStatus;
  role: SpaceRole | null;
  decidedBy: { id: string; name: string | null } | null;
  decidedAt: Date | null;
  createdAt: Date;
}

interface RequestRow {
  id: string;
  requester_id: string;
  requester_name: string | null;
  requester_email: string | null;
  space_id: string;
  space_name: string;
  space_key: string;
  organization_id: string | null;
  item_id: string | null;
  item_title: string | null;
  item_kind: string | null;
  message: string;
  status: AccessRequestStatus;
  role: SpaceRole | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: Date | string | null;
  created_at: Date | string;
  [key: string]: unknown;
}

export class AccessRequestService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #audit: AuditLog;
  readonly #people: PeopleService;
  readonly #notifications: NotificationService;
  readonly #pageAccess: PageAccessService;
  readonly #spacePermissions: SpacePermissionService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    audit: AuditLog;
    people: PeopleService;
    notifications: NotificationService;
    pageAccess: PageAccessService;
    spacePermissions: SpacePermissionService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#audit = options.audit;
    this.#people = options.people;
    this.#notifications = options.notifications;
    this.#pageAccess = options.pageAccess;
    this.#spacePermissions = options.spacePermissions;
  }

  #select(viewer: Principal) {
    return sql`
      select r.id, r.requester_id, ${this.#people.visibleName(viewer, sql`ra`)} as requester_name,
        case when ${this.#people.colleagueCondition(viewer, sql`ra.id`)} then ra.email end as requester_email,
        r.space_id, s.name as space_name, s.key as space_key, s.organization_id, r.item_id,
        t.title as item_title, t.kind::text as item_kind, r.message, r.status, r.role, r.decided_by,
        ${this.#people.visibleName(viewer, sql`da`)} as decided_by_name, r.decided_at, r.created_at
      from access_requests r join accounts ra on ra.id = r.requester_id join spaces s on s.id = r.space_id
      left join tree_items t on t.id = r.item_id left join accounts da on da.id = r.decided_by`;
  }

  #toRequest(row: RequestRow, options: { hideSpace?: boolean } = {}): AccessRequest {
    return {
      id: row.id,
      requester: { id: row.requester_id, name: row.requester_name, email: row.requester_email },
      spaceId: row.space_id,
      spaceName: options.hideSpace ? "" : row.space_name,
      itemId: row.item_id,
      itemTitle: options.hideSpace ? null : row.item_title,
      message: row.message,
      status: row.status,
      role: row.role,
      decidedBy: row.decided_by ? { id: row.decided_by, name: row.decided_by_name } : null,
      decidedAt: row.decided_at ? new Date(row.decided_at) : null,
      createdAt: new Date(row.created_at),
    };
  }

  async #hasAccess(
    executor: Executor,
    accountId: string,
    spaceId: string,
    itemId: string | null,
  ): Promise<boolean> {
    const result = await executor.execute<{ access: boolean }>(
      itemId
        ? sql`select ${accountItemCondition(sql`${accountId}::uuid`, sql`t`, sql`s`, "reader")} and t.reader_visible as access
            from tree_items t join spaces s on s.id = t.space_id where t.id = ${itemId}`
        : sql`select ${spaceRoleConditionFor(sql`${accountId}::uuid`, sql`s`, "reader")} as access
            from spaces s where s.id = ${spaceId}`,
    );
    return result.rows[0]?.access === true;
  }

  async discoverableSpaces(
    viewer: Principal,
    organizationId: string,
  ): Promise<{ id: string; key: string; name: string; description: string; requested: boolean }[]> {
    if (viewer.type !== "account") return [];
    const result = await this.#database.execute<{
      id: string;
      key: string;
      name: string;
      description: string;
      requested: boolean;
    }>(sql`
      select s.id, s.key, s.name, s.description,
        exists (select 1 from access_requests r where r.space_id = s.id and r.item_id is null
          and r.requester_id = ${viewer.id} and r.status = 'open') as requested
      from spaces s
      where s.organization_id = ${organizationId} and s.discoverable and s.deleted_at is null
        and s.personal_of is null
        and exists (select 1 from memberships m where m.organization_id = s.organization_id
          and m.account_id = ${viewer.id} and m.kind = 'member' and (m.expires_at is null or m.expires_at > now()))
        and not ${spaceRoleConditionFor(sql`${viewer.id}::uuid`, sql`s`, "reader")}
      order by lower(s.name), s.id limit 500`);
    return result.rows;
  }

  async requestSpace(actor: Principal, spaceId: string, message: string): Promise<AccessRequest> {
    if (actor.type !== "account") throw new SpaceError("signInRequired", "Sign in to request access");
    const space = await this.#database.execute<{ discoverable: boolean; organization_id: string | null }>(sql`
      select s.discoverable, s.organization_id from spaces s
      where s.id = ${spaceId} and s.deleted_at is null and s.personal_of is null`);
    const row = space.rows[0];
    const member =
      row?.organization_id &&
      (
        await this.#database.execute(sql`
          select 1 from memberships m where m.organization_id = ${row.organization_id} and m.account_id = ${actor.id}
            and m.kind = 'member' and (m.expires_at is null or m.expires_at > now())`)
      ).rows.length > 0;
    if (!row?.discoverable || !member) throw new SpaceError("spaceNotFound", "The space does not exist");
    if (await this.#hasAccess(this.#database, actor.id, spaceId, null)) {
      throw new SpaceError("alreadyHasAccess", "You already have access to this space");
    }
    const id = await this.#create(actor, spaceId, null, message);
    const created = await this.get(actor, id);
    if (!created) throw new Error("The access request was not created");
    return created;
  }

  async requestPage(actor: Principal, itemId: string, message: string): Promise<void> {
    if (actor.type !== "account") throw new SpaceError("signInRequired", "Sign in to request access");
    const item = await this.#database.execute<{ space_id: string }>(sql`
      select t.space_id from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${itemId} and t.trash_entry_id is null and s.deleted_at is null and t.kind in ('page', 'folder', 'blogPost', 'whiteboard')`);
    const spaceId = item.rows[0]?.space_id;
    await this.#checkDailyLimit(this.#database, actor.id);
    if (!spaceId || (await this.#hasAccess(this.#database, actor.id, spaceId, itemId))) return;
    await this.#create(actor, spaceId, itemId, message);
  }

  async #create(
    actor: Extract<Principal, { type: "account" }>,
    spaceId: string,
    itemId: string | null,
    message: string,
  ): Promise<string> {
    const text = message.trim();
    if (text.length > ACCESS_REQUEST_MESSAGE_MAX_LENGTH) {
      throw new SpaceError(
        "messageTooLong",
        `The message can have up to ${ACCESS_REQUEST_MESSAGE_MAX_LENGTH} characters`,
      );
    }
    const created = await this.#database.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`accessRequest:${actor.id}`}, 0))`,
      );
      const existing = await tx.execute<{ id: string }>(sql`
        select id from access_requests where requester_id = ${actor.id} and space_id = ${spaceId}
          and item_id is not distinct from ${itemId} and status = 'open'`);
      if (existing.rows[0]) return { id: existing.rows[0].id, mailIds: [] };
      await this.#checkDailyLimit(tx, actor.id);
      const id = uuidv7();
      await tx.execute(sql`
        insert into access_requests (id, requester_id, space_id, item_id, message)
        values (${id}, ${actor.id}, ${spaceId}, ${itemId}, ${text})`);
      const row = (await tx.execute<RequestRow>(sql`${this.#select({ type: "system" })} where r.id = ${id}`))
        .rows[0];
      if (!row) throw new Error("The access request was not created");
      const recipients = await this.deciders(tx, spaceId, itemId);
      const result = await this.#notifications.notify(tx, {
        type: "access.requested",
        recipients: recipients.filter((recipient) => recipient !== actor.id),
        actor,
        organizationId: row.organization_id,
        targetId: id,
        params: {
          requestId: id,
          target: itemId ? "page" : "space",
          requesterName: row.requester_name ?? "",
          spaceId,
          spaceName: row.space_name,
          spaceKey: row.space_key,
          itemTitle: row.item_title,
          message: text,
        },
      });
      return { id, mailIds: result.mailIds };
    });
    await this.#notifications.dispatch(created.mailIds);
    return created.id;
  }

  async #checkDailyLimit(executor: Executor, accountId: string): Promise<void> {
    const recent = await executor.execute<{ count: string }>(sql`
      select count(*) as count from access_requests
      where requester_id = ${accountId} and created_at > now() - interval '1 day'`);
    if (Number(recent.rows[0]?.count ?? 0) >= REQUESTS_PER_DAY) {
      throw new SpaceError(
        "tooManyRequests",
        "You sent many requests today; wait for answers or try again tomorrow",
      );
    }
  }

  async deciders(executor: Executor, spaceId: string, itemId: string | null): Promise<string[]> {
    const administrators = await this.#pageAccess.spaceAdministrators(executor, spaceId);
    if (!itemId) return administrators;
    const setters = await executor.execute<{ set_by: string }>(sql`
      select distinct r.set_by from page_restrictions r join tree_items t on t.id = ${itemId}
      join accounts a on a.id = r.set_by
      where r.item_id = any(t.path) and r.set_by is not null and a.state = 'active'`);
    return [...new Set([...administrators, ...setters.rows.map((row) => row.set_by)])];
  }

  async get(viewer: Principal, id: string): Promise<AccessRequest | null> {
    const result = await this.#database.execute<RequestRow>(sql`${this.#select(viewer)} where r.id = ${id}`);
    const row = result.rows[0];
    if (!row) return null;
    const own = viewer.type === "account" && viewer.id === row.requester_id;
    if (own) {
      const hide = !(await this.#hasAccess(this.#database, row.requester_id, row.space_id, row.item_id));
      return this.#toRequest(row, { hideSpace: hide && row.item_id !== null });
    }
    if (!(await this.#mayDecide(viewer, row))) return null;
    return this.#toRequest(row);
  }

  async mine(viewer: Principal): Promise<AccessRequest[]> {
    if (viewer.type !== "account") return [];
    const result = await this.#database.execute<RequestRow>(sql`
      ${this.#select(viewer)} where r.requester_id = ${viewer.id}
      order by r.created_at desc limit 100`);
    const requests: AccessRequest[] = [];
    for (const row of result.rows) {
      const hide =
        row.item_id !== null &&
        !(await this.#hasAccess(this.#database, viewer.id, row.space_id, row.item_id));
      requests.push(this.#toRequest(row, { hideSpace: hide }));
    }
    return requests;
  }

  async forSpace(viewer: Principal, spaceId: string): Promise<AccessRequest[]> {
    const result = await this.#database.execute<RequestRow>(sql`
      ${this.#select(viewer)} where r.space_id = ${spaceId} and r.status = 'open'
      order by r.created_at limit 500`);
    const decide = this.#authorization.batch(viewer);
    const decidable = await Promise.all(
      result.rows.map(
        async (row) =>
          (await decide("space.manage", { type: "space", id: row.space_id })).allowed ||
          (row.item_id !== null && (await decide("item.share", { type: "item", id: row.item_id })).allowed),
      ),
    );
    return result.rows.filter((_, index) => decidable[index]).map((row) => this.#toRequest(row));
  }

  async #mayDecide(viewer: Principal, row: { space_id: string; item_id: string | null }): Promise<boolean> {
    if (await this.#authorization.authorize(viewer, "space.manage", { type: "space", id: row.space_id }))
      return true;
    return (
      row.item_id !== null &&
      this.#authorization.authorize(viewer, "item.share", { type: "item", id: row.item_id })
    );
  }

  async withdraw(actor: Principal, id: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const row = (
        await tx.execute<{ requester_id: string; status: AccessRequestStatus }>(sql`
        select requester_id, status from access_requests where id = ${id} for update`)
      ).rows[0];
      if (!row || actor.type !== "account" || row.requester_id !== actor.id) {
        throw new SpaceError("requestNotFound", "The request does not exist");
      }
      if (row.status !== "open") throw new SpaceError("requestClosed", "The request was already decided");
      await tx.execute(
        sql`update access_requests set status = 'withdrawn', updated_at = now() where id = ${id}`,
      );
    });
  }

  async decide(
    actor: Principal,
    id: string,
    decision: { approve: true; role: SpaceRole; includeDescendants?: boolean } | { approve: false },
  ): Promise<AccessRequest> {
    const located = await this.#database.execute<RequestRow>(sql`${this.#select(actor)} where r.id = ${id}`);
    const visible = located.rows[0];
    if (!visible || !(await this.#mayDecide(actor, visible))) {
      throw new SpaceError("requestNotFound", "The request does not exist");
    }
    if (decision.approve && visible.item_id && decision.role === "admin") {
      throw new SpaceError("invalidRole", "Pages can be shared to read, comment or edit");
    }
    const mailIds = await this.#database.transaction(async (tx) => {
      const locked = await tx.execute<RequestRow>(
        sql`${this.#select({ type: "system" })} where r.id = ${id} for update of r`,
      );
      const request = locked.rows[0];
      if (request?.status !== "open") {
        throw new SpaceError("requestClosed", "The request was already decided");
      }
      await tx.execute(sql`
        update access_requests set status = ${decision.approve ? "approved" : "declined"},
          role = ${decision.approve ? decision.role : null}, decided_by = ${actor.type === "account" ? actor.id : null},
          decided_at = now(), updated_at = now()
        where id = ${id}`);
      const mails: string[] = [];
      if (decision.approve && request.item_id) {
        mails.push(
          ...(await this.#pageAccess.changeWithin(tx, actor, request.item_id, [
            {
              action: "share",
              holderKind: "account",
              holderId: request.requester_id,
              role: decision.role as ShareRole,
              includeDescendants: decision.includeDescendants ?? false,
            },
          ])),
        );
      } else if (decision.approve) {
        const allowed = await this.#authorization.explain(
          actor,
          "space.manage",
          { type: "space", id: request.space_id },
          { executor: tx, fresh: true },
        );
        if (!allowed.allowed) throw new ForbiddenError(allowed);
        await this.#spacePermissions.apply(
          actor,
          request.space_id,
          {
            action: "grant",
            principalKind: "account",
            principalId: request.requester_id,
            role: decision.role,
          },
          { tx },
        );
      }
      await this.#audit.record(tx, {
        name: "accessRequest.decided",
        actor,
        targetId: id,
        fields: {
          spaceId: request.space_id,
          itemId: request.item_id,
          title: request.item_title,
          requesterId: request.requester_id,
          decision: decision.approve ? "approved" : "declined",
          role: decision.approve ? decision.role : null,
        },
        scope: auditScopeOf({ organizationId: request.organization_id }),
      });
      mails.push(
        ...(await this.#notifyRequester(
          tx,
          actor,
          request,
          decision.approve ? "approved" : "declined",
          decision.approve ? decision.role : null,
        )),
      );
      return mails;
    });
    await this.#notifications.dispatch(mailIds);
    const decided = await this.get(actor, id);
    if (!decided) throw new SpaceError("requestNotFound", "The request does not exist");
    return decided;
  }

  async #notifyRequester(
    tx: Transaction,
    actor: Principal | null,
    request: RequestRow,
    decision: "approved" | "declined" | "satisfied",
    role: SpaceRole | null,
  ): Promise<string[]> {
    const reveal = decision !== "declined";
    const result = await this.#notifications.notify(tx, {
      type: "access.requestDecided",
      recipients: [request.requester_id],
      actor,
      organizationId: request.organization_id,
      targetId: request.id,
      params: {
        requestId: request.id,
        target: request.item_id ? "page" : "space",
        decision,
        role,
        spaceName: reveal || request.item_id === null ? request.space_name : "",
        spaceKey: reveal && request.item_id === null ? request.space_key : "",
        itemTitle: reveal ? request.item_title : null,
      },
    });
    return result.mailIds;
  }

  async closeSatisfied(tx: Transaction, spaceId: string): Promise<void> {
    const open = await tx.execute<RequestRow>(sql`
      ${this.#select({ type: "system" })} where r.space_id = ${spaceId} and r.status = 'open' for update of r`);
    for (const request of open.rows) {
      if (!(await this.#hasAccess(tx, request.requester_id, request.space_id, request.item_id))) continue;
      await tx.execute(
        sql`update access_requests set status = 'satisfied', updated_at = now() where id = ${request.id}`,
      );
      await this.#notifyRequester(tx, null, request, "satisfied", null);
    }
  }
}
