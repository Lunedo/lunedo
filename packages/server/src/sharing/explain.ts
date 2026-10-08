import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import { holderCovers } from "../authorization/item-access.js";
import type { AuthorizationService, Decision, Grant } from "../authorization/service.js";
import type { Database, Executor } from "../database/database.js";
import { SpaceError } from "../spaces/common.js";
import type { PeopleService } from "../spaces/people.js";
import { highestSpaceRole } from "../spaces/roles.js";
import type { SpaceRole } from "../spaces/schema.js";
import type { HolderKind } from "./page-access.js";

export type AccessReason =
  | { type: "spaceRole"; role: SpaceRole; via: SpaceReasonVia }
  | {
      type: "share";
      role: SpaceRole;
      via: { type: "account" } | { type: "group"; groupId: string; name: string };
      itemId: string;
      itemTitle: string | null;
      inherited: boolean;
    }
  | { type: "link"; linkId: string; scope: string };

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
}

export interface PersonAccess {
  accountId: string;
  name: string | null;
  email: string | null;
  entries: PersonAccessEntry[];
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
    if (!person) throw new SpaceError("personNotFound", "The person does not exist");
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
    const titles = await this.#titles(viewer, [
      ...grants.flatMap((grant) => (grant.kind === "share" ? [grant.itemId] : [])),
      ...(itemFacts?.viewRestrictions.map((restriction) => restriction.itemId) ?? []),
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
      const facts =
        resource.type === "space"
          ? null
          : await this.#authorization.spaceRole(accountId, (await this.#spaceOf(resource.id)) ?? "", {
              fresh: true,
            });
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
    const account = await this.#database.execute<{
      id: string;
      name: string | null;
      email: string | null;
    }>(sql`
      select a.id, ${this.#people.visibleName(viewer, sql`a`)} as name,
        case when ${this.#people.colleagueCondition(viewer, sql`a.id`)} then a.email end as email
      from accounts a where a.id = ${accountId}`);
    const person = account.rows[0];
    if (!person) throw new SpaceError("personNotFound", "The person does not exist");
    const limit = options.spaceIds ? sql`s.id = any(${sql.param(options.spaceIds)}::uuid[])` : sql`true`;
    const scope = sql`${this.#spaceScope(options.organizationId)} and ${limit} and s.deleted_at is null and s.personal_of is null`;
    const spaces = await this.#database.execute<{ id: string; name: string; key: string }>(sql`
      select s.id, s.name, s.key from spaces s where ${scope} order by lower(s.name), s.id limit 2000`);
    const entries: PersonAccessEntry[] = [];
    for (const space of spaces.rows) {
      const facts = await this.#authorization.spaceRole(accountId, space.id, { fresh: true });
      if (facts.role) {
        entries.push({
          kind: "space",
          spaceId: space.id,
          spaceName: space.name,
          spaceKey: space.key,
          itemId: null,
          itemTitle: null,
          role: facts.role,
          count: 1,
          reasons: facts.sources.map((source) => ({ type: "spaceRole", role: source.role, via: source.via })),
        });
      }
    }
    const accountRef = sql`${accountId}::uuid`;
    const shares = await this.#database.execute<{
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
    }>(sql`
      select s.id as space_id, s.name as space_name, s.key as space_key, t.id as item_id, t.title,
        ${this.#authorization.itemFilter(viewer, sql`t`, sql`s`)} as readable,
        ps.role, ps.principal_kind, ps.principal_id, g.name as group_name, ps.include_descendants
      from page_shares ps join tree_items t on t.id = ps.item_id join spaces s on s.id = t.space_id
      left join groups g on ps.principal_kind = 'group' and g.id = ps.principal_id
      where ${scope} and t.trash_entry_id is null and ${holderCovers(sql`ps.principal_kind`, sql`ps.principal_id`, accountRef)}
      order by lower(s.name), lower(t.title), t.id limit 5000`);
    const hidden = new Map<string, PersonAccessEntry>();
    for (const row of shares.rows) {
      const reason: AccessReason = {
        type: "share",
        role: row.role,
        via:
          row.principal_kind === "group"
            ? { type: "group", groupId: row.principal_id, name: row.group_name ?? "" }
            : { type: "account" },
        itemId: row.item_id,
        itemTitle: row.readable ? row.title : null,
        inherited: false,
      };
      if (row.readable) {
        entries.push({
          kind: "share",
          spaceId: row.space_id,
          spaceName: row.space_name,
          spaceKey: row.space_key,
          itemId: row.item_id,
          itemTitle: row.title,
          role: row.role,
          count: row.include_descendants ? 2 : 1,
          reasons: [reason],
        });
        continue;
      }
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
      };
      summary.count += 1;
      hidden.set(row.space_id, summary);
    }
    const links = await this.#database.execute<{
      space_id: string;
      space_name: string;
      space_key: string;
      item_id: string;
      title: string;
      readable: boolean;
      link_id: string;
      scope: string;
    }>(sql`
      select s.id as space_id, s.name as space_name, s.key as space_key, t.id as item_id, t.title,
        ${this.#authorization.itemFilter(viewer, sql`t`, sql`s`)} as readable, l.id as link_id, l.scope::text as scope
      from share_link_accesses la join share_links l on l.id = la.link_id
      join tree_items t on t.id = l.item_id join spaces s on s.id = t.space_id
      where la.account_id = ${accountId} and ${scope} and l.revoked_at is null
        and (l.expires_at is null or l.expires_at > now()) and t.trash_entry_id is null
      order by lower(s.name), lower(t.title) limit 5000`);
    for (const row of links.rows) {
      if (!row.readable) {
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
        };
        summary.count += 1;
        hidden.set(row.space_id, summary);
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
        reasons: [{ type: "link", linkId: row.link_id, scope: row.scope }],
      });
    }
    entries.push(...hidden.values());
    return { accountId, name: person.name, email: person.email, entries };
  }

  async overviewCsv(viewer: Principal, organizationId: string, accountId: string | null): Promise<string> {
    const accounts = accountId
      ? [accountId]
      : (
          await this.#database.execute<{ account_id: string }>(sql`
            select m.account_id from memberships m join accounts a on a.id = m.account_id
            where m.organization_id = ${organizationId} and a.state = 'active'
            order by lower(a.name), a.id limit 10000`)
        ).rows.map((row) => row.account_id);
    const lines = [
      ["person", "email", "kind", "space", "page", "role", "pages", "reason"].map(csvCell).join(","),
    ];
    for (const id of accounts) {
      const access = await this.personAccess(viewer, id, { organizationId });
      for (const entry of access.entries) {
        lines.push(
          [
            access.name,
            access.email,
            entry.kind,
            entry.spaceName,
            entry.itemTitle,
            entry.role,
            entry.count,
            entry.reasons.map((reason) => describeReason(reason)).join("; "),
          ]
            .map(csvCell)
            .join(","),
        );
      }
    }
    await this.#database.transaction(async (tx) => {
      await this.#audit.record(tx, {
        name: "access.overviewExported",
        actor: viewer,
        targetId: organizationId,
        fields: { accountId, rows: lines.length - 1 },
        scope: { type: "organization", id: organizationId },
      });
    });
    return `${lines.join("\r\n")}\r\n`;
  }

  async giveAccessEffect(
    holder: { kind: HolderKind; id: string },
    target: { spaceId: string; itemId: string | null; scope: GiveAccessScope },
    level: GiveAccessLevel,
    executor: Executor = this.#database,
  ): Promise<GiveAccessEffect> {
    const covers =
      holder.kind === "account"
        ? holderCovers(sql`rs.principal_kind`, sql`rs.principal_id`, sql`${holder.id}::uuid`)
        : sql`(rs.principal_kind = 'group' and rs.principal_id = ${holder.id}::uuid)`;
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
          and not exists (select 1 from page_shares rs where rs.item_id = r.item_id and ${covers}))) as restricted,
        count(*) filter (where not t.reader_visible) as unpublished,
        count(*) filter (where exists (select 1 from page_restrictions r where r.item_id = t.id and r.kind = 'edit'
          and not exists (select 1 from page_shares rs where rs.item_id = r.item_id and rs.role = 'editor' and ${covers}))) as edit_restricted
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
