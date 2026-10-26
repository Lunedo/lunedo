import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import { holderCovers, restrictionListedBy } from "../authorization/item-access.js";
import type { AuthorizationService, Decision, Grant } from "../authorization/service.js";
import { organizationMembership } from "../authorization/space-access.js";
import type { Database, Executor } from "../database/database.js";
import { SpaceError } from "../spaces/common.js";
import { spaceDisplayName } from "../spaces/display-name.js";
import type { PeopleService } from "../spaces/people.js";
import { highestSpaceRole } from "../spaces/roles.js";
import type { SpaceRole } from "../spaces/schema.js";
import type { HolderKind } from "./page-access.js";

export type InactiveReason = "membershipEnded";

export type AccessReason = (
  | { type: "spaceRole"; role: SpaceRole; via: SpaceReasonVia }
  | {
      type: "share";
      role: SpaceRole;
      via: { type: "account" } | { type: "group"; groupId: string; name: string };
      itemId: string;
      itemTitle: string | null;
      inherited: boolean;
    }
  | { type: "link"; linkId: string; scope: string }
) & { inactive?: InactiveReason };

export type SpaceReasonVia =
  | { type: "account" }
  | { type: "group"; groupId: string; name: string }
  | { type: "organizationMembers" }
  | { type: "instanceUsers" }
  | { type: "visibility"; visibility: string };

export interface AccessExplanation {
  accountId: string;
  name: string | null;
  role: SpaceRole | null;
  reasons: AccessReason[];
  denial: "restricted" | "editRestricted" | "unpublished" | "inTrash" | "accountInactive" | "noAccess" | null;
  restrictions: { itemId: string; title: string | null; listed: boolean }[];
  editRestricted: { listed: boolean } | null;
  published: boolean;
}

export interface PersonAccessEntry {
  kind: "space" | "share" | "link" | "restrictedPages";
  spaceId: string;
  spaceName: string;
  spaceKey: string;
  itemId: string | null;
  itemTitle: string | null;
  role: SpaceRole | null;
  count: number;
  reasons: AccessReason[];
  inactive: InactiveReason | null;
}

export interface PersonAccess {
  accountId: string;
  name: string | null;
  email: string | null;
  entries: PersonAccessEntry[];
  confidentialSpaceCount: number;
}

export type GiveAccessLevel = "reader" | "commenter" | "editor" | "admin";
export type GiveAccessScope = "space" | "page" | "pageAndChildren";

export interface GiveAccessEffect {
  pages: number;
  readable: number;
  editable: number;
  restricted: number;
  alreadyHas: SpaceRole | null;
}

const ROLE_RANK: Record<SpaceRole, number> = { reader: 1, commenter: 2, editor: 3, admin: 4 };

function grantReason(grant: Grant, titles: Map<string, string | null>): AccessReason | null {
  if (grant.kind === "spaceRole") return { type: "spaceRole", role: grant.role, via: grant.via };
  if (grant.kind === "share") {
    return {
      type: "share",
      role: grant.role,
      via: grant.via,
      itemId: grant.itemId,
      itemTitle: titles.get(grant.itemId) ?? null,
      inherited: grant.inherited,
    };
  }
  if (grant.kind === "link") return { type: "link", linkId: grant.linkId, scope: grant.scope };
  return null;
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const OVERVIEW_BATCH = 500;
const OVERVIEW_COLUMNS = ["person", "email", "kind", "space", "page", "role", "pages", "reason"];

interface SpaceRoleRow {
  account_id: string;
  space_id: string;
  role: SpaceRole;
  via: "account" | "group" | "organizationMembers" | "instanceUsers" | "organization" | "instance";
  group_id: string | null;
  group_name: string | null;
  active: boolean;
  [key: string]: unknown;
}

interface ShareRow {
  account_id: string;
  space_id: string;
  space_name: string;
  space_key: string;
  item_id: string;
  title: string;
  readable: boolean;
  role: SpaceRole;
  principal_kind: HolderKind;
  principal_id: string;
  group_name: string | null;
  include_descendants: boolean;
  active: boolean;
  [key: string]: unknown;
}

interface LinkRow {
  account_id: string;
  space_id: string;
  space_name: string;
  space_key: string;
  item_id: string;
  title: string;
  readable: boolean;
  link_id: string;
  scope: string;
  active: boolean;
  [key: string]: unknown;
}

function byAccount<T extends { account_id: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.account_id);
    if (list) list.push(row);
    else grouped.set(row.account_id, [row]);
  }
  return grouped;
}

