import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Database } from "../database/database.js";
import type { Invitation, InvitationService } from "../organizations/invitations.js";
import type { MembershipService } from "../organizations/memberships.js";
import { auditScopeOf, SpaceError } from "../spaces/common.js";
import type { SpaceService } from "../spaces/spaces.js";

export interface PortalAccount {
  id: string;
  name: string;
  email: string;
  state: "active" | "deactivated";
  expiresAt: Date | null;
  createdAt: Date;
  lastSignInAt: Date | null;
  otherOrganizations: boolean;
}

export interface PortalInvitation {
  id: string;
  email: string;
  membershipExpiresAt: Date | null;
  expiresAt: Date;
  invitedByName: string | null;
}

export interface PortalAccounts {
  accounts: PortalAccount[];
  invitations: PortalInvitation[];
}

const LISTED = 500;

export class PortalAccountService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #spaces: SpaceService;
  readonly #invitations: InvitationService;
  readonly #memberships: MembershipService;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    spaces: SpaceService;
    invitations: InvitationService;
    memberships: MembershipService;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#spaces = options.spaces;
    this.#invitations = options.invitations;
    this.#memberships = options.memberships;
  }

  async #knowledgeBase(spaceId: string) {
    const space = await this.#spaces.require(spaceId);
    if (space.type !== "knowledgeBase" || !space.organizationId) {
      throw new SpaceError("notKnowledgeBase", "The space is not a knowledge base");
    }
    return { ...space, organizationId: space.organizationId };
  }

  async list(spaceId: string): Promise<PortalAccounts> {
    const space = await this.#knowledgeBase(spaceId);
    const accounts = await this.#database.execute<{
      id: string;
      name: string;
      email: string | null;
      state: "active" | "deactivated";
      expires_at: Date | string | null;
      created_at: Date | string;
      last_sign_in_at: Date | string | null;
      other_organizations: boolean;
    }>(sql`
      select a.id, a.name, a.email, a.state, m.expires_at, a.created_at,
        (select max(s.created_at) from sessions s where s.account_id = a.id) as last_sign_in_at,
        exists (select 1 from memberships o where o.account_id = a.id
          and o.organization_id <> ${space.organizationId}) as other_organizations
      from accounts a join memberships m on m.account_id = a.id and m.organization_id = ${space.organizationId}
      where a.type = 'portal' and a.state in ('active', 'deactivated')
      order by lower(a.name), a.id
      limit ${LISTED}`);
    const invitations = await this.#database.execute<{
      id: string;
      email: string;
      membership_expires_at: Date | string | null;
      expires_at: Date | string;
      invited_by_name: string | null;
    }>(sql`
      select i.id, i.email, i.membership_expires_at, i.expires_at, inviter.name as invited_by_name
      from portal_invitations pi join invitations i on i.id = pi.invitation_id
      left join accounts inviter on inviter.id = i.invited_by
      where pi.space_id = ${spaceId} and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
      order by lower(i.email), i.id
      limit ${LISTED}`);
    const date = (value: Date | string | null) => (value ? new Date(value) : null);
    return {
      accounts: accounts.rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email ?? "",
        state: row.state,
        expiresAt: date(row.expires_at),
        createdAt: new Date(row.created_at),
        lastSignInAt: date(row.last_sign_in_at),
        otherOrganizations: row.other_organizations,
      })),
      invitations: invitations.rows.map((row) => ({
        id: row.id,
        email: row.email,
        membershipExpiresAt: date(row.membership_expires_at),
        expiresAt: new Date(row.expires_at),
        invitedByName: row.invited_by_name,
      })),
    };
  }

  async invite(
    actor: Principal,
    spaceId: string,
    input: { email: string; expiresAt: Date | null },
  ): Promise<Invitation> {
    const space = await this.#knowledgeBase(spaceId);
    if (space.audience !== "portal") {
      throw new SpaceError(
        "portalAudienceRequired",
        "Portal accounts read only knowledge bases whose audience is portal accounts. Change the audience under Visibility first.",
      );
    }
    return this.#invitations.create(
      actor,
      space.organizationId,
      {
        email: input.email,
        kind: "guest",
        membershipExpiresAt: input.expiresAt,
        ...(actor.type === "account" ? { responsibleAccountId: actor.id } : {}),
      },
      {
        portal: { spaceId, name: space.name },
        within: async (tx, invitationId) => {
          await this.#audit.record(tx, {
            name: "portalAccount.invited",
            actor,
            targetId: invitationId,
            fields: {
              email: input.email.trim(),
              spaceId,
              spaceName: space.name,
              membershipExpiresAt: input.expiresAt?.toISOString() ?? null,
            },
            scope: auditScopeOf(space),
          });
        },
      },
    );
  }

  async revokeInvitation(actor: Principal, spaceId: string, invitationId: string): Promise<void> {
    const space = await this.#knowledgeBase(spaceId);
    const found = await this.#database.execute<{ found: boolean }>(sql`
      select exists (select 1 from portal_invitations where invitation_id = ${invitationId}
        and space_id = ${spaceId}) as found`);
    if (!found.rows[0]?.found) throw new SpaceError("invitationNotFound", "The invitation does not exist");
    await this.#invitations.revoke(actor, space.organizationId, invitationId);
  }

  async #requirePortalAccount(organizationId: string, accountId: string) {
    const found = await this.#database.execute<{ other_organizations: boolean }>(sql`
      select exists (select 1 from memberships o where o.account_id = a.id
          and o.organization_id <> ${organizationId}) as other_organizations
      from accounts a join memberships m on m.account_id = a.id and m.organization_id = ${organizationId}
      where a.id = ${accountId} and a.type = 'portal'`);
    const row = found.rows[0];
    if (!row) throw new SpaceError("portalAccountNotFound", "The portal account does not exist");
    return { otherOrganizations: row.other_organizations };
  }

  async deactivate(actor: Principal, spaceId: string, accountId: string): Promise<void> {
    const space = await this.#knowledgeBase(spaceId);
    const account = await this.#requirePortalAccount(space.organizationId, accountId);
    if (account.otherOrganizations) {
      throw new SpaceError(
        "portalAccountShared",
        "The account also reads knowledge bases of other organizations. Remove it from this organization instead.",
      );
    }
    await this.#memberships.deactivate(actor, accountId);
  }

  async portalsOf(
    accountId: string,
  ): Promise<{ spaceId: string; name: string; path: string; domain: string | null }[]> {
    const result = await this.#database.execute<{
      space_id: string;
      name: string;
      portal_path: string;
      portal_domain: string | null;
    }>(sql`
      select s.id as space_id, s.name, kb.portal_path, kb.portal_domain
      from spaces s join knowledge_bases kb on kb.space_id = s.id
      join memberships m on m.organization_id = s.organization_id and m.account_id = ${accountId}
        and (m.expires_at is null or m.expires_at > now())
      where s.type = 'knowledgeBase' and s.audience = 'portal' and s.deleted_at is null and s.archived_at is null
      order by lower(s.name), s.id
      limit ${LISTED}`);
    return result.rows.map((row) => ({
      spaceId: row.space_id,
      name: row.name,
      path: row.portal_path,
      domain: row.portal_domain,
    }));
  }

  async remove(actor: Principal, spaceId: string, accountId: string): Promise<void> {
    const space = await this.#knowledgeBase(spaceId);
    await this.#requirePortalAccount(space.organizationId, accountId);
    await this.#memberships.remove(actor, space.organizationId, accountId, "removed");
  }
}
