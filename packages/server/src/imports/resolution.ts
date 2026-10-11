import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Transaction } from "../database/database.js";
import type { GroupService } from "../organizations/groups.js";
import { actorIdOf } from "../spaces/common.js";
import type { SpaceGrant } from "../spaces/settings.js";
import { signalSpaceChange } from "../spaces/signals.js";
import { type HolderValidation, insertGrants } from "../spaces/spaces.js";
import { visibleItem } from "../spaces/visibility.js";
import { ImportError } from "./errors.js";
import { holdsAccess, holdsAccessElsewhere, mapPlaceholder, memberByEmail } from "./mapping.js";
import { signalImportChange } from "./signals.js";
import { parseUserList } from "./user-list.js";

export const MAX_MAPPINGS = 100;
const RESOLVING_STATES = ["review", "accepted"];
const ROLE_ORDER = ["reader", "commenter", "editor", "admin"] as const;
type Role = (typeof ROLE_ORDER)[number];

export interface PlaceholderView {
  readonly id: string;
  readonly name: string;
  readonly externalId: string;
  readonly email: string | null;
  readonly named: boolean;
  readonly items: number;
  readonly comments: number;
  readonly restrictedPages: number;
  readonly spaceRole: Role | null;
  readonly mappedTo: { readonly id: string; readonly name: string } | null;
  readonly candidates: readonly { readonly id: string; readonly name: string }[];
}

export interface ImportGroupView {
  readonly key: string;
  readonly name: string;
  readonly group: { readonly id: string; readonly name: string } | null;
  readonly spaceRole: Role | null;
  readonly restrictedPages: number;
}

export type GrantState = "mapped" | "check" | "missing" | "notTaken" | "waiting";

export interface PermissionEntry {
  readonly id: string;
  readonly scope: "space" | "page";
  readonly item: { readonly id: string; readonly title: string | null } | null;
  readonly restriction: "view" | "edit" | null;
  readonly holder: {
    readonly kind: "account" | "group" | "organizationMembers" | "anonymous";
    readonly id: string | null;
    readonly name: string | null;
    readonly sourceName: string | null;
  };
  readonly role: Role | null;
  readonly permissions: readonly string[];
  readonly status: GrantState;
  readonly code: string | null;
}

export interface ProposedAccess {
  readonly visibility: "private" | "organization";
  readonly grants: readonly (SpaceGrant & { readonly name: string | null })[];
  readonly pending: number;
}

interface ImportRow {
  id: string;
  organization_id: string;
  importer_id: string;
  state: string;
  quarantine_space_id: string | null;
  [key: string]: unknown;
}

function higher(left: Role, right: Role): Role {
  return ROLE_ORDER.indexOf(left) >= ROLE_ORDER.indexOf(right) ? left : right;
}

