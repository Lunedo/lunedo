import { uuidv7 } from "@lunedo/shared";
import { sql } from "drizzle-orm";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import { type AuthorizationService, ForbiddenError } from "../authorization/service.js";
import type { Database, Transaction } from "../database/database.js";
import type { NotificationService } from "../notifications/service.js";
import type { Invitation, InvitationService } from "../organizations/invitations.js";
import type { SettingsService } from "../settings/service.js";
import { auditScopeOf, SpaceError } from "../spaces/common.js";
import { spaceDisplayName } from "../spaces/display-name.js";
import type { PageAccessService } from "./page-access.js";
import type { AccessRequestService } from "./requests.js";
import type { ShareRole } from "./schema.js";
import { membersInviteGuestsSetting } from "./settings.js";

export class GuestShareService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #audit: AuditLog;
  readonly #settings: SettingsService;
  readonly #invitations: InvitationService;
  readonly #pageAccess: PageAccessService;
  readonly #requests: AccessRequestService;
  readonly #notifications: NotificationService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    audit: AuditLog;
    settings: SettingsService;
    invitations: InvitationService;
    pageAccess: PageAccessService;
    requests: AccessRequestService;
    notifications: NotificationService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#audit = options.audit;
    this.#settings = options.settings;
    this.#invitations = options.invitations;
    this.#pageAccess = options.pageAccess;
    this.#requests = options.requests;
    this.#notifications = options.notifications;
    options.invitations.onAccepted((tx, invitationId, accountId) =>
      this.#accepted(tx, invitationId, accountId),
    );
  }

  async allowed(actor: Principal, itemId: string): Promise<boolean> {
    const target = await this.#spaceOf(itemId);
    const organizationId = target?.organizationId ?? null;
    if (!target || !organizationId || actor.type !== "account") return false;
    if (target.confidential && !(await this.#isSpaceAdmin(actor, target.spaceId))) return false;
    return this.#organizationAllows(actor, organizationId);
  }

  async #isSpaceAdmin(actor: Principal, spaceId: string): Promise<boolean> {
    if (actor.type !== "account") return false;
    return (await this.#authorization.spaceRole(actor.id, spaceId, { fresh: true })).role === "admin";
  }

  async #organizationAllows(actor: Principal, organizationId: string): Promise<boolean> {
    if (
      await this.#authorization.authorize(actor, "organization.members.manage", {
        type: "organization",
        id: organizationId,
      })
    ) {
      return true;
    }
    const facts = await this.#authorization.explain(actor, "organization.view", {
      type: "organization",
      id: organizationId,
    });
    const member = facts.grants.some(
      (grant) => grant.kind === "membership" && grant.membershipKind === "member",
    );
    return member && (await this.#settings.get(membersInviteGuestsSetting, { organization: organizationId }));
  }

  async #spaceOf(
    itemId: string,
  ): Promise<{ spaceId: string; organizationId: string | null; confidential: boolean } | null> {
    const result = await this.#database.execute<{
      space_id: string;
      organization_id: string | null;
      confidential: boolean;
    }>(sql`
      select s.id as space_id, s.organization_id, s.confidential
      from tree_items t join spaces s on s.id = t.space_id where t.id = ${itemId}`);
    const row = result.rows[0];
    return row
      ? { spaceId: row.space_id, organizationId: row.organization_id, confidential: row.confidential }
      : null;
  }

  async invite(
    actor: Principal,
    itemId: string,
    input: { email: string; role: ShareRole; includeDescendants: boolean },
  ): Promise<Invitation> {
    const share = await this.#authorization.explain(actor, "item.share", { type: "item", id: itemId });
    if (!share.allowed) throw new ForbiddenError(share);
    const target = await this.#spaceOf(itemId);
    const organizationId = target?.organizationId ?? null;
    if (!target || !organizationId) {
      throw new SpaceError("invalidScope", "Guests can be invited to pages of an organization only");
    }
    if (target.confidential && !(await this.#isSpaceAdmin(actor, target.spaceId))) {
      throw new SpaceError(
        "confidentialGuestsBySpaceAdmins",
        "Only space administrators invite guests into a confidential space",
      );
    }
    if (!(await this.#organizationAllows(actor, organizationId))) {
      throw new SpaceError("guestInvitesDisabled", "Your organization does not let members invite guests");
    }
    if (input.includeDescendants) {
      await this.#pageAccess.requireReach(this.#database, actor, itemId, input.role, true);
    }
    return this.#invitations.create(
      actor,
      organizationId,
      { email: input.email, kind: "guest" },
      {
        within: async (tx, invitationId) => {
          const item = await tx.execute<{ space_id: string; title: string }>(
            sql`select space_id, title from tree_items where id = ${itemId}`,
          );
          await tx.execute(sql`
            insert into invitation_shares (invitation_id, item_id, role, include_descendants, shared_by)
            values (${invitationId}, ${itemId}, ${input.role}, ${input.includeDescendants},
              ${actor.type === "account" ? actor.id : null})`);
          await this.#audit.record(tx, {
            name: "page.guestInvited",
            actor,
            targetId: itemId,
            fields: {
              spaceId: item.rows[0]?.space_id ?? "",
              title: item.rows[0]?.title ?? "",
              invitationId,
              role: input.role,
              includeDescendants: input.includeDescendants,
            },
            scope: auditScopeOf({ organizationId }),
          });
        },
      },
    );
  }

  async #accepted(tx: Transaction, invitationId: string, accountId: string): Promise<void> {
    const shares = await tx.execute<{
      item_id: string;
      role: ShareRole;
      include_descendants: boolean;
      shared_by: string | null;
      space_id: string;
    }>(sql`
      select s.item_id, s.role, s.include_descendants, s.shared_by, t.space_id
      from invitation_shares s join tree_items t on t.id = s.item_id
      where s.invitation_id = ${invitationId} and t.trash_entry_id is null`);
    for (const share of shares.rows) {
      const sharer = share.shared_by ? accountPrincipal(share.shared_by) : null;
      const allowed =
        sharer !== null &&
        (
          await this.#authorization.explain(
            sharer,
            "item.share",
            { type: "item", id: share.item_id },
            { executor: tx, fresh: true },
          )
        ).allowed &&
        (!share.include_descendants || (await this.#reaches(tx, sharer, share.item_id, share.role))) &&
        (await this.#mayInviteInto(tx, sharer, share.space_id));
      if (allowed && sharer) {
        await this.#pageAccess.changeWithin(tx, sharer, share.item_id, [
          {
            action: "share",
            holderKind: "account",
            holderId: accountId,
            role: share.role,
            includeDescendants: share.include_descendants,
          },
        ]);
        continue;
      }
      await this.#hold(tx, accountId, share.space_id, share.item_id);
    }
  }

  async #mayInviteInto(tx: Transaction, sharer: Principal, spaceId: string): Promise<boolean> {
    const space = await tx.execute<{ confidential: boolean }>(
      sql`select confidential from spaces where id = ${spaceId}`,
    );
    if (!space.rows[0]?.confidential) return true;
    if (sharer.type !== "account") return false;
    return (
      (await this.#authorization.spaceRole(sharer.id, spaceId, { executor: tx, fresh: true })).role ===
      "admin"
    );
  }

  async #reaches(tx: Transaction, sharer: Principal, itemId: string, role: ShareRole): Promise<boolean> {
    const reach = await this.#pageAccess.reach(tx, sharer, itemId, role, true);
    return reach.page && reach.uncoveredBelow === 0;
  }

  async #hold(tx: Transaction, accountId: string, spaceId: string, itemId: string): Promise<void> {
    const id = uuidv7();
    const inserted = await tx.execute(sql`
      insert into access_requests (id, requester_id, space_id, item_id, message)
      values (${id}, ${accountId}, ${spaceId}, ${itemId}, '')
      on conflict do nothing returning id`);
    if (inserted.rows.length === 0) return;
    const details = await tx.execute<{
      requester: string;
      space_name: string;
      space_key: string;
      title: string;
      organization_id: string | null;
    }>(sql`
      select a.name as requester, ${spaceDisplayName(sql`s`)} as space_name, s.key as space_key, t.title, s.organization_id
      from accounts a cross join tree_items t join spaces s on s.id = t.space_id
      where a.id = ${accountId} and t.id = ${itemId}`);
    const row = details.rows[0];
    if (!row) return;
    await this.#notifications.notify(tx, {
      type: "access.requested",
      recipients: await this.#requests.deciders(tx, spaceId, itemId),
      actor: null,
      organizationId: row.organization_id,
      targetId: id,
      params: {
        requestId: id,
        target: "page",
        requesterName: row.requester,
        spaceId,
        spaceName: row.space_name,
        spaceKey: row.space_key,
        itemTitle: row.title,
        message: "",
      },
    });
  }
}