function spaceReasonVia(row: SpaceRoleRow): SpaceReasonVia {
  switch (row.via) {
    case "group":
      return { type: "group", groupId: row.group_id ?? "", name: row.group_name ?? "" };
    case "organization":
    case "instance":
      return { type: "visibility", visibility: row.via };
    default:
      return { type: row.via };
  }
}

function spaceEntries(
  spaces: { id: string; name: string; key: string }[],
  rows: SpaceRoleRow[],
): PersonAccessEntry[] {
  const bySpace = new Map<string, SpaceRoleRow[]>();
  for (const row of rows) {
    const list = bySpace.get(row.space_id);
    if (list) list.push(row);
    else bySpace.set(row.space_id, [row]);
  }
  return spaces.flatMap((space) => {
    const held = bySpace.get(space.id) ?? [];
    const active = held.filter((row) => row.active);
    const inactive = held.filter((row) => !row.active);
    if (held.length === 0) return [];
    const role = highestSpaceRole(active.map((row) => row.role));
    return [
      {
        kind: "space" as const,
        spaceId: space.id,
        spaceName: space.name,
        spaceKey: space.key,
        itemId: null,
        itemTitle: null,
        role: role ?? highestSpaceRole(inactive.map((row) => row.role)),
        count: 1,
        reasons: [
          ...active.map(
            (row): AccessReason => ({ type: "spaceRole", role: row.role, via: spaceReasonVia(row) }),
          ),
          ...inactive.map(
            (row): AccessReason => ({
              type: "spaceRole",
              role: row.role,
              via: spaceReasonVia(row),
              inactive: "membershipEnded",
            }),
          ),
        ],
        inactive: role ? null : ("membershipEnded" as const),
      },
    ];
  });
}

function pageEntries(shares: ShareRow[], links: LinkRow[]): PersonAccessEntry[] {
  const entries: PersonAccessEntry[] = [];
  const hidden = new Map<string, PersonAccessEntry>();
  const countHidden = (row: { space_id: string; space_name: string; space_key: string }) => {
    const summary = hidden.get(row.space_id) ?? {
      kind: "restrictedPages" as const,
      spaceId: row.space_id,
      spaceName: row.space_name,
      spaceKey: row.space_key,
      itemId: null,
      itemTitle: null,
      role: null,
      count: 0,
      reasons: [],
      inactive: null,
    };
    summary.count += 1;
    hidden.set(row.space_id, summary);
  };
  for (const row of shares) {
    if (!row.readable) {
      countHidden(row);
      continue;
    }
    entries.push({
      kind: "share",
      spaceId: row.space_id,
      spaceName: row.space_name,
      spaceKey: row.space_key,
      itemId: row.item_id,
      itemTitle: row.title,
      role: row.role,
      count: row.include_descendants ? 2 : 1,
      reasons: [
        {
          type: "share",
          role: row.role,
          via:
            row.principal_kind === "group"
              ? { type: "group", groupId: row.principal_id, name: row.group_name ?? "" }
              : { type: "account" },
          itemId: row.item_id,
          itemTitle: row.title,
          inherited: false,
          ...(row.active ? {} : { inactive: "membershipEnded" as const }),
        },
      ],
      inactive: row.active ? null : "membershipEnded",
    });
  }
  for (const row of links) {
    if (!row.readable) {
      countHidden(row);
      continue;
    }
    entries.push({
      kind: "link",
      spaceId: row.space_id,
      spaceName: row.space_name,
      spaceKey: row.space_key,
      itemId: row.item_id,
      itemTitle: row.title,
      role: "reader",
      count: 1,
      reasons: [
        {
          type: "link",
          linkId: row.link_id,
          scope: row.scope,
          ...(row.active ? {} : { inactive: "membershipEnded" as const }),
        },
      ],
      inactive: row.active ? null : "membershipEnded",
    });
  }
  return [...entries, ...hidden.values()];
}