export class ImportResolutionService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #audit: AuditLog;
  readonly #groups: GroupService;
  readonly #holders: HolderValidation;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    audit: AuditLog;
    groups: GroupService;
    holders: HolderValidation;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#audit = options.audit;
    this.#groups = options.groups;
    this.#holders = options.holders;
  }

  async #row(executor: Database | Transaction, importId: string, lock = false): Promise<ImportRow> {
    const result = await executor.execute<ImportRow>(sql`
      select id, organization_id, importer_id, state::text as state, quarantine_space_id from imports
      where id = ${importId} ${lock ? sql`for update` : sql``}`);
    const row = result.rows[0];
    if (!row) throw new ImportError("importNotFound", "The import does not exist.");
    return row;
  }

  async #readable(viewer: Principal, importId: string): Promise<ImportRow> {
    await this.#authorization.require(viewer, "import.view", { type: "import", id: importId });
    const row = await this.#row(this.#database, importId);
    if (!["running", "held", "review", "accepting", "accepted", "failed"].includes(row.state)) {
      throw new ImportError("reportUnavailable", "The report is available once the import has started.");
    }
    return row;
  }

  async #resolvable(tx: Transaction, actor: Principal, importId: string): Promise<ImportRow> {
    await this.#authorization.require(
      actor,
      "import.resolve",
      { type: "import", id: importId },
      { executor: tx },
    );
    const row = await this.#row(tx, importId, true);
    if (!RESOLVING_STATES.includes(row.state)) {
      throw new ImportError(
        "importNotResolvable",
        "People and groups can be mapped once the import has finished, before or after accepting it.",
      );
    }
    return row;
  }

  async people(
    viewer: Principal,
    importId: string,
    filter: { q?: string | undefined; offset: number; limit: number },
  ): Promise<{ people: PlaceholderView[]; total: number; mapped: number; next: number | null }> {
    const row = await this.#readable(viewer, importId);
    const term = filter.q?.trim().toLowerCase() ?? "";
    const pattern = `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const space = row.quarantine_space_id;
    const totals = await this.#database.execute<{ total: number; mapped: number }>(sql`
      select count(*)::int as total, count(a.merged_into_id)::int as mapped
      from import_items i join accounts a on a.id = i.target_id
      where i.import_id = ${importId} and i.kind = 'person' and a.state = 'placeholder'`);
    const result = await this.#database.execute<{
      id: string;
      name: string;
      email: string | null;
      source_id: string;
      merged_into_id: string | null;
      target_name: string | null;
      items: number;
      comments: number;
      restricted: number;
      space_role: Role | null;
      candidates: { id: string; name: string }[] | null;
    }>(sql`
      select a.id, a.name, a.email, i.source_id, a.merged_into_id, t.name as target_name,
        (select count(*) from tree_items ti where ti.space_id = ${space} and ti.creator_id = a.id)::int as items,
        (select count(*) from comments c join tree_items ct on ct.id = c.item_id
          where ct.space_id = ${space} and c.author_id = a.id)::int as comments,
        (select count(distinct rh.item_id) from page_restriction_holders rh where rh.principal_kind = 'account'
          and rh.principal_id = a.id)::int as restricted,
        (select g.role::text from import_grants g where g.import_id = ${importId} and g.item_id is null
          and g.account_id = a.id and g.role is not null and g.status <> 'notTaken' limit 1) as space_role,
        case when a.merged_into_id is null and a.name <> i.source_id then (
          select json_agg(json_build_object('id', m.id, 'name', m.name) order by lower(m.name), m.id) from (
            select distinct m.id, m.name from accounts m join memberships ms on ms.account_id = m.id
            where ms.organization_id = ${row.organization_id} and m.state = 'active'
              and m.type in ('standard', 'guest') and (ms.expires_at is null or ms.expires_at > now())
              and (lower(m.name) = lower(a.name)
                or (regexp_replace(lower(m.name), '^.*\\s', '') = regexp_replace(lower(a.name), '^.*\\s', '')
                  and left(lower(m.name), 1) = left(lower(a.name), 1)
                  and position(' ' in a.name) > 0 and position(' ' in m.name) > 0))
            limit 5) m)
        end as candidates
      from import_items i join accounts a on a.id = i.target_id
      left join accounts t on t.id = a.merged_into_id
      where i.import_id = ${importId} and i.kind = 'person' and a.state = 'placeholder'
        ${
          term
            ? sql`and (lower(a.name) like ${pattern} or lower(coalesce(a.email, '')) like ${pattern}
          or lower(i.source_id) like ${pattern} or lower(coalesce(t.name, '')) like ${pattern})`
            : sql``
        }
      order by (a.merged_into_id is not null), lower(a.name), a.id
      offset ${filter.offset} limit ${filter.limit + 1}`);
    const rows = result.rows.slice(0, filter.limit);
    return {
      people: rows.map((entry) => ({
        id: entry.id,
        name: entry.name,
        externalId: entry.source_id.startsWith("key:") ? entry.source_id.slice(4) : entry.source_id,
        email: entry.email,
        named: entry.name !== entry.source_id,
        items: entry.items,
        comments: entry.comments,
        restrictedPages: entry.restricted,
        spaceRole: entry.space_role,
        mappedTo:
          entry.merged_into_id && entry.target_name !== null
            ? { id: entry.merged_into_id, name: entry.target_name }
            : null,
        candidates: entry.candidates ?? [],
      })),
      total: totals.rows[0]?.total ?? 0,
      mapped: totals.rows[0]?.mapped ?? 0,
      next: result.rows.length > filter.limit ? filter.offset + filter.limit : null,
    };
  }

  async mapPeople(
    actor: Principal,
    importId: string,
    mappings: readonly { placeholderId: string; accountId: string }[],
  ): Promise<{ mapped: number }> {
    if (mappings.length === 0 || mappings.length > MAX_MAPPINGS) {
      throw new ImportError("invalidMapping", `Map 1 to ${MAX_MAPPINGS} people at a time.`);
    }
    if (new Set(mappings.map((mapping) => mapping.placeholderId)).size !== mappings.length) {
      throw new ImportError("invalidMapping", "Each person can be mapped only once.");
    }
    await this.#database.transaction(async (tx) => {
      const row = await this.#resolvable(tx, actor, importId);
      for (const mapping of [...mappings].sort((a, b) => a.placeholderId.localeCompare(b.placeholderId))) {
        await mapPlaceholder(tx, this.#audit, actor, {
          organizationId: row.organization_id,
          importId,
          placeholderId: mapping.placeholderId,
          accountId: mapping.accountId,
          via: "manual",
          bulk: mappings.length > 1,
        });
      }
      await this.#afterResolution(tx, actor, row);
    });
    return { mapped: mappings.length };
  }

  async uploadUserList(
    actor: Principal,
    importId: string,
    text: string,
  ): Promise<{ matched: number; named: number; remaining: number }> {
    await this.#authorization.require(actor, "import.resolve", { type: "import", id: importId });
    const entries = new Map((await parseUserList(text)).map((entry) => [entry.externalId, entry]));
    let matched = 0;
    let named = 0;
    await this.#database.transaction(async (tx) => {
      const row = await this.#resolvable(tx, actor, importId);
      const open = await tx.execute<{
        id: string;
        name: string;
        email: string | null;
        source_id: string;
      }>(sql`
        select a.id, a.name, a.email, i.source_id from import_items i join accounts a on a.id = i.target_id
        where i.import_id = ${importId} and i.kind = 'person' and a.state = 'placeholder' and a.merged_into_id is null
        order by a.id for update of a`);
      for (const placeholder of open.rows) {
        const entry = entries.get(placeholder.source_id);
        if (!entry) continue;
        const guarded = await holdsAccessElsewhere(tx, placeholder.id, importId);
        const member = entry.email ? await memberByEmail(tx, row.organization_id, entry.email) : null;
        const ownAccess =
          member !== null &&
          actor.type === "account" &&
          actor.id === member &&
          (await holdsAccess(tx, placeholder.id));
        if (member && !ownAccess && !guarded) {
          await mapPlaceholder(tx, this.#audit, actor, {
            organizationId: row.organization_id,
            importId,
            placeholderId: placeholder.id,
            accountId: member,
            via: "userList",
            bulk: true,
          });
          matched += 1;
          continue;
        }
        const name = entry.name?.replace(/\s+/g, " ").trim().slice(0, 200) ?? "";
        if (name && placeholder.name === placeholder.source_id) {
          await tx.execute(
            sql`update accounts set name = ${name}, updated_at = now() where id = ${placeholder.id}`,
          );
          named += 1;
        }
        if (entry.email && !placeholder.email && !guarded) {
          await tx.execute(sql`
            update accounts set email = ${entry.email}, updated_at = now() where id = ${placeholder.id}
              and not exists (select 1 from accounts o where lower(o.email) = lower(${entry.email}))`);
        }
      }
      await this.#afterResolution(tx, actor, row);
    });
    const remaining = await this.#database.execute<{ count: number }>(sql`
      select count(*)::int as count from import_items i join accounts a on a.id = i.target_id
      where i.import_id = ${importId} and i.kind = 'person' and a.state = 'placeholder' and a.merged_into_id is null`);
    return { matched, named, remaining: remaining.rows[0]?.count ?? 0 };
  }

  async groups(viewer: Principal, importId: string): Promise<ImportGroupView[]> {
    await this.#readable(viewer, importId);
    const result = await this.#database.execute<{
      name_key: string;
      name: string;
      group_id: string | null;
      group_name: string | null;
      space_role: Role | null;
      restricted: number;
    }>(sql`
      select ig.name_key, ig.name, ig.group_id, g.name as group_name,
        (select gr.role::text from import_grants gr where gr.import_id = ig.import_id and gr.group_key = ig.name_key
          and gr.item_id is null and gr.role is not null and gr.status <> 'notTaken' limit 1) as space_role,
        (select count(distinct gr.item_id) from import_grants gr where gr.import_id = ig.import_id
          and gr.group_key = ig.name_key and gr.item_id is not null)::int as restricted
      from import_groups ig left join groups g on g.id = ig.group_id
      where ig.import_id = ${importId}
        and exists (select 1 from import_grants gr where gr.import_id = ig.import_id and gr.group_key = ig.name_key
          and gr.status <> 'notTaken')
      order by (ig.group_id is not null), lower(ig.name), ig.name_key
      limit 1000`);
    return result.rows.map((row) => ({
      key: row.name_key,
      name: row.name,
      group: row.group_id && row.group_name !== null ? { id: row.group_id, name: row.group_name } : null,
      spaceRole: row.space_role,
      restrictedPages: row.restricted,
    }));
  }

  async mapGroup(
    actor: Principal,
    importId: string,
    key: string,
    input: { groupId: string } | { create: true },
  ): Promise<ImportGroupView> {
    await this.#authorization.require(actor, "import.resolve", { type: "import", id: importId });
    await this.#database.transaction(async (tx) => {
      const row = await this.#resolvable(tx, actor, importId);
      const locked = await tx.execute<{ name: string; group_id: string | null }>(sql`
        select name, group_id from import_groups where import_id = ${importId} and name_key = ${key} for update`);
      const entry = locked.rows[0];
      if (!entry) throw new ImportError("groupNotFound", "The import names no group like this.");
      if (entry.group_id) {
        throw new ImportError("groupAlreadyMapped", "The group is mapped already. Reload the list.");
      }
      let groupId: string;
      if ("create" in input) {
        await this.#authorization.require(
          actor,
          "organization.groups.create",
          { type: "organization", id: row.organization_id },
          { executor: tx },
        );
        groupId = (await this.#groups.create(actor, row.organization_id, { name: entry.name }, { tx })).id;
      } else {
        const group = await tx.execute<{ id: string }>(sql`
          select id from groups where id = ${input.groupId} and organization_id = ${row.organization_id}`);
        if (!group.rows[0]) throw new ImportError("groupNotFound", "Choose a group of this organization.");
        groupId = input.groupId;
        const own = await tx.execute<{ own: boolean }>(sql`
          select exists (select 1 from group_members
            where group_id = ${groupId} and account_id = ${actorIdOf(actor)}
              and (expires_at is null or expires_at > now()))
            or exists (select 1 from group_managers where group_id = ${groupId} and account_id = ${actorIdOf(actor)})
            as own`);
        if (own.rows[0]?.own) await this.#selfAdded(tx, actor, groupId, importId, "importMapping", row);
      }
      if ("create" in input) await this.#selfAdded(tx, actor, groupId, importId, "importCreation", row);
      await tx.execute(sql`
        update import_groups set group_id = ${groupId}, mapped_by = ${actorIdOf(actor)}, mapped_at = now()
        where import_id = ${importId} and name_key = ${key}`);
      await tx.execute(sql`
        insert into page_restriction_holders (item_id, kind, principal_kind, principal_id)
        select gr.item_id, gr.restriction::page_restriction_kind, 'group', ${groupId} from import_grants gr
        join page_restrictions r on r.item_id = gr.item_id and r.kind::text = gr.restriction
        join tree_items t on t.id = gr.item_id join spaces s on s.id = t.space_id
        where gr.import_id = ${importId} and gr.group_key = ${key} and gr.item_id is not null
          and gr.restriction is not null and gr.applied_at is null and not s.confidential
        on conflict do nothing`);
      await tx.execute(sql`
        update import_grants gr set applied_at = now()
        from tree_items t join spaces s on s.id = t.space_id
        where t.id = gr.item_id and gr.import_id = ${importId} and gr.group_key = ${key}
          and gr.applied_at is null and not s.confidential`);
      await this.#audit.record(tx, {
        name: "import.groupMapped",
        actor,
        targetId: groupId,
        fields: { importId, name: entry.name, created: "create" in input },
        scope: { type: "organization", id: row.organization_id },
      });
      await this.#afterResolution(tx, actor, row);
    });
    const groups = await this.groups(actor, importId);
    const found = groups.find((group) => group.key === key);
    if (!found) throw new ImportError("groupNotFound", "The import names no group like this.");
    return found;
  }

  async #selfAdded(
    tx: Transaction,
    actor: Principal,
    groupId: string,
    importId: string,
    source: "importMapping" | "importCreation",
    row: ImportRow,
  ): Promise<void> {
    if (actor.type !== "account") return;
    await this.#audit.record(tx, {
      name: "group.selfAdded",
      actor,
      targetId: groupId,
      fields: { accountId: actor.id, source, importId, expiresAt: null },
      scope: { type: "organization", id: row.organization_id },
    });
  }

  async #afterResolution(tx: Transaction, actor: Principal, row: ImportRow): Promise<void> {
    if (row.state === "accepted" && row.quarantine_space_id) {
      await this.applyPending(tx, actor, row.id, row.organization_id, row.quarantine_space_id, "mapping");
    }
    if (row.quarantine_space_id) {
      await signalSpaceChange(tx, { spaceId: row.quarantine_space_id, kind: "access", itemId: null });
    }
    await signalImportChange(tx, { importId: row.id, organizationId: row.organization_id });
  }

  async #resolvedGrants(
    executor: Database | Transaction,
    importId: string,
    pendingOnly: boolean,
  ): Promise<{ grants: Map<string, SpaceGrant & { name: string | null; ids: string[] }>; pending: number }> {
    const rows = await executor.execute<{
      id: string;
      holder_kind: string;
      role: Role;
      account_id: string | null;
      account_state: string | null;
      account_name: string | null;
      group_id: string | null;
      group_name: string | null;
    }>(sql`
      select gr.id, gr.holder_kind, gr.role::text as role,
        coalesce(a.merged_into_id, a.id) as account_id, coalesce(t.state, a.state)::text as account_state,
        coalesce(t.name, a.name) as account_name, ig.group_id, g.name as group_name
      from import_grants gr
      left join accounts a on a.id = gr.account_id
      left join accounts t on t.id = a.merged_into_id
      left join import_groups ig on ig.import_id = gr.import_id and ig.name_key = gr.group_key
      left join groups g on g.id = ig.group_id
      where gr.import_id = ${importId} and gr.item_id is null and gr.role is not null and gr.status <> 'notTaken'
        ${pendingOnly ? sql`and gr.applied_at is null` : sql``}
      order by gr.id`);
    const grants = new Map<string, SpaceGrant & { name: string | null; ids: string[] }>();
    let pending = 0;
    for (const row of rows.rows) {
      let grant: (SpaceGrant & { name: string | null }) | null = null;
      if (row.holder_kind === "account" && row.account_id && row.account_state === "active") {
        grant = {
          principalKind: "account",
          principalId: row.account_id,
          role: row.role,
          name: row.account_name,
        };
      } else if (row.holder_kind === "group" && row.group_id) {
        grant = { principalKind: "group", principalId: row.group_id, role: row.role, name: row.group_name };
      } else if (row.holder_kind === "organizationMembers") {
        grant = { principalKind: "organizationMembers", principalId: null, role: row.role, name: null };
      }
      if (!grant) {
        pending += 1;
        continue;
      }
      const key = `${grant.principalKind}:${grant.principalId ?? ""}`;
      const existing = grants.get(key);
      grants.set(key, {
        ...grant,
        role: existing ? higher(existing.role as Role, grant.role as Role) : grant.role,
        ids: [...(existing?.ids ?? []), row.id],
      });
    }
    return { grants, pending };
  }

  async proposal(viewer: Principal, importId: string): Promise<ProposedAccess> {
    await this.#readable(viewer, importId);
    const { grants, pending } = await this.#resolvedGrants(this.#database, importId, false);
    const list = [...grants.values()].map(({ ids: _ids, ...grant }) => grant);
    return {
      visibility: list.some((grant) => grant.principalKind === "organizationMembers")
        ? "organization"
        : "private",
      grants: list,
      pending,
    };
  }

  async markAccepted(
    tx: Transaction,
    actor: Principal,
    input: { importId: string; organizationId: string; spaceId: string; granted: readonly SpaceGrant[] },
  ): Promise<void> {
    const { grants } = await this.#resolvedGrants(tx, input.importId, true);
    if (grants.size === 0) return;
    const ids = [...grants.values()].flatMap((grant) => grant.ids);
    await tx.execute(
      sql`update import_grants set applied_at = now() where id = any(${sql.param(ids)}::uuid[])`,
    );
    const submitted = new Map(
      input.granted.map((grant) => [`${grant.principalKind}:${grant.principalId ?? ""}`, grant.role]),
    );
    let applied = 0;
    for (const [key, grant] of grants) if (submitted.get(key) === grant.role) applied += 1;
    await this.#audit.record(tx, {
      name: "import.permissionsApplied",
      actor,
      targetId: input.importId,
      fields: {
        spaceId: input.spaceId,
        via: "accept",
        imported: grants.size,
        applied,
        changed: applied !== grants.size,
      },
      scope: { type: "organization", id: input.organizationId },
    });
  }

  async applyPending(
    tx: Transaction,
    actor: Principal,
    importId: string,
    organizationId: string,
    spaceId: string,
    via: "mapping",
  ): Promise<void> {
    const { grants } = await this.#resolvedGrants(tx, importId, true);
    if (grants.size === 0) return;
    const space = await tx.execute<{ name: string }>(sql`select name from spaces where id = ${spaceId}`);
    const name = space.rows[0]?.name;
    if (name === undefined) return;
    const target = { id: spaceId, organizationId, ownerId: null, confidential: false };
    const existing = await tx.execute<{ principal_kind: string; principal_id: string | null }>(sql`
      select principal_kind::text as principal_kind, principal_id from space_permissions where space_id = ${spaceId}`);
    const held = new Set(existing.rows.map((row) => `${row.principal_kind}:${row.principal_id ?? ""}`));
    const added: SpaceGrant[] = [];
    const done: string[] = [];
    for (const [key, grant] of grants) {
      if (held.has(key)) {
        done.push(...grant.ids);
        continue;
      }
      const candidate: SpaceGrant = {
        principalKind: grant.principalKind,
        principalId: grant.principalId,
        role: grant.role,
      };
      try {
        await this.#holders.validate(tx, target, candidate, actor);
      } catch {
        continue;
      }
      added.push(candidate);
      done.push(...grant.ids);
    }
    if (done.length > 0) {
      await tx.execute(
        sql`update import_grants set applied_at = now() where id = any(${sql.param(done)}::uuid[])`,
      );
    }
    if (added.length === 0) return;
    await insertGrants(tx, this.#audit, actor, { ...target, name }, added);
    await this.#audit.record(tx, {
      name: "import.permissionsApplied",
      actor,
      targetId: importId,
      fields: { spaceId, via, imported: added.length, applied: added.length, changed: false },
      scope: { type: "organization", id: organizationId },
    });
  }

  async permissions(
    viewer: Principal,
    importId: string,
    filter: { after?: string | undefined; limit: number },
  ): Promise<{ entries: PermissionEntry[]; next: string | null }> {
    await this.#readable(viewer, importId);
    const result = await this.#database.execute<{
      id: string;
      item_id: string | null;
      title: string | null;
      restriction: "view" | "edit" | null;
      holder_kind: PermissionEntry["holder"]["kind"];
      account_id: string | null;
      account_name: string | null;
      account_state: string | null;
      group_key: string | null;
      source_group: string | null;
      group_id: string | null;
      group_name: string | null;
      role: Role | null;
      permissions: string[];
      status: "mapped" | "check" | "missing" | "notTaken";
      code: string | null;
      outside: boolean;
    }>(sql`
      select gr.id, gr.item_id,
        case when ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)} then t.title end as title,
        gr.restriction, gr.holder_kind, coalesce(a.merged_into_id, a.id) as account_id,
        coalesce(m.name, a.name) as account_name,
        case when a.merged_into_id is not null then m.state::text else a.state::text end as account_state,
        gr.group_key, ig.name as source_group, ig.group_id, g.name as group_name,
        gr.role::text as role, gr.permissions, gr.status, gr.code,
        gr.item_id is not null and not exists (select 1 from import_grants sg
          left join import_groups sig on sig.import_id = sg.import_id and sig.name_key = sg.group_key
          left join accounts sa on sa.id = sg.account_id
          where sg.import_id = gr.import_id and sg.item_id is null and sg.role is not null and sg.status <> 'notTaken'
            and ((gr.holder_kind = 'group' and sg.holder_kind = 'group' and sg.group_key = gr.group_key)
              or (gr.holder_kind = 'group' and sg.holder_kind = 'organizationMembers')
              or (gr.holder_kind = 'account' and sg.holder_kind = 'account'
                and coalesce(sa.merged_into_id, sa.id) = coalesce(a.merged_into_id, a.id))
              or (gr.holder_kind = 'account' and sg.holder_kind = 'group' and (sig.group_id is null
                or exists (select 1 from group_members gm where gm.group_id = sig.group_id
                  and gm.account_id = coalesce(a.merged_into_id, a.id))))
              or (gr.holder_kind = 'account' and sg.holder_kind = 'organizationMembers'
                and exists (select 1 from memberships ms join imports im on im.id = gr.import_id
                  where ms.account_id = coalesce(a.merged_into_id, a.id)
                    and ms.organization_id = im.organization_id)))) as outside
      from import_grants gr
      left join tree_items t on t.id = gr.item_id
      left join spaces s on s.id = t.space_id
      left join accounts a on a.id = gr.account_id
      left join accounts m on m.id = a.merged_into_id
      left join import_groups ig on ig.import_id = gr.import_id and ig.name_key = gr.group_key
      left join groups g on g.id = ig.group_id
      where gr.import_id = ${importId} ${filter.after ? sql`and gr.id > ${filter.after}` : sql``}
      order by gr.id limit ${filter.limit + 1}`);
    const rows = result.rows.slice(0, filter.limit);
    const entries = rows.map((row): PermissionEntry => {
      const waiting = row.holder_kind === "account" && row.account_state === "placeholder";
      const missing = row.holder_kind === "group" && !row.group_id;
      return {
        id: row.id,
        scope: row.item_id ? "page" : "space",
        item: row.item_id ? { id: row.item_id, title: row.title } : null,
        restriction: row.restriction,
        holder: {
          kind: row.holder_kind,
          id:
            row.holder_kind === "account"
              ? row.account_id
              : row.holder_kind === "group"
                ? row.group_id
                : null,
          name:
            row.holder_kind === "account"
              ? row.account_name
              : row.holder_kind === "group"
                ? row.group_name
                : null,
          sourceName: row.holder_kind === "group" ? row.source_group : null,
        },
        role: row.role,
        permissions: row.permissions,
        status:
          row.status === "notTaken" ? "notTaken" : missing ? "missing" : waiting ? "waiting" : row.status,
        code:
          row.status === "notTaken"
            ? row.code
            : missing
              ? "groupMissing"
              : waiting
                ? "placeholder"
                : row.outside
                  ? "withoutSpaceRole"
                  : row.code,
      };
    });
    return { entries, next: result.rows.length > filter.limit ? (rows.at(-1)?.id ?? null) : null };
  }

  async summary(
    executor: Database | Transaction,
    importId: string,
  ): Promise<{ placeholders: number; mapped: number; permissionsToCheck: number; groupsMissing: number }> {
    const result = await executor.execute<{
      placeholders: number;
      mapped: number;
      to_check: number;
      groups_missing: number;
    }>(sql`
      select
        (select count(*) from import_items i join accounts a on a.id = i.target_id
          where i.import_id = ${importId} and i.kind = 'person' and a.state = 'placeholder'
            and a.merged_into_id is null)::int as placeholders,
        (select count(*) from import_items i join accounts a on a.id = i.target_id
          where i.import_id = ${importId} and i.kind = 'person' and a.merged_into_id is not null)::int as mapped,
        (select count(*) from import_grants gr
          left join accounts a on a.id = gr.account_id
          left join import_groups ig on ig.import_id = gr.import_id and ig.name_key = gr.group_key
          where gr.import_id = ${importId} and (gr.status <> 'mapped'
            or (gr.holder_kind = 'account' and a.state = 'placeholder' and a.merged_into_id is null)
            or (gr.holder_kind = 'group' and ig.group_id is null)))::int as to_check,
        (select count(*) from import_groups where import_id = ${importId} and group_id is null)::int as groups_missing`);
    const row = result.rows[0];
    return {
      placeholders: row?.placeholders ?? 0,
      mapped: row?.mapped ?? 0,
      permissionsToCheck: row?.to_check ?? 0,
      groupsMissing: row?.groups_missing ?? 0,
    };
  }
}
