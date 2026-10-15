import { uuidv7 } from "@pagehall/shared";
import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import { type AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import {
  type AccessImpact,
  accessImpact,
  activeAdministratorCondition,
  storedGrants,
} from "../authorization/space-access.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import { afterKey, FIRST_PAGE, type Page, type PageRequest, pageLimit, toPage } from "../database/keyset.js";
import type { SettingsService } from "../settings/service.js";
import {
  actorIdOf,
  auditScopeOf,
  currentGrants,
  isUniqueViolation,
  mergeGrants,
  SpaceError,
} from "./common.js";
import { defaultPageMode, insertPage } from "./items.js";
import { isValidSpaceKey, normalizeSpaceKey, spaceKeyCandidates, suggestSpaceKey } from "./keys.js";
import type { PeopleService } from "./people.js";
import type { SpaceRole, SpaceVisibility } from "./schema.js";
import {
  type DefaultSpacePermissions,
  defaultSpacePermissionsSetting,
  exportEnabledSetting,
  type SpaceGrant,
} from "./settings.js";
import { signalSpaceChange } from "./signals.js";
import { insertDefaultPageStatuses } from "./status.js";

export const SPACE_NAME_MAX_LENGTH = 100;
export const SPACE_DESCRIPTION_MAX_LENGTH = 1000;

export interface Space {
  id: string;
  key: string;
  name: string;
  description: string;
  visibility: SpaceVisibility;
  discoverable: boolean;
  confidential: boolean;
  oneOnOne: boolean;
  quarantined: boolean;
  organizationId: string | null;
  organizationName: string | null;
  personal: boolean;
  ownerId: string | null;
  ownerName: string | null;
  overviewItemId: string | null;
  archived: boolean;
  exportEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpaceWithRole extends Space {
  role: SpaceRole | null;
  mayExport: boolean;
}

type SpaceRow = {
  id: string;
  key: string;
  name: string;
  description: string;
  visibility: SpaceVisibility;
  discoverable: boolean;
  confidential: boolean;
  one_on_one: boolean;
  quarantined: boolean;
  organization_id: string | null;
  organization_name: string | null;
  personal_of: string | null;
  owner_account_id: string | null;
  owner_name: string | null;
  overview_item_id: string | null;
  archived: boolean;
  export_enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

const SPACE_COLUMNS = sql`s.id, s.key, s.name, s.description, s.visibility, s.discoverable,
  s.confidential, s.one_on_one, s.quarantined, s.organization_id,
  o.name as organization_name, s.personal_of, s.owner_account_id, owner.name as owner_name,
  s.overview_item_id, s.archived_at is not null as archived,
  coalesce((select (sv.value)::boolean from setting_values sv
    where sv.key = ${exportEnabledSetting.key} and sv.level = 'space' and sv.scope_id = s.id
      and sv.value is not null), true) as export_enabled,
  s.created_at, s.updated_at`;

const SPACE_FROM = sql`spaces s
  left join organizations o on o.id = s.organization_id
  left join accounts owner on owner.id = s.owner_account_id`;

function toSpace(row: SpaceRow): Space {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    discoverable: row.discoverable,
    confidential: row.confidential,
    oneOnOne: row.one_on_one,
    quarantined: row.quarantined,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    personal: row.personal_of !== null,
    ownerId: row.owner_account_id,
    ownerName: row.owner_name,
    overviewItemId: row.overview_item_id,
    archived: row.archived,
    exportEnabled: row.export_enabled,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function cleanName(name: string, required: boolean): string {
  const value = name.trim();
  if ((required && value.length === 0) || value.length > SPACE_NAME_MAX_LENGTH) {
    throw new SpaceError("invalidSpaceName", `The name needs 1 to ${SPACE_NAME_MAX_LENGTH} characters`);
  }
  return value;
}

function cleanDescription(description: string): string {
  const value = description.trim();
  if (value.length > SPACE_DESCRIPTION_MAX_LENGTH) {
    throw new SpaceError(
      "invalidSpaceDescription",
      `The description can have up to ${SPACE_DESCRIPTION_MAX_LENGTH} characters`,
    );
  }
  return value;
}

export function cleanKey(key: string): string {
  const value = normalizeSpaceKey(key);
  if (!isValidSpaceKey(value)) {
    throw new SpaceError("invalidSpaceKey", "The key needs 2 to 10 letters or digits");
  }
  return value;
}

export interface CreateSpaceInput {
  name: string;
  key: string;
  description?: string;
  visibility: SpaceVisibility;
  grants: SpaceGrant[];
  confidential?: boolean | undefined;
}

export interface HolderValidation {
  validate(tx: Transaction, space: SpaceTarget, grant: SpaceGrant, actor: Principal): Promise<void>;
}

export interface SpaceTarget {
  id: string;
  organizationId: string | null;
  ownerId: string | null;
  confidential?: boolean;
}

export class SpaceService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #authorization: AuthorizationService;
  readonly #settings: SettingsService;
  readonly #people: PeopleService;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    authorization: AuthorizationService;
    settings: SettingsService;
    people: PeopleService;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#authorization = options.authorization;
    this.#settings = options.settings;
    this.#people = options.people;
  }

  async #find(executor: Executor, condition: SQL): Promise<Space | null> {
    const result = await executor.execute<SpaceRow>(
      sql`select ${SPACE_COLUMNS} from ${SPACE_FROM} where ${condition}`,
    );
    const row = result.rows[0];
    return row ? toSpace(row) : null;
  }

  async get(spaceId: string, executor: Executor = this.#database): Promise<Space | null> {
    return this.#find(executor, sql`s.id = ${spaceId}`);
  }

  async require(spaceId: string, executor: Executor = this.#database): Promise<Space> {
    const space = await this.get(spaceId, executor);
    if (!space) throw new SpaceError("spaceNotFound", "The space does not exist");
    return space;
  }

  async withRole(viewer: Principal, spaceId: string): Promise<SpaceWithRole | null> {
    const space = await this.get(spaceId);
    if (!space) return null;
    const role =
      viewer.type === "account" ? (await this.#authorization.spaceRole(viewer.id, spaceId)).role : null;
    const exporting = await this.#authorization.explain(viewer, "space.export", {
      type: "space",
      id: spaceId,
    });
    const mayExport = exporting.allowed || exporting.denials.includes("exportDisabled");
    return { ...space, role, mayExport };
  }

  async lock(tx: Transaction, spaceId: string): Promise<Space> {
    await tx.execute(sql`select id from spaces where id = ${spaceId} for update`);
    const space = await this.get(spaceId, tx);
    if (!space) throw new SpaceError("spaceNotFound", "The space does not exist");
    return space;
  }

  async resolveKey(key: string): Promise<{ space: Space; redirected: boolean } | null> {
    const normalized = normalizeSpaceKey(key);
    if (!isValidSpaceKey(normalized)) return null;
    const current = await this.#find(this.#database, sql`s.key = ${normalized}`);
    if (current) return { space: current, redirected: false };
    const alias = await this.#find(
      this.#database,
      sql`s.id = (select space_id from space_key_aliases where key = ${normalized})`,
    );
    return alias ? { space: alias, redirected: true } : null;
  }

  async list(
    viewer: Principal,
    options: {
      organizationId?: string | undefined;
      page?: PageRequest;
      archived?: boolean | undefined;
      oneOnOne?: boolean | undefined;
    } = {},
  ): Promise<Page<Space>> {
    const page = options.page ?? FIRST_PAGE;
    const term = page.search?.trim() ?? "";
    const pattern = `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const sortName = sql`lower(s.name)`;
    const result = await this.#database.execute<SpaceRow & { sort_name: string }>(sql`
      select ${SPACE_COLUMNS}, ${sortName} as sort_name from ${SPACE_FROM}
      where ${this.#authorization.spaceFilter(viewer, sql`s`)}
        ${options.organizationId ? sql`and s.organization_id = ${options.organizationId}` : sql``}
        and (s.archived_at is not null) = ${options.archived ?? false}
        and s.one_on_one = ${options.oneOnOne ?? false}
        ${term ? sql`and (s.name ilike ${pattern} or s.key ilike ${pattern} or s.description ilike ${pattern})` : sql``}
        ${page.after ? sql`and ${afterKey([sortName, sql`s.id`], page.after)}` : sql``}
      order by ${sortName}, s.id
      limit ${pageLimit(page)}`);
    return toPage(result.rows, page, (row) => [row.sort_name, row.id], toSpace);
  }

  async keyAvailable(key: string, executor: Executor = this.#database): Promise<boolean> {
    const result = await executor.execute<{ taken: boolean }>(
      sql`select exists (select 1 from spaces where key = ${key}) as taken`,
    );
    return result.rows[0]?.taken !== true;
  }

  async suggestKey(name: string): Promise<string> {
    for (const candidate of spaceKeyCandidates(suggestSpaceKey(name))) {
      if (await this.keyAvailable(candidate)) return candidate;
    }
    throw new SpaceError("keyTaken", "No free key could be found for this name");
  }

  async defaultPermissions(organizationId: string) {
    return this.#settings.get(defaultSpacePermissionsSetting, { organization: organizationId });
  }

  async setDefaultPermissions(
    actor: Principal,
    organizationId: string,
    value: DefaultSpacePermissions,
    holders: HolderValidation,
  ): Promise<void> {
    await this.#database.transaction(async (tx) => {
      for (const grant of value.grants) {
        await holders.validate(tx, { id: organizationId, organizationId, ownerId: null }, grant, actor);
      }
      await this.#settings.set(
        defaultSpacePermissionsSetting,
        { organization: organizationId },
        "organization",
        value,
        {
          tx,
        },
      );
    });
  }

  async create(
    actor: Principal,
    organizationId: string,
    input: CreateSpaceInput,
    holders: HolderValidation,
    options: { tx?: Transaction; oneOnOne?: boolean } = {},
  ): Promise<Space> {
    const name = cleanName(input.name, true);
    const key = cleanKey(input.key);
    const description = cleanDescription(input.description ?? "");
    const creatorId = actorIdOf(actor);
    const confidential = input.confidential === true || options.oneOnOne === true;
    if (confidential) {
      await this.#authorization.require(actor, "organization.spaces.createConfidential", {
        type: "organization",
        id: organizationId,
      });
      if (input.visibility !== "private") {
        throw new SpaceError("confidentialVisibility", "A confidential space is always private");
      }
    }
    const run = async (tx: Transaction) => {
      await tx.execute(sql`delete from space_key_aliases where key = ${key}`);
      const [space] = (
        await tx.execute<{ id: string }>(sql`
          insert into spaces (id, organization_id, key, name, description, visibility, confidential, one_on_one,
            created_by)
          values (${uuidv7()}, ${organizationId}, ${key}, ${name}, ${description}, ${input.visibility},
            ${confidential}, ${options.oneOnOne === true}, ${creatorId})
          returning id`)
      ).rows;
      if (!space) throw new Error("The space was not created");
      await insertDefaultPageStatuses(tx, space.id);
      const target: SpaceTarget = { id: space.id, organizationId, ownerId: null, confidential };
      const grants = mergeGrants(
        input.grants,
        creatorId ? [{ principalKind: "account", principalId: creatorId, role: "admin" }] : [],
      );
      for (const grant of grants) await holders.validate(tx, target, grant, actor);
      const scope = auditScopeOf(target);
      await this.#audit.record(tx, {
        name: "space.created",
        actor,
        targetId: space.id,
        fields: {
          name,
          key,
          visibility: input.visibility,
          personal: false,
          ownerId: null,
          ...(confidential ? { confidential: true } : {}),
        },
        scope,
      });
      await insertGrants(tx, this.#audit, actor, { ...target, name }, grants);
      const mode = await defaultPageMode(this.#settings, { id: space.id, organizationId });
      const overview = await insertPage(tx, {
        spaceId: space.id,
        parentId: null,
        title: name,
        actorId: creatorId,
        mode,
        published: mode === "publish",
      });
      await tx.execute(sql`update spaces set overview_item_id = ${overview} where id = ${space.id}`);
      await signalSpaceChange(tx, { spaceId: space.id, kind: "space", itemId: null });
      return this.require(space.id, tx);
    };
    try {
      return options.tx ? await run(options.tx) : await this.#database.transaction(run);
    } catch (error) {
      if (isUniqueViolation(error, "spaces_key_unique")) {
        throw new SpaceError("keyTaken", "Another space uses this key");
      }
      throw error;
    }
  }

  async update(
    actor: Principal,
    spaceId: string,
    changes: {
      name?: string | undefined;
      description?: string | undefined;
      discoverable?: boolean | undefined;
    },
  ): Promise<Space> {
    return this.#database.transaction(async (tx) => {
      const space = await this.lock(tx, spaceId);
      if (changes.discoverable !== undefined && changes.discoverable !== space.discoverable) {
        if (space.personal) {
          throw new SpaceError("personalSpaceVisibility", "Personal spaces cannot be found by others");
        }
        if (space.confidential && changes.discoverable) {
          throw new SpaceError(
            "confidentialVisibility",
            "A confidential space cannot be found by people who are not its members",
          );
        }
        await tx.execute(sql`update spaces set discoverable = ${changes.discoverable}, updated_at = now()
          where id = ${spaceId}`);
        await this.#audit.record(tx, {
          name: "space.updated",
          actor,
          targetId: spaceId,
          fields: {
            name: space.name,
            setting: "discoverable",
            value: String(changes.discoverable),
            previousValue: String(space.discoverable),
          },
          scope: auditScopeOf(space),
        });
      }
      const name = changes.name === undefined ? space.name : cleanName(changes.name, !space.personal);
      const description =
        changes.description === undefined ? space.description : cleanDescription(changes.description);
      await tx.execute(sql`update spaces set name = ${name}, description = ${description}, updated_at = now()
        where id = ${spaceId}`);
      const scope = auditScopeOf(space);
      if (name !== space.name) {
        await this.#audit.record(tx, {
          name: "space.updated",
          actor,
          targetId: spaceId,
          fields: { name, setting: "name", value: name, previousValue: space.name },
          scope,
        });
      }
      if (description !== space.description) {
        await this.#audit.record(tx, {
          name: "space.updated",
          actor,
          targetId: spaceId,
          fields: { name, setting: "description", value: description, previousValue: space.description },
          scope,
        });
      }
      await signalSpaceChange(tx, { spaceId, kind: "space", itemId: null });
      return this.require(spaceId, tx);
    });
  }

  async changeKey(actor: Principal, spaceId: string, newKey: string): Promise<Space> {
    const key = cleanKey(newKey);
    try {
      return await this.#database.transaction(async (tx) => {
        const space = await this.lock(tx, spaceId);
        if (space.key === key) return space;
        await tx.execute(sql`delete from space_key_aliases where key = ${key}`);
        await tx.execute(sql`update spaces set key = ${key}, updated_at = now() where id = ${spaceId}`);
        await tx.execute(sql`insert into space_key_aliases (key, space_id) values (${space.key}, ${spaceId})
          on conflict (key) do update set space_id = excluded.space_id, updated_at = now()`);
        await this.#audit.record(tx, {
          name: "space.updated",
          actor,
          targetId: spaceId,
          fields: { name: space.name, setting: "key", value: key, previousValue: space.key },
          scope: auditScopeOf(space),
        });
        await signalSpaceChange(tx, { spaceId, kind: "space", itemId: null });
        return this.require(spaceId, tx);
      });
    } catch (error) {
      if (isUniqueViolation(error, "spaces_key_unique")) {
        throw new SpaceError("keyTaken", "Another space uses this key");
      }
      throw error;
    }
  }

  async visibilityImpact(
    viewer: Principal,
    spaceId: string,
    visibility: SpaceVisibility,
  ): Promise<AccessImpact> {
    const space = await this.require(spaceId);
    const grants = await currentGrants(this.#database, spaceId);
    return accessImpact(
      this.#database,
      { organizationId: space.organizationId, visibility: space.visibility, grants },
      { organizationId: space.organizationId, visibility, grants },
      (account) => this.#people.visibleCondition(viewer, account),
    );
  }

  async changeVisibility(actor: Principal, spaceId: string, visibility: SpaceVisibility): Promise<Space> {
    return this.#database.transaction(async (tx) => {
      const space = await this.lock(tx, spaceId);
      if (space.personal && visibility !== "private") {
        throw new SpaceError("personalSpaceVisibility", "Personal spaces are always private");
      }
      if (space.confidential && visibility !== "private") {
        throw new SpaceError("confidentialVisibility", "A confidential space is always private");
      }
      if (space.visibility === visibility) return space;
      await tx.execute(
        sql`update spaces set visibility = ${visibility}, updated_at = now() where id = ${spaceId}`,
      );
      await this.#audit.record(tx, {
        name: "space.updated",
        actor,
        targetId: spaceId,
        fields: {
          name: space.name,
          setting: "visibility",
          value: visibility,
          previousValue: space.visibility,
        },
        scope: auditScopeOf(space),
      });
      await signalSpaceChange(tx, { spaceId, kind: "access", itemId: null });
      return this.require(spaceId, tx);
    });
  }

  async withoutAdministrator(organizationId: string, page: PageRequest = FIRST_PAGE): Promise<Page<Space>> {
    const sortName = sql`lower(s.name)`;
    const result = await this.#database.execute<SpaceRow & { sort_name: string }>(sql`
      select ${SPACE_COLUMNS}, ${sortName} as sort_name from ${SPACE_FROM}
      where s.organization_id = ${organizationId} and not s.confidential and not s.quarantined
        and not ${activeAdministratorCondition(storedGrants(sql`s.id`), sql`s.organization_id`)}
        ${page.after ? sql`and ${afterKey([sortName, sql`s.id`], page.after)}` : sql``}
      order by ${sortName}, s.id
      limit ${pageLimit(page)}`);
    return toPage(result.rows, page, (row) => [row.sort_name, row.id], toSpace);
  }

  async appointAdministrator(actor: Principal, spaceId: string, accountId: string): Promise<void> {
    if (actor.type === "account" && actor.id === accountId) {
      throw new SpaceError(
        "selfAppointment",
        "Appoint someone else; nobody can extend their own permissions",
      );
    }
    await this.#database.transaction(async (tx) => {
      const space = await this.lock(tx, spaceId);
      if (!space.organizationId) throw new SpaceError("spaceNotFound", "The space does not exist");
      const hasAdministrator = await tx.execute<{ present: boolean }>(sql`
        select ${activeAdministratorCondition(storedGrants(sql`${spaceId}::uuid`), sql`${space.organizationId}::uuid`)} as present`);
      if (space.quarantined) throw new SpaceError("spaceNotFound", "The space does not exist");
      if (space.confidential) {
        throw new SpaceError(
          "spaceNotFound",
          "Confidential spaces get a space admin only from their remaining members",
        );
      }
      if (hasAdministrator.rows[0]?.present) {
        throw new SpaceError(
          "spaceHasAdministrator",
          "The space has a space admin who manages its permissions",
        );
      }
      const candidate = await tx.execute<{ id: string }>(sql`
        select a.id from accounts a join memberships m on m.account_id = a.id
        where a.id = ${accountId} and a.state = 'active' and m.organization_id = ${space.organizationId}
          and (m.expires_at is null or m.expires_at > now())`);
      if (!candidate.rows[0]) {
        throw new SpaceError(
          "invalidHolder",
          "Only active people of the organization can become space admin",
        );
      }
      const previous = await tx.execute<{ role: SpaceRole }>(sql`
        select role from space_permissions
        where space_id = ${spaceId} and principal_kind = 'account' and principal_id = ${accountId}`);
      await tx.execute(sql`
        insert into space_permissions (id, space_id, principal_kind, principal_id, role, created_by)
        values (${uuidv7()}, ${spaceId}, 'account', ${accountId}, 'admin', ${actorIdOf(actor)})
        on conflict on constraint space_permissions_holder_unique
        do update set role = 'admin', updated_at = now()`);
      await this.#audit.record(tx, {
        name: "space.administratorAppointed",
        actor,
        targetId: spaceId,
        fields: { name: space.name, accountId },
        scope: auditScopeOf(space),
      });
      const before = previous.rows[0]?.role;
      const fields = {
        name: space.name,
        principalKind: "account" as const,
        principalId: accountId,
        role: "admin" as const,
      };
      if (before) {
        await this.#audit.record(tx, {
          name: "space.permissionChanged",
          actor,
          targetId: spaceId,
          fields: { ...fields, previousRole: before },
          scope: auditScopeOf(space),
        });
      } else {
        await this.#audit.record(tx, {
          name: "space.permissionGranted",
          actor,
          targetId: spaceId,
          fields,
          scope: auditScopeOf(space),
        });
      }
      await signalSpaceChange(tx, { spaceId, kind: "access", itemId: null });
    });
  }

  get people(): PeopleService {
    return this.#people;
  }
}

export async function insertGrants(
  tx: Transaction,
  audit: AuditLog,
  actor: Principal,
  space: SpaceTarget & { name: string },
  grants: SpaceGrant[],
): Promise<void> {
  for (const grant of grants) {
    await tx.execute(sql`
      insert into space_permissions (id, space_id, principal_kind, principal_id, role, created_by)
      values (${uuidv7()}, ${space.id}, ${grant.principalKind}, ${grant.principalId}, ${grant.role}, ${actorIdOf(actor)})`);
    await audit.record(tx, {
      name: "space.permissionGranted",
      actor,
      targetId: space.id,
      fields: { name: space.name, ...grant },
      scope: auditScopeOf(space),
    });
  }
}
