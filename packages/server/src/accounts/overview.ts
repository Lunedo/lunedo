import { and, desc, eq, gt, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import { sessions } from "../auth/schema.js";
import { type SecondFactors, secondFactorsOf } from "../auth/two-factor.js";
import { organizationFacts } from "../authorization/facts.js";
import type { Database } from "../database/database.js";
import type { Page, PageRequest } from "../database/keyset.js";
import type { BuiltInRoleKey, MembershipKind } from "../organizations/access-schema.js";
import { organizationDomains } from "../organizations/schema.js";
import { apiTokens } from "../tokens/schema.js";
import type { Account, AccountService } from "./accounts.js";

export interface InstanceRoleSummary {
  builtInRole: BuiltInRoleKey | null;
  customRoleId: string | null;
  name: string | null;
}

export type AdministeredAccount = Omit<Account, "passwordHash"> & {
  lastSignInAt: Date | null;
  twoFactorActive: boolean;
  instanceRoles: InstanceRoleSummary[];
  organizations: { id: string; name: string; home: boolean }[];
};

export interface OrganizationOverview {
  owners: { id: string; name: string }[];
  memberCount: number;
  domains: string[];
}

export type RoleVia =
  | "account"
  | "group"
  | "organizationMembers"
  | "instanceUsers"
  | "membership"
  | "breakGlass";

export interface AccountMembership {
  organizationId: string;
  name: string;
  kind: MembershipKind;
  expiresAt: Date | null;
  home: boolean;
  roles: {
    assignmentId: string | null;
    builtInRole: BuiltInRoleKey | null;
    customRoleId: string | null;
    name: string | null;
    via: RoleVia;
    groupName: string | null;
    expiresAt: Date | null;
  }[];
}

export interface AccountDetail {
  account: AdministeredAccount;
  memberships: AccountMembership[];
  sessions: {
    id: string;
    kind: string;
    methods: string[];
    browser: string | null;
    operatingSystem: string | null;
    clientIp: string | null;
    createdAt: Date;
    lastUsedAt: Date;
  }[];
  tokens: {
    id: string;
    name: string;
    prefix: string;
    organizationId: string | null;
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    createdAt: Date;
  }[];
  twoFactor: SecondFactors;
}

function idList(ids: readonly string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

function date(value: Date | string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

export class AccountOverviewService {
  readonly #database: Database;
  readonly #accounts: AccountService;

  constructor(options: { database: Database; accounts: AccountService }) {
    this.#database = options.database;
    this.#accounts = options.accounts;
  }

  async listAccounts(
    page: PageRequest,
    filter: { withoutOrganization?: boolean; state?: Account["state"] } = {},
  ): Promise<Page<AdministeredAccount>> {
    const result = await this.#accounts.list(page, filter);
    const details = await this.#details(result.items.map((item) => item.id));
    return {
      next: result.next,
      items: result.items.map((item) => ({ ...item, ...this.#detailOf(details, item.id) })),
    };
  }

  #detailOf(
    details: Map<string, Omit<AdministeredAccount, keyof Omit<Account, "passwordHash">>>,
    id: string,
  ): Omit<AdministeredAccount, keyof Omit<Account, "passwordHash">> {
    return (
      details.get(id) ?? { lastSignInAt: null, twoFactorActive: false, instanceRoles: [], organizations: [] }
    );
  }

  async #details(
    ids: readonly string[],
  ): Promise<Map<string, Omit<AdministeredAccount, keyof Omit<Account, "passwordHash">>>> {
    const result = new Map<string, Omit<AdministeredAccount, keyof Omit<Account, "passwordHash">>>();
    if (ids.length === 0) return result;
    const list = idList(ids);
    const facts = await this.#database.execute<{
      id: string;
      last_sign_in_at: Date | string | null;
      two_factor: boolean;
    }>(sql`
      select a.id, a.last_sign_in_at,
        exists (select 1 from totp_credentials t where t.account_id = a.id and t.confirmed_at is not null)
          or exists (select 1 from webauthn_credentials w where w.account_id = a.id) as two_factor
      from accounts a where a.id in (${list})`);
    for (const row of facts.rows) {
      result.set(row.id, {
        lastSignInAt: date(row.last_sign_in_at),
        twoFactorActive: row.two_factor,
        instanceRoles: [],
        organizations: [],
      });
    }
    const roles = await this.#database.execute<{
      account_id: string;
      built_in_role: BuiltInRoleKey | null;
      custom_role_id: string | null;
      name: string | null;
    }>(sql`
      select owner_account_id as account_id, 'owner' as built_in_role, null::uuid as custom_role_id,
        null::text as name, 0 as position
      from instance where owner_account_id in (${list})
      union all
      select ra.principal_id, ra.built_in_role::text, ra.custom_role_id, cr.name, 1
      from role_assignments ra left join custom_roles cr on cr.id = ra.custom_role_id
      where ra.scope = 'instance' and ra.principal_kind = 'account' and ra.principal_id in (${list})
        and (ra.expires_at is null or ra.expires_at > now())
      order by position, name`);
    for (const row of roles.rows) {
      result.get(row.account_id)?.instanceRoles.push({
        builtInRole: row.built_in_role,
        customRoleId: row.custom_role_id,
        name: row.name,
      });
    }
    const organizations = await this.#database.execute<{
      account_id: string;
      id: string;
      name: string;
      home: boolean;
    }>(sql`
      select m.account_id, o.id, o.name, a.home_organization_id = o.id as home
      from memberships m
      join organizations o on o.id = m.organization_id
      join accounts a on a.id = m.account_id
      where m.account_id in (${list}) and (m.expires_at is null or m.expires_at > now())
      order by a.home_organization_id = o.id desc, lower(o.name), o.id`);
    for (const row of organizations.rows) {
      result.get(row.account_id)?.organizations.push({ id: row.id, name: row.name, home: row.home === true });
    }
    return result;
  }

  async describeOrganizations(ids: readonly string[]): Promise<Map<string, OrganizationOverview>> {
    const result = new Map<string, OrganizationOverview>(
      ids.map((id) => [id, { owners: [], memberCount: 0, domains: [] }]),
    );
    if (ids.length === 0) return result;
    const list = idList(ids);
    const owners = await this.#database.execute<{ organization_id: string; id: string; name: string }>(sql`
      select distinct ra.organization_id, a.id, a.name
      from role_assignments ra join accounts a on a.id = ra.principal_id
      where ra.organization_id in (${list}) and ra.principal_kind = 'account'
        and ra.built_in_role = 'owner' and a.state = 'active'
      order by a.name`);
    for (const row of owners.rows)
      result.get(row.organization_id)?.owners.push({ id: row.id, name: row.name });
    const counts = await this.#database.execute<{ organization_id: string; count: number }>(sql`
      select m.organization_id, count(*)::int as count
      from memberships m join accounts a on a.id = m.account_id
      where m.organization_id in (${list}) and a.state = 'active'
        and (m.expires_at is null or m.expires_at > now())
      group by m.organization_id`);
    for (const row of counts.rows) {
      const entry = result.get(row.organization_id);
      if (entry) entry.memberCount = row.count;
    }
    const domains = await this.#database
      .select({ organizationId: organizationDomains.organizationId, domain: organizationDomains.domain })
      .from(organizationDomains)
      .where(inArray(organizationDomains.organizationId, [...ids]))
      .orderBy(organizationDomains.domain);
    for (const row of domains) result.get(row.organizationId)?.domains.push(row.domain);
    return result;
  }

  async accountDetail(accountId: string): Promise<AccountDetail | null> {
    const account = await this.#accounts.get(accountId);
    if (!account) return null;
    const { passwordHash: _passwordHash, ...visible } = account;
    const details = await this.#details([accountId]);
    const memberships = await this.#database.execute<{
      organization_id: string;
      name: string;
      kind: MembershipKind;
      expires_at: Date | string | null;
    }>(sql`
      select m.organization_id, o.name, m.kind, m.expires_at
      from memberships m join organizations o on o.id = m.organization_id
      where m.account_id = ${accountId} and (m.expires_at is null or m.expires_at > now())
      order by lower(o.name), o.id`);
    const detailed: AccountMembership[] = [];
    for (const membership of memberships.rows) {
      const facts = await organizationFacts(this.#database, accountId, membership.organization_id, {
        fresh: true,
      });
      detailed.push({
        organizationId: membership.organization_id,
        name: membership.name,
        kind: membership.kind,
        expiresAt: date(membership.expires_at),
        home: account.homeOrganizationId === membership.organization_id,
        roles: facts.roles.map((role) => ({
          assignmentId: role.assignmentId,
          builtInRole: "builtIn" in role.role ? role.role.builtIn : null,
          customRoleId: "customRoleId" in role.role ? role.role.customRoleId : null,
          name: "name" in role.role ? role.role.name : null,
          via: role.via.type === "instanceOwner" ? "account" : role.via.type,
          groupName: role.via.type === "group" ? role.via.name : null,
          expiresAt: role.expiresAt,
        })),
      });
    }
    const activeSessions = await this.#database
      .select({
        id: sessions.id,
        kind: sessions.kind,
        methods: sessions.methods,
        browser: sessions.browser,
        operatingSystem: sessions.operatingSystem,
        clientIp: sessions.clientIp,
        createdAt: sessions.createdAt,
        lastUsedAt: sessions.lastUsedAt,
      })
      .from(sessions)
      .where(eq(sessions.accountId, accountId))
      .orderBy(desc(sessions.lastUsedAt));
    const tokens = await this.#database
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        prefix: apiTokens.tokenPrefix,
        organizationId: apiTokens.organizationId,
        expiresAt: apiTokens.expiresAt,
        lastUsedAt: apiTokens.lastUsedAt,
        createdAt: apiTokens.createdAt,
      })
      .from(apiTokens)
      .where(
        and(
          eq(apiTokens.accountId, accountId),
          isNull(apiTokens.revokedAt),
          or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date())),
        ),
      )
      .orderBy(apiTokens.name);
    return {
      account: { ...visible, ...this.#detailOf(details, accountId) },
      memberships: detailed,
      sessions: activeSessions,
      tokens,
      twoFactor: await secondFactorsOf(this.#database, accountId),
    };
  }
}
