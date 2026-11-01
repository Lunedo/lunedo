import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import { twoFactorRequiredSetting } from "../auth/settings.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import type { SettingsService } from "../settings/service.js";
import { spaceRoleRank } from "../spaces/roles.js";
import type { SpaceRole } from "../spaces/schema.js";
import type { Member, MembershipService } from "./memberships.js";
import { organizationSettingsChain } from "./settings.js";

export interface ProviderReference {
  providerId: string;
  providerName: string;
}

export interface MemberGroup {
  id: string;
  name: string;
  managedBy: ProviderReference | null;
  viaProvider: ProviderReference | null;
  spaces: number;
}

export type MemberSpaceSource =
  | { kind: "direct" }
  | { kind: "group"; groupId: string; groupName: string }
  | { kind: "organizationMembers" };

export interface MemberSpace {
  id: string;
  key: string;
  name: string;
  role: SpaceRole;
  sources: MemberSpaceSource[];
}

export interface MemberDetails extends Member {
  joinedAt: Date;
  invitedBy: { id: string; name: string } | null;
  homeOrganization: boolean;
  twoFactorRequired: boolean;
  signIn: { password: boolean; providers: ProviderReference[] };
  groupDetails: MemberGroup[];
  spaces: MemberSpace[] | null;
}

export class MemberDetailService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #settings: SettingsService;
  readonly #memberships: MembershipService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    settings: SettingsService;
    memberships: MembershipService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#settings = options.settings;
    this.#memberships = options.memberships;
  }

  async details(viewer: Principal, organizationId: string, accountId: string): Promise<MemberDetails | null> {
    const member = await this.#memberships.member(organizationId, accountId);
    if (!member) return null;
    const membership = await this.#database.execute<{
      created_at: Date | string;
      created_by: string | null;
      inviter_name: string | null;
      home: boolean;
      password: boolean;
    }>(sql`
      select m.created_at, m.created_by, i.name as inviter_name,
        (a.home_organization_id is not distinct from m.organization_id) as home,
        (a.password_hash is not null) as password
      from memberships m join accounts a on a.id = m.account_id
      left join accounts i on i.id = m.created_by
      where m.organization_id = ${organizationId} and m.account_id = ${accountId}`);
    const row = membership.rows[0];
    if (!row) return null;
    const providers = await this.#database.execute<{ id: string; name: string }>(sql`
      select distinct p.id, p.name from identities i join identity_providers p on p.id = i.provider_id
      where i.account_id = ${accountId} order by p.name, p.id`);
    const groups = await this.#database.execute<{
      id: string;
      name: string;
      managed_id: string | null;
      managed_name: string | null;
      via_id: string | null;
      via_name: string | null;
      spaces: string;
    }>(sql`
      select g.id, g.name, mp.id as managed_id, mp.name as managed_name, vp.id as via_id, vp.name as via_name,
        (select count(distinct sp.space_id) from space_permissions sp join spaces s on s.id = sp.space_id
          where sp.principal_kind = 'group' and sp.principal_id = g.id and s.deleted_at is null) as spaces
      from group_members gm join groups g on g.id = gm.group_id
      left join managed_groups mg on mg.group_id = g.id
      left join identity_providers mp on mp.id = mg.provider_id
      left join lateral (
        select p.id, p.name from provider_grants pg
        join mapping_rules r on r.lunedo_group_id = pg.group_id
        join identity_providers p on p.id = r.provider_id
        join identities i on i.provider_id = p.id and i.account_id = pg.account_id
        where pg.account_id = gm.account_id and pg.kind = 'groupMember' and pg.group_id = g.id
        order by p.name, p.id limit 1) vp on true
      where gm.account_id = ${accountId} and g.organization_id = ${organizationId}
        and (gm.expires_at is null or gm.expires_at > now())
      order by lower(g.name), g.id`);
    const spacesVisible = await this.#authorization.authorize(viewer, "organization.spaces.view", {
      type: "organization",
      id: organizationId,
    });
    return {
      ...member,
      joinedAt: new Date(row.created_at),
      invitedBy: row.created_by && row.inviter_name ? { id: row.created_by, name: row.inviter_name } : null,
      homeOrganization: row.home,
      twoFactorRequired: await this.#settings.get(
        twoFactorRequiredSetting,
        organizationSettingsChain(organizationId),
      ),
      signIn: {
        password: row.password,
        providers: providers.rows.map((provider) => ({
          providerId: provider.id,
          providerName: provider.name,
        })),
      },
      groupDetails: groups.rows.map((group) => ({
        id: group.id,
        name: group.name,
        managedBy: group.managed_id
          ? { providerId: group.managed_id, providerName: group.managed_name ?? "" }
          : null,
        viaProvider:
          !group.managed_id && group.via_id
            ? { providerId: group.via_id, providerName: group.via_name ?? "" }
            : null,
        spaces: Number(group.spaces),
      })),
      spaces: spacesVisible ? await this.#spaces(organizationId, accountId) : null,
    };
  }

  async #spaces(organizationId: string, accountId: string): Promise<MemberSpace[]> {
    const result = await this.#database.execute<{
      id: string;
      key: string;
      name: string;
      role: SpaceRole;
      principal_kind: string;
      group_id: string | null;
      group_name: string | null;
    }>(sql`
      select s.id, s.key, s.name, sp.role::text as role, sp.principal_kind::text as principal_kind,
        g.id as group_id, g.name as group_name
      from space_permissions sp join spaces s on s.id = sp.space_id
      left join groups g on sp.principal_kind = 'group' and g.id = sp.principal_id
      where s.organization_id = ${organizationId} and s.deleted_at is null
        and s.personal_of is null and not s.confidential
        and (
          (sp.principal_kind = 'account' and sp.principal_id = ${accountId})
          or (sp.principal_kind = 'group' and exists (select 1 from group_members gm
            where gm.group_id = sp.principal_id and gm.account_id = ${accountId}
              and (gm.expires_at is null or gm.expires_at > now())))
          or (sp.principal_kind = 'organizationMembers' and exists (select 1 from memberships m
            where m.organization_id = s.organization_id and m.account_id = ${accountId} and m.kind = 'member'
              and (m.expires_at is null or m.expires_at > now()))))
      order by lower(s.name), s.id`);
    const spaces = new Map<string, MemberSpace>();
    for (const row of result.rows) {
      const source: MemberSpaceSource =
        row.principal_kind === "account"
          ? { kind: "direct" }
          : row.principal_kind === "group" && row.group_id
            ? { kind: "group", groupId: row.group_id, groupName: row.group_name ?? "" }
            : { kind: "organizationMembers" };
      const known = spaces.get(row.id);
      if (!known) {
        spaces.set(row.id, { id: row.id, key: row.key, name: row.name, role: row.role, sources: [source] });
        continue;
      }
      known.sources.push(source);
      if (spaceRoleRank(row.role) > spaceRoleRank(known.role)) known.role = row.role;
    }
    return [...spaces.values()];
  }
}