function overviewLines(access: PersonAccess): string {
  const rows = access.entries.map((entry) => [
    access.name,
    access.email,
    entry.kind,
    entry.spaceName,
    entry.itemTitle,
    entry.role,
    entry.count,
    entry.reasons.map((reason) => describeReason(reason)).join("; "),
  ]);
  if (access.confidentialSpaceCount > 0) {
    rows.push([
      access.name,
      access.email,
      "confidentialSpaces",
      "",
      "",
      "",
      access.confidentialSpaceCount,
      "",
    ]);
  }
  return rows.map((row) => `${row.map(csvCell).join(",")}\r\n`).join("");
}

export class AccessExplanationService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #people: PeopleService;
  readonly #audit: AuditLog;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    people: PeopleService;
    audit: AuditLog;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#people = options.people;
    this.#audit = options.audit;
  }

  async #titles(viewer: Principal, itemIds: string[]): Promise<Map<string, string | null>> {
    if (itemIds.length === 0) return new Map();
    const result = await this.#database.execute<{ id: string; title: string; visible: boolean }>(sql`
      select t.id, t.title, ${this.#authorization.itemFilter(viewer, sql`t`, sql`s`)} as visible
      from tree_items t join spaces s on s.id = t.space_id where t.id = any(${sql.param([...new Set(itemIds)])}::uuid[])`);
    return new Map(result.rows.map((row) => [row.id, row.visible ? row.title : null]));
  }

  async #roleDecisions(
    accountId: string,
    resource: { type: "space" | "item"; id: string },
  ): Promise<Decision[]> {
    const principal = { type: "account" as const, id: accountId };
    const actions =
      resource.type === "space"
        ? ["space.manage", "space.edit", "space.view"]
        : ["item.edit", "item.comment", "item.view"];
    const decisions: Decision[] = [];
    for (const action of actions) {
      decisions.push(await this.#authorization.explain(principal, action, resource, { fresh: true }));
    }
    return decisions;
  }

  async explainAccess(
    viewer: Principal,
    resource: { type: "space" | "item"; id: string },
    accountId: string,
  ): Promise<AccessExplanation> {
    const account = await this.#database.execute<{ id: string; name: string | null; state: string }>(sql`
      select a.id, ${this.#people.visibleName(viewer, sql`a`)} as name, a.state::text as state
      from accounts a where a.id = ${accountId}`);
    const person = account.rows[0];
    const own = viewer.type === "account" && viewer.id === accountId;
    if (!person || (!own && !(await this.#people.canSee(viewer, accountId)))) {
      throw new SpaceError("personNotFound", "The person does not exist");
    }
    const decisions = await this.#roleDecisions(accountId, resource);
    const [top, middle, base] = decisions;
    const role: SpaceRole | null =
      resource.type === "space"
        ? top?.allowed
          ? "admin"
          : middle?.allowed
            ? "editor"
            : base?.allowed
              ? "reader"
              : null
        : top?.allowed
          ? "editor"
          : middle?.allowed
            ? "commenter"
            : base?.allowed
              ? "reader"
              : null;
    const grants = decisions.flatMap((decision) => decision.grants);
    const itemFacts =
      resource.type === "item"
        ? await this.#authorization.itemFacts(accountId, resource.id, { fresh: true })
        : null;
    const spaceId = resource.type === "space" ? resource.id : await this.#spaceOf(resource.id);
    const spaceFacts = spaceId
      ? await this.#authorization.spaceRole(accountId, spaceId, { fresh: true })
      : null;
    const titles = await this.#titles(viewer, [
      ...grants.flatMap((grant) => (grant.kind === "share" ? [grant.itemId] : [])),
      ...(itemFacts?.viewRestrictions.map((restriction) => restriction.itemId) ?? []),
      ...(itemFacts?.inactiveSources.flatMap((source) => (source.type === "share" ? [source.itemId] : [])) ??
        []),
    ]);
    const seen = new Set<string>();
    const reasons: AccessReason[] = [];
    for (const grant of grants) {
      const reason = grantReason(grant, titles);
      if (!reason) continue;
      const key = JSON.stringify(reason);
      if (seen.has(key)) continue;
      seen.add(key);
      reasons.push(reason);
    }
    if (role === null && base) {
      const facts = resource.type === "space" ? null : spaceFacts;
      for (const source of facts?.sources ?? []) {
        const key = JSON.stringify(source);
        if (seen.has(key)) continue;
        seen.add(key);
        reasons.push({ type: "spaceRole", role: source.role, via: source.via });
      }
      for (const source of itemFacts?.sources ?? []) {
        if (source.type === "share") {
          reasons.push({
            type: "share",
            role: source.role,
            via: source.via,
            itemId: source.itemId,
            itemTitle: titles.get(source.itemId) ?? null,
            inherited: source.inherited,
          });
        } else {
          reasons.push({ type: "link", linkId: source.linkId, scope: source.scope });
        }
      }
    }
    for (const source of spaceFacts?.inactiveSources ?? []) {
      reasons.push({ type: "spaceRole", role: source.role, via: source.via, inactive: "membershipEnded" });
    }
    for (const source of itemFacts?.inactiveSources ?? []) {
      if (source.type !== "share") continue;
      reasons.push({
        type: "share",
        role: source.role,
        via: source.via,
        itemId: source.itemId,
        itemTitle: titles.get(source.itemId) ?? null,
        inherited: source.inherited,
        inactive: "membershipEnded",
      });
    }
    const denials = base?.denials ?? [];
    const denial: AccessExplanation["denial"] =
      role !== null
        ? top?.denials.includes("editRestricted") || middle?.denials.includes("editRestricted")
          ? "editRestricted"
          : null
        : denials.includes("restricted")
          ? "restricted"
          : denials.includes("unpublished")
            ? "unpublished"
            : denials.includes("inTrash")
              ? "inTrash"
              : denials.includes("accountInactive")
                ? "accountInactive"
                : "noAccess";
    const published =
      resource.type === "space"
        ? true
        : (
            await this.#database.execute<{ visible: boolean }>(
              sql`select reader_visible as visible from tree_items where id = ${resource.id}`,
            )
          ).rows[0]?.visible === true;
    return {
      accountId,
      name: person.name,
      role,
      reasons,
      denial,
      restrictions:
        itemFacts?.viewRestrictions.map((restriction) => ({
          itemId: restriction.itemId,
          title: titles.get(restriction.itemId) ?? null,
          listed: restriction.listed,
        })) ?? [],
      editRestricted: itemFacts?.editRestriction ?? null,
      published,
    };
  }

  async #spaceOf(itemId: string): Promise<string | null> {
    const result = await this.#database.execute<{ space_id: string }>(
      sql`select space_id from tree_items where id = ${itemId}`,
    );
    return result.rows[0]?.space_id ?? null;
  }

  #spaceScope(organizationId: string | null): SQL {
    return organizationId ? sql`s.organization_id = ${organizationId}` : sql`true`;
  }

  async personAccess(
    viewer: Principal,
    accountId: string,
    options: { organizationId: string | null; spaceIds?: string[] | undefined },
  ): Promise<PersonAccess> {
    const [access] = await this.#accessOf(viewer, [accountId], options);
    if (!access) throw new SpaceError("personNotFound", "The person does not exist");
    return access;
  }

  async #accessOf(
    viewer: Principal,
    accountIds: readonly string[],
    options: { organizationId: string | null; spaceIds?: string[] | undefined },
  ): Promise<PersonAccess[]> {
    const ids = () => sql`${sql.param([...accountIds])}::uuid[]`;
    const people = await this.#database.execute<{
      id: string;
      name: string | null;
      email: string | null;
    }>(sql`
      select a.id, ${this.#people.visibleName(viewer, sql`a`)} as name,
        case when ${this.#people.colleagueCondition(viewer, sql`a.id`)} then a.email end as email
      from accounts a
      where a.id = any(${ids()}) and a.state in ('active', 'invited')
        and ${this.#people.visibleCondition(viewer, sql`a.id`)}`);
    if (people.rows.length === 0) return [];
    const limit = options.spaceIds ? sql`s.id = any(${sql.param(options.spaceIds)}::uuid[])` : sql`true`;
    const base = sql`${this.#spaceScope(options.organizationId)} and ${limit} and s.deleted_at is null and s.personal_of is null
      and (not s.quarantined or ${this.#authorization.spaceFilter(viewer, sql`s`)})`;
    const scope = sql`${base} and (not s.confidential or ${this.#authorization.spaceFilter(viewer, sql`s`)})`;
    const confidential = await this.#database.execute<{ account_id: string; count: string }>(sql`
      select sp.principal_id as account_id, count(distinct s.id) as count
      from spaces s join space_permissions sp on sp.space_id = s.id
      where ${base} and s.confidential and not ${this.#authorization.spaceFilter(viewer, sql`s`)}
        and sp.principal_kind = 'account' and sp.principal_id = any(${ids()})
      group by sp.principal_id`);
    const spaces = await this.#database.execute<{ id: string; name: string; key: string }>(sql`
      select s.id, s.name, s.key from spaces s where ${scope} order by lower(s.name), s.id limit 2000`);
    const roles = await this.#database.execute<SpaceRoleRow>(sql`
      with acc as (select a.id, a.type from accounts a where a.id = any(${ids()}) and a.state = 'active'),
      sc as (select s.id, s.organization_id, s.visibility from spaces s
        where s.id = any(${sql.param(spaces.rows.map((space) => space.id))}::uuid[])),
      member as (select m.account_id, m.organization_id from memberships m join acc on acc.id = m.account_id
        where m.kind = 'member' and (m.expires_at is null or m.expires_at > now())),
      held as (
        select acc.id as account_id, sc.id as space_id, sp.id as permission_id, sp.role::text as role,
          'account' as via, null::uuid as group_id,
          ${organizationMembership(sql`sc.organization_id`, sql`acc.id`)} as active
        from acc join space_permissions sp on sp.principal_kind = 'account' and sp.principal_id = acc.id
        join sc on sc.id = sp.space_id
        union all
        select acc.id, sc.id, sp.id, sp.role::text, 'group', sp.principal_id, true
        from acc join group_members gm on gm.account_id = acc.id and (gm.expires_at is null or gm.expires_at > now())
        join space_permissions sp on sp.principal_kind = 'group' and sp.principal_id = gm.group_id
        join sc on sc.id = sp.space_id
        union all
        select member.account_id, sc.id, sp.id, sp.role::text, 'organizationMembers', null, true
        from member join sc on sc.organization_id = member.organization_id
        join space_permissions sp on sp.space_id = sc.id and sp.principal_kind = 'organizationMembers'
        union all
        select acc.id, sc.id, sp.id, sp.role::text, 'instanceUsers', null, true
        from acc join space_permissions sp on sp.principal_kind = 'instanceUsers'
        join sc on sc.id = sp.space_id
        where acc.type = 'standard'
        union all
        select member.account_id, sc.id, null, 'reader', 'organization', null, true
        from member join sc on sc.organization_id = member.organization_id and sc.visibility = 'organization'
        union all
        select acc.id, sc.id, null, 'reader', 'instance', null, true
        from acc join sc on sc.visibility = 'instance'
        where acc.type = 'standard'
      )
      select h.account_id, h.space_id, h.role, h.via, h.group_id, g.name as group_name, h.active
      from held h left join groups g on g.id = h.group_id
      order by h.account_id, h.space_id, h.permission_id is null, h.permission_id`);
    const shares = await this.#database.execute<ShareRow>(sql`
      with holder as (
        select ps.id as share_id, ps.principal_id as account_id from page_shares ps
        where ps.principal_kind = 'account' and ps.principal_id = any(${ids()})
        union all
        select ps.id, gm.account_id from page_shares ps join group_members gm on gm.group_id = ps.principal_id
        where ps.principal_kind = 'group' and gm.account_id = any(${ids()})
          and (gm.expires_at is null or gm.expires_at > now())
      ), ranked as (
        select h.account_id, s.id as space_id, ${spaceDisplayName(sql`s`)} as space_name, s.key as space_key, t.id as item_id, t.title,
          ${this.#authorization.itemFilter(viewer, sql`t`, sql`s`)} as readable,
          ps.role, ps.principal_kind, ps.principal_id, g.name as group_name, ps.include_descendants,
          ${holderCovers(sql`ps.principal_kind`, sql`ps.principal_id`, sql`h.account_id`, sql`s.organization_id`)} as active,
          row_number() over (partition by h.account_id order by lower(s.name), lower(t.title), t.id, ps.id) as position
        from holder h join page_shares ps on ps.id = h.share_id
        join tree_items t on t.id = ps.item_id join spaces s on s.id = t.space_id
        left join groups g on ps.principal_kind = 'group' and g.id = ps.principal_id
        where ${scope} and t.trash_entry_id is null
      )
      select * from ranked where position <= 5000 order by account_id, position`);
    const links = await this.#database.execute<LinkRow>(sql`
      with ranked as (
        select la.account_id, s.id as space_id, ${spaceDisplayName(sql`s`)} as space_name, s.key as space_key, t.id as item_id, t.title,
          ${this.#authorization.itemFilter(viewer, sql`t`, sql`s`)} as readable, l.id as link_id, l.scope::text as scope,
          (l.scope not in ('people', 'organization')
            or ${organizationMembership(sql`s.organization_id`, sql`la.account_id`)}) as active,
          row_number() over (partition by la.account_id order by lower(s.name), lower(t.title), l.id) as position
        from share_link_accesses la join share_links l on l.id = la.link_id
        join tree_items t on t.id = l.item_id join spaces s on s.id = t.space_id
        where la.account_id = any(${ids()}) and ${scope} and l.revoked_at is null
          and (l.expires_at is null or l.expires_at > now()) and t.trash_entry_id is null
      )
      select * from ranked where position <= 5000 order by account_id, position`);
    const confidentialCounts = new Map(confidential.rows.map((row) => [row.account_id, Number(row.count)]));
    const rolesOf = byAccount(roles.rows);
    const sharesOf = byAccount(shares.rows);
    const linksOf = byAccount(links.rows);
    const visible = new Map(people.rows.map((person) => [person.id, person]));
    return accountIds.flatMap((accountId) => {
      const person = visible.get(accountId);
      if (!person) return [];
      return [
        {
          accountId,
          name: person.name,
          email: person.email,
          entries: [
            ...spaceEntries(spaces.rows, rolesOf.get(accountId) ?? []),
            ...pageEntries(sharesOf.get(accountId) ?? [], linksOf.get(accountId) ?? []),
          ],
          confidentialSpaceCount: confidentialCounts.get(accountId) ?? 0,
        },
      ];
    });
  }

  async overviewCsv(
    viewer: Principal,
    organizationId: string,
    accountId: string | null,
  ): Promise<AsyncIterable<string>> {
    const accounts = accountId
      ? [accountId]
      : (
          await this.#database.execute<{ account_id: string }>(sql`
            select m.account_id from memberships m join accounts a on a.id = m.account_id
            where m.organization_id = ${organizationId} and a.state = 'active'
            order by lower(a.name), a.id limit 10000`)
        ).rows.map((row) => row.account_id);
    const accessOf = (batch: string[]) => this.#accessOf(viewer, batch, { organizationId });
    const first = await accessOf(accounts.slice(0, OVERVIEW_BATCH));
    if (accountId && first.length === 0) throw new SpaceError("personNotFound", "The person does not exist");
    await this.#audit.recordAlone({
      name: "access.overviewExported",
      actor: viewer,
      targetId: organizationId,
      fields: { accountId, people: accounts.length },
      scope: { type: "organization", id: organizationId },
    });
    return {
      async *[Symbol.asyncIterator]() {
        yield `${OVERVIEW_COLUMNS.map(csvCell).join(",")}\r\n`;
        for (let start = 0; start < accounts.length; start += OVERVIEW_BATCH) {
          const batch = start === 0 ? first : await accessOf(accounts.slice(start, start + OVERVIEW_BATCH));
          for (const access of batch) yield overviewLines(access);
        }
      },
    };
  }

  async giveAccessEffect(
    holder: { kind: HolderKind; id: string },
    target: { spaceId: string; itemId: string | null; scope: GiveAccessScope },
    level: GiveAccessLevel,
    executor: Executor = this.#database,
  ): Promise<GiveAccessEffect> {
    const covers = (kind: SQL, id: SQL) =>
      holder.kind === "account"
        ? holderCovers(
            kind,
            id,
            sql`${holder.id}::uuid`,
            sql`(select gs.organization_id from spaces gs where gs.id = ${target.spaceId}::uuid)`,
          )
        : sql`(${kind} = 'group' and ${id} = ${holder.id}::uuid)`;
    const inScope =
      target.scope === "space" || !target.itemId
        ? sql`t.space_id = ${target.spaceId}`
        : target.scope === "page"
          ? sql`t.id = ${target.itemId}`
          : sql`${target.itemId}::uuid = any(t.path)`;
    const result = await executor.execute<{
      pages: string;
      restricted: string;
      unpublished: string;
      edit_restricted: string;
    }>(sql`
      select count(*) as pages,
        count(*) filter (where exists (select 1 from page_restrictions r where r.item_id = any(t.path) and r.kind = 'view'
          and not ${restrictionListedBy(sql`r`, covers)})) as restricted,
        count(*) filter (where not t.reader_visible) as unpublished,
        count(*) filter (where exists (select 1 from page_restrictions r where r.item_id = t.id and r.kind = 'edit'
          and not ${restrictionListedBy(sql`r`, covers)})) as edit_restricted
      from tree_items t
      where ${inScope} and t.kind in ('page', 'blogPost') and t.trash_entry_id is null and t.archived_root_id is null`);
    const row = result.rows[0];
    const pages = Number(row?.pages ?? 0);
    const restricted = Number(row?.restricted ?? 0);
    const editor = ROLE_RANK[level] >= ROLE_RANK.editor;
    const readable = pages - restricted - (editor ? 0 : Number(row?.unpublished ?? 0));
    let alreadyHas: SpaceRole | null = null;
    if (holder.kind === "account") {
      const facts = await this.#authorization.spaceRole(holder.id, target.spaceId, { fresh: true });
      alreadyHas = highestSpaceRole(facts.sources.map((source) => source.role));
    }
    return {
      pages,
      readable: Math.max(0, readable),
      editable: editor ? Math.max(0, pages - restricted - Number(row?.edit_restricted ?? 0)) : 0,
      restricted,
      alreadyHas,
    };
  }
}

export function describeReason(reason: AccessReason): string {
  const text = describeSource(reason);
  return reason.inactive === "membershipEnded" ? `${text}, inactive: membership ended` : text;
}

function describeSource(reason: AccessReason): string {
  switch (reason.type) {
    case "spaceRole": {
      const via = reason.via;
      const source =
        via.type === "group"
          ? `group ${via.name}`
          : via.type === "account"
            ? "direct"
            : via.type === "visibility"
              ? `space visible to ${via.visibility}`
              : via.type;
      return `space role ${reason.role} (${source})`;
    }
    case "share":
      return `shared as ${reason.role}${reason.via.type === "group" ? ` with group ${reason.via.name}` : ""}`;
    case "link":
      return `share link (${reason.scope})`;
  }
}
