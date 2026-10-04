import { emailSchema } from "@pagehall/shared";
import { and, asc, count, eq, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import { type AccountService, EmailInUseError } from "../accounts/accounts.js";
import type { AccountAdministrationService } from "../accounts/administration.js";
import type { AccountLifecycleService } from "../accounts/lifecycle.js";
import { SYSTEM } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { RateLimiter } from "../auth/throttle.js";
import type { Database } from "../database/database.js";
import type { MembershipService } from "../organizations/memberships.js";
import type { OrganizationService } from "../organizations/organizations.js";
import type { ProviderDefinition } from "./adapter.js";
import { emptyReport, type GroupMappingService, type SyncReport } from "./groups.js";
import type { IdentityProviderService } from "./providers.js";
import { identities, identityGroups, providerGroups, providerSyncRuns } from "./schema.js";
import {
  listResponse,
  type PatchOperation,
  parseFilter,
  parsePatch,
  SCIM_SCHEMAS,
  ScimError,
  scimBoolean,
  scimText,
} from "./scim-protocol.js";

export const SCIM_REQUESTS_PER_MINUTE = 1200;
const DEFAULT_COUNT = 100;
const MAX_COUNT = 200;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ScimPage {
  startIndex?: number | undefined;
  count?: number | undefined;
  filter?: string | undefined;
}

interface UserInput {
  userName?: string;
  externalId?: string;
  active?: boolean;
  displayName?: string;
  email?: string | null;
}

interface IdentityRow {
  id: string;
  accountId: string;
  subject: string;
  email: string | null;
  signInName: string | null;
  displayName: string | null;
  scimUserName: string | null;
  scimExternalId: string | null;
  createdAt: Date;
  updatedAt: Date;
  state: string;
}

const identityColumns = {
  id: identities.id,
  accountId: identities.accountId,
  subject: identities.subject,
  email: identities.email,
  signInName: identities.signInName,
  displayName: identities.displayName,
  scimUserName: identities.scimUserName,
  scimExternalId: identities.scimExternalId,
  createdAt: identities.createdAt,
  updatedAt: identities.updatedAt,
  state: accounts.state,
};

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: unknown }).cause ?? error;
  return (cause as { code?: string }).code === "23505" || error instanceof EmailInUseError;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emailOf(value: unknown): string | null | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter(
    (entry): entry is { value: string; type?: unknown; primary?: unknown } =>
      typeof (entry as { value?: unknown } | null)?.value === "string",
  );
  const chosen =
    entries.find((entry) => entry.primary === true || entry.primary === "True" || entry.primary === "true") ??
    entries.find((entry) => entry.type === "work") ??
    entries[0];
  return chosen ? chosen.value.trim() : null;
}

function nameOf(value: unknown): string | undefined {
  const name = (value ?? {}) as { formatted?: unknown; givenName?: unknown; familyName?: unknown };
  if (typeof name.formatted === "string" && name.formatted.trim()) return name.formatted.trim();
  const parts = [name.givenName, name.familyName].filter(
    (part): part is string => typeof part === "string" && part.trim() !== "",
  );
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function userInput(body: unknown): UserInput {
  const source = (body ?? {}) as Record<string, unknown>;
  const input: UserInput = {};
  if (source.userName !== undefined) input.userName = scimText(source.userName, "userName", 320);
  if (source.externalId !== undefined && source.externalId !== null) {
    input.externalId = scimText(source.externalId, "externalId", 256);
  }
  if (source.active !== undefined) input.active = scimBoolean(source.active);
  const displayName =
    typeof source.displayName === "string" && source.displayName.trim()
      ? source.displayName.trim()
      : nameOf(source.name);
  if (displayName !== undefined) input.displayName = displayName.slice(0, 200);
  const email = emailOf(source.emails);
  if (email !== undefined) input.email = email;
  return input;
}

function applyUserOperation(input: UserInput, operation: PatchOperation): void {
  if (operation.path === null) {
    if (operation.op === "remove") throw new ScimError(400, "noTarget", "A remove operation needs a path");
    const value = (operation.value ?? {}) as Record<string, unknown>;
    if (typeof value !== "object") throw new ScimError(400, "invalidValue", "The value must be an object");
    for (const [key, item] of Object.entries(value)) {
      applyUserOperation(input, { op: operation.op, path: key, value: item });
    }
    return;
  }
  const path = operation.path.toLowerCase();
  const removing = operation.op === "remove";
  if (path === "active") {
    if (!removing) input.active = scimBoolean(operation.value);
  } else if (path === "username") {
    if (removing) throw new ScimError(400, "mutability", "userName cannot be removed");
    input.userName = scimText(operation.value, "userName", 320);
  } else if (path === "displayname" || path === "name.formatted") {
    if (!removing) input.displayName = scimText(operation.value, "displayName", 200);
  } else if (path === "externalid") {
    if (!removing) input.externalId = scimText(operation.value, "externalId", 256);
  } else if (path === "name") {
    const name = nameOf(operation.value);
    if (!removing && name) input.displayName = name.slice(0, 200);
  } else if (path === "emails") {
    input.email = removing
      ? null
      : (emailOf(Array.isArray(operation.value) ? operation.value : [operation.value]) ?? null);
  } else if (/^emails\[.*\]\.value$/.test(path) || /^emails\[.*\]$/.test(path)) {
    input.email = removing
      ? null
      : typeof operation.value === "string"
        ? operation.value.trim()
        : (emailOf([operation.value]) ?? null);
  }
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

export class ScimService {
  readonly #database: Database;
  readonly #providers: IdentityProviderService;
  readonly #accounts: AccountService;
  readonly #organizations: OrganizationService;
  readonly #mapping: GroupMappingService;
  readonly #memberships: MembershipService;
  readonly #administration: AccountAdministrationService;
  readonly #lifecycle: AccountLifecycleService;
  readonly #audit: AuditLog;
  readonly #rateLimiter: RateLimiter;

  constructor(options: {
    database: Database;
    providers: IdentityProviderService;
    accounts: AccountService;
    organizations: OrganizationService;
    mapping: GroupMappingService;
    memberships: MembershipService;
    administration: AccountAdministrationService;
    lifecycle: AccountLifecycleService;
    audit: AuditLog;
    rateLimiter: RateLimiter;
  }) {
    this.#database = options.database;
    this.#providers = options.providers;
    this.#accounts = options.accounts;
    this.#organizations = options.organizations;
    this.#mapping = options.mapping;
    this.#memberships = options.memberships;
    this.#administration = options.administration;
    this.#lifecycle = options.lifecycle;
    this.#audit = options.audit;
    this.#rateLimiter = options.rateLimiter;
  }

  async admit(providerId: string): Promise<ProviderDefinition> {
    const limit = await this.#rateLimiter.consume(
      `scim:provider:${providerId}`,
      SCIM_REQUESTS_PER_MINUTE,
      60,
    );
    if (!limit.allowed) {
      throw new ScimError(
        429,
        "tooMany",
        "Too many SCIM requests for this provider",
        limit.retryAfterSeconds,
      );
    }
    const loaded = await this.#providers.definition(providerId);
    if (!loaded) throw new ScimError(404, null, "The identity provider does not exist");
    if (!loaded.active) throw new ScimError(403, null, "The identity provider is deactivated in Pagehall");
    return loaded.provider;
  }

  #subjectOf(provider: ProviderDefinition, externalId: string | undefined, userName: string): string {
    if (provider.config.preset === "entraId" && "tenantId" in provider.config) {
      if (!externalId || !GUID.test(externalId)) {
        throw new ScimError(
          400,
          "invalidValue",
          "externalId must be the object ID of the user; map objectId to externalId in the attribute mappings",
        );
      }
      return `${provider.config.tenantId}:${externalId.toLowerCase()}`;
    }
    const identifier = externalId ?? userName;
    return GUID.test(identifier) ? identifier.toLowerCase() : identifier;
  }

  #verifiedEmail(provider: ProviderDefinition, email: string | null | undefined): string {
    const parsed = email ? emailSchema.safeParse(email) : null;
    if (!parsed?.success) throw new ScimError(400, "invalidValue", "The user needs an e-mail address");
    if (!provider.config.domains.includes(domainOf(parsed.data))) {
      throw new ScimError(
        400,
        "invalidValue",
        "The domain of the e-mail address does not belong to this provider",
      );
    }
    return parsed.data;
  }

  #location(base: string, kind: "Users" | "Groups", id: string): string {
    return `${base}/${kind}/${id}`;
  }

  #user(base: string, row: IdentityRow) {
    return {
      schemas: [SCIM_SCHEMAS.user],
      id: row.id,
      ...(row.scimExternalId ? { externalId: row.scimExternalId } : {}),
      userName: row.scimUserName ?? row.signInName ?? row.email ?? row.subject,
      active: row.state === "active",
      ...(row.displayName ? { displayName: row.displayName, name: { formatted: row.displayName } } : {}),
      emails: row.email ? [{ value: row.email, type: "work", primary: true }] : [],
      meta: {
        resourceType: "User",
        created: row.createdAt.toISOString(),
        lastModified: row.updatedAt.toISOString(),
        location: this.#location(base, "Users", row.id),
      },
    };
  }

  #identityQuery(providerId: string, condition?: SQL) {
    return this.#database
      .select(identityColumns)
      .from(identities)
      .innerJoin(accounts, eq(accounts.id, identities.accountId))
      .where(and(eq(identities.providerId, providerId), condition));
  }

  async #identity(providerId: string, id: string): Promise<IdentityRow> {
    if (!GUID.test(id)) throw new ScimError(404, null, "The user does not exist");
    const [row] = await this.#identityQuery(providerId, eq(identities.id, id.toLowerCase()));
    if (!row) throw new ScimError(404, null, "The user does not exist");
    return row;
  }

  #window(page: ScimPage) {
    const startIndex = Math.max(1, Math.floor(page.startIndex ?? 1));
    const limit = Math.min(Math.max(0, Math.floor(page.count ?? DEFAULT_COUNT)), MAX_COUNT);
    return { startIndex, limit, offset: startIndex - 1 };
  }

  async listUsers(providerId: string, base: string, page: ScimPage) {
    const provider = await this.admit(providerId);
    const filter = parseFilter(page.filter, ["userName", "externalId", "id", "emails.value"]);
    let condition: SQL | undefined;
    if (filter?.attribute === "userName") {
      condition = sql`lower(coalesce(${identities.scimUserName}, ${identities.signInName}, ${identities.email})) = lower(${filter.value})`;
    } else if (filter?.attribute === "externalId") {
      let subject: string | null = null;
      try {
        subject = this.#subjectOf(provider, filter.value, filter.value);
      } catch {
        subject = null;
      }
      condition = or(
        eq(identities.scimExternalId, filter.value),
        subject ? eq(identities.subject, subject) : undefined,
      );
    } else if (filter?.attribute === "id") {
      condition = GUID.test(filter.value) ? eq(identities.id, filter.value) : sql`false`;
    } else if (filter?.attribute === "emails.value") {
      condition = sql`lower(${identities.email}) = lower(${filter.value})`;
    }
    const { startIndex, limit, offset } = this.#window(page);
    const [total] = await this.#database
      .select({ value: count() })
      .from(identities)
      .where(and(eq(identities.providerId, providerId), condition));
    const rows =
      limit === 0
        ? []
        : await this.#identityQuery(providerId, condition)
            .orderBy(asc(identities.createdAt), asc(identities.id))
            .limit(limit)
            .offset(offset);
    return listResponse(
      rows.map((row) => this.#user(base, row)),
      Number(total?.value ?? 0),
      startIndex,
    );
  }

  async getUser(providerId: string, base: string, id: string) {
    await this.admit(providerId);
    return this.#user(base, await this.#identity(providerId, id));
  }

  async createUser(providerId: string, base: string, body: unknown) {
    const provider = await this.admit(providerId);
    const input = userInput(body);
    if (!input.userName) throw new ScimError(400, "invalidValue", "userName is required");
    const userName = input.userName;
    return this.#logged(provider.id, async (report) => {
      const subject = this.#subjectOf(provider, input.externalId, userName);
      const email = this.#verifiedEmail(provider, input.email);
      const created = await this.#database
        .transaction(async (tx) => {
          const [taken] = await tx
            .select({ id: identities.id })
            .from(identities)
            .where(
              and(
                eq(identities.providerId, provider.id),
                or(
                  eq(identities.subject, subject),
                  sql`lower(${identities.scimUserName}) = lower(${userName})`,
                ),
              ),
            );
          if (taken)
            throw new ScimError(409, "uniqueness", "A user with this userName or externalId exists already");
          const existing = await this.#accounts.findByEmail(email, tx);
          if (existing && existing.state !== "placeholder") {
            throw new ScimError(
              409,
              "uniqueness",
              "An account with this e-mail address exists already; it is linked when the person signs in through the provider",
            );
          }
          const home = await this.#organizations.organizationForEmail(email, tx);
          const name = input.displayName ?? userName;
          let accountId: string;
          if (existing) {
            if (
              !(await this.#lifecycle.adoptPlaceholder(tx, existing.id, { name, homeOrganizationId: home }))
            ) {
              throw new ScimError(
                409,
                "uniqueness",
                "The placeholder with this e-mail address cannot be taken over",
              );
            }
            accountId = existing.id;
          } else {
            accountId = (
              await this.#accounts.createFromProvider(tx, { email, name, homeOrganizationId: home })
            ).id;
          }
          const [identity] = await tx
            .insert(identities)
            .values({
              accountId,
              providerId: provider.id,
              subject,
              email,
              emailVerified: true,
              signInName: userName,
              displayName: input.displayName ?? null,
              scimUserName: userName,
              scimExternalId: input.externalId ?? null,
            })
            .returning({ id: identities.id });
          if (!identity) throw new Error("The identity was not stored");
          await this.#mapping.reconcile(tx, accountId, report);
          const scope = home ? { scope: { type: "organization" as const, id: home } } : {};
          await this.#audit.record(tx, {
            name: "identity.linked",
            actor: SYSTEM,
            targetId: accountId,
            fields: { providerId: provider.id, via: "scim" },
            ...scope,
          });
          await this.#audit.record(tx, {
            name: "scim.userChanged",
            actor: SYSTEM,
            targetId: accountId,
            fields: { providerId: provider.id, operation: "created", attributes: Object.keys(input).sort() },
            ...scope,
          });
          report.changes.push({ kind: "accountCreated", accountId, organizationId: home, detail: null });
          return { identityId: identity.id, accountId };
        })
        .catch((error: unknown) => {
          if (error instanceof ScimError) throw error;
          if (isUniqueViolation(error)) {
            throw new ScimError(
              409,
              "uniqueness",
              "A user with this userName, externalId or e-mail address exists already",
            );
          }
          throw error;
        });
      if (input.active === false)
        await this.#setActive(provider.id, created.accountId, false, "disabled", report);
      return this.#user(base, await this.#identity(provider.id, created.identityId));
    });
  }

  async replaceUser(providerId: string, base: string, id: string, body: unknown) {
    const provider = await this.admit(providerId);
    return this.#logged(provider.id, async (report) => {
      const identity = await this.#identity(provider.id, id);
      await this.#updateUser(provider, identity, userInput(body), report);
      return this.#user(base, await this.#identity(provider.id, id));
    });
  }

  async patchUser(providerId: string, base: string, id: string, body: unknown) {
    const provider = await this.admit(providerId);
    const operations = parsePatch(body);
    return this.#logged(provider.id, async (report) => {
      const identity = await this.#identity(provider.id, id);
      const input: UserInput = {};
      for (const operation of operations) applyUserOperation(input, operation);
      await this.#updateUser(provider, identity, input, report);
      return this.#user(base, await this.#identity(provider.id, id));
    });
  }

  async deleteUser(providerId: string, id: string): Promise<void> {
    const provider = await this.admit(providerId);
    await this.#logged(provider.id, async (report) => {
      const identity = await this.#identity(provider.id, id);
      await this.#setActive(provider.id, identity.accountId, false, "deleted", report);
    });
  }

  async #updateUser(
    provider: ProviderDefinition,
    identity: IdentityRow,
    input: UserInput,
    report: SyncReport,
  ) {
    if (
      input.externalId !== undefined &&
      identity.scimExternalId !== null &&
      input.externalId !== identity.scimExternalId
    ) {
      throw new ScimError(400, "mutability", "externalId cannot change");
    }
    const email =
      input.email === undefined
        ? undefined
        : input.email === null
          ? null
          : this.#verifiedEmail(provider, input.email);
    const changes: Record<string, string | null> = {};
    if (input.userName !== undefined && input.userName !== identity.scimUserName)
      changes.scimUserName = input.userName;
    if (input.userName !== undefined && input.userName !== identity.signInName)
      changes.signInName = input.userName;
    if (input.displayName !== undefined && input.displayName !== identity.displayName)
      changes.displayName = input.displayName;
    if (email !== undefined && email !== identity.email) changes.email = email;
    if (input.externalId !== undefined && identity.scimExternalId === null)
      changes.scimExternalId = input.externalId;
    if (Object.keys(changes).length > 0) {
      try {
        await this.#database.transaction(async (tx) => {
          await tx
            .update(identities)
            .set({
              ...changes,
              ...(email !== undefined ? { emailVerified: email !== null } : {}),
              updatedAt: new Date(),
            })
            .where(eq(identities.id, identity.id));
          await this.#audit.record(tx, {
            name: "scim.userChanged",
            actor: SYSTEM,
            targetId: identity.accountId,
            fields: {
              providerId: provider.id,
              operation: "updated",
              attributes: Object.keys(changes)
                .map((key) =>
                  key === "scimUserName" || key === "signInName"
                    ? "userName"
                    : key === "scimExternalId"
                      ? "externalId"
                      : key,
                )
                .filter((key, index, all) => all.indexOf(key) === index)
                .sort(),
            },
          });
        });
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ScimError(409, "uniqueness", "Another user has this userName already");
        throw error;
      }
      report.changes.push({
        kind: "profileUpdated",
        accountId: identity.accountId,
        organizationId: null,
        detail: null,
      });
    }
    if (input.active !== undefined) {
      await this.#setActive(provider.id, identity.accountId, input.active, "disabled", report);
    }
  }

  async #setActive(
    providerId: string,
    accountId: string,
    active: boolean,
    state: "disabled" | "deleted",
    report: SyncReport,
  ): Promise<void> {
    const [account] = await this.#database
      .select({ state: accounts.state })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    if (!active && account?.state === "active") {
      try {
        await this.#memberships.deactivate(SYSTEM, accountId, { byProvider: { providerId, state } });
      } catch (error) {
        report.warnings.push({
          kind: "deactivationRefused",
          accountId,
          ruleId: null,
          detail: message(error),
        });
        throw new ScimError(400, "mutability", `The account cannot be deactivated: ${message(error)}`);
      }
      report.changes.push({ kind: "accountDeactivated", accountId, organizationId: null, detail: state });
      await this.#audit.recordAlone({
        name: "scim.userChanged",
        actor: SYSTEM,
        targetId: accountId,
        fields: { providerId, operation: "deactivated", attributes: ["active"] },
      });
    }
    if (active && account?.state === "deactivated") {
      if (!(await this.#administration.reactivate(SYSTEM, accountId, { byProvider: providerId }))) return;
      report.changes.push({ kind: "accountReactivated", accountId, organizationId: null, detail: null });
      await this.#audit.recordAlone({
        name: "scim.userChanged",
        actor: SYSTEM,
        targetId: accountId,
        fields: { providerId, operation: "reactivated", attributes: ["active"] },
      });
      await this.#database.transaction((tx) => this.#mapping.reconcile(tx, accountId, report));
    }
  }

  async #group(providerId: string, id: string) {
    if (!GUID.test(id)) throw new ScimError(404, null, "The group does not exist");
    const [row] = await this.#database
      .select()
      .from(providerGroups)
      .where(
        and(
          eq(providerGroups.id, id.toLowerCase()),
          eq(providerGroups.providerId, providerId),
          isNull(providerGroups.missingSince),
        ),
      );
    if (!row) throw new ScimError(404, null, "The group does not exist");
    return row;
  }

  async #groupResource(base: string, group: typeof providerGroups.$inferSelect, withMembers: boolean) {
    const members = withMembers
      ? await this.#database
          .select({ value: identities.id, display: identities.displayName })
          .from(identityGroups)
          .innerJoin(identities, eq(identities.id, identityGroups.identityId))
          .where(eq(identityGroups.groupId, group.id))
          .orderBy(asc(identities.id))
      : [];
    return {
      schemas: [SCIM_SCHEMAS.group],
      id: group.id,
      externalId: group.externalId,
      displayName: group.name ?? group.externalId,
      ...(withMembers
        ? {
            members: members.map((member) => ({
              value: member.value,
              ...(member.display ? { display: member.display } : {}),
            })),
          }
        : {}),
      meta: {
        resourceType: "Group",
        created: group.createdAt.toISOString(),
        lastModified: group.updatedAt.toISOString(),
        location: this.#location(base, "Groups", group.id),
      },
    };
  }

  async listGroups(providerId: string, base: string, page: ScimPage, withMembers: boolean) {
    await this.admit(providerId);
    const filter = parseFilter(page.filter, ["displayName", "externalId", "id"]);
    const condition = and(
      eq(providerGroups.providerId, providerId),
      isNull(providerGroups.missingSince),
      filter?.attribute === "displayName"
        ? sql`lower(coalesce(${providerGroups.name}, ${providerGroups.externalId})) = lower(${filter.value})`
        : filter?.attribute === "externalId"
          ? eq(providerGroups.externalId, filter.value)
          : filter?.attribute === "id"
            ? GUID.test(filter.value)
              ? eq(providerGroups.id, filter.value)
              : sql`false`
            : undefined,
    );
    const { startIndex, limit, offset } = this.#window(page);
    const [total] = await this.#database.select({ value: count() }).from(providerGroups).where(condition);
    const rows =
      limit === 0
        ? []
        : await this.#database
            .select()
            .from(providerGroups)
            .where(condition)
            .orderBy(asc(providerGroups.createdAt), asc(providerGroups.id))
            .limit(limit)
            .offset(offset);
    const resources = [];
    for (const row of rows) resources.push(await this.#groupResource(base, row, withMembers));
    return listResponse(resources, Number(total?.value ?? 0), startIndex);
  }

  async getGroup(providerId: string, base: string, id: string, withMembers: boolean) {
    await this.admit(providerId);
    return this.#groupResource(base, await this.#group(providerId, id), withMembers);
  }

  async createGroup(providerId: string, base: string, body: unknown) {
    const provider = await this.admit(providerId);
    const source = (body ?? {}) as Record<string, unknown>;
    const name = scimText(source.displayName, "displayName", 256);
    const externalId =
      source.externalId === undefined || source.externalId === null
        ? name
        : scimText(source.externalId, "externalId", 256);
    return this.#logged(provider.id, async (report) => {
      const group = await this.#database.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(providerGroups)
          .where(and(eq(providerGroups.providerId, provider.id), eq(providerGroups.externalId, externalId)))
          .for("update");
        if (existing && existing.missingSince === null) {
          throw new ScimError(409, "uniqueness", "A group with this externalId exists already");
        }
        const [stored] = existing
          ? await tx
              .update(providerGroups)
              .set({ name, missingSince: null, seenAt: new Date(), updatedAt: new Date() })
              .where(eq(providerGroups.id, existing.id))
              .returning()
          : await tx
              .insert(providerGroups)
              .values({ providerId: provider.id, externalId, name, seenAt: new Date() })
              .returning();
        if (!stored) throw new Error("The group was not stored");
        await this.#audit.record(tx, {
          name: "scim.groupChanged",
          actor: SYSTEM,
          targetId: provider.id,
          fields: {
            groupId: stored.id,
            externalId,
            name,
            operation: "created",
            membersAdded: 0,
            membersRemoved: 0,
          },
        });
        report.changes.push({ kind: "groupCreated", accountId: null, organizationId: null, detail: name });
        return stored;
      });
      const members = Array.isArray(source.members) ? this.#memberIds(source.members) : [];
      if (members.length > 0) await this.#changeMembers(provider.id, group, members, [], report);
      return this.#groupResource(base, await this.#group(provider.id, group.id), true);
    });
  }

  async replaceGroup(providerId: string, base: string, id: string, body: unknown) {
    const provider = await this.admit(providerId);
    const source = (body ?? {}) as Record<string, unknown>;
    return this.#logged(provider.id, async (report) => {
      const group = await this.#group(provider.id, id);
      if (source.displayName !== undefined)
        await this.#rename(provider.id, group, scimText(source.displayName, "displayName", 256), report);
      if (Array.isArray(source.members)) {
        const wanted = new Set(this.#memberIds(source.members));
        const current = await this.#memberIdsOf(group.id);
        await this.#changeMembers(
          provider.id,
          group,
          [...wanted].filter((member) => !current.has(member)),
          [...current].filter((member) => !wanted.has(member)),
          report,
        );
      }
      return this.#groupResource(base, await this.#group(provider.id, id), true);
    });
  }

  async patchGroup(providerId: string, base: string, id: string, body: unknown) {
    const provider = await this.admit(providerId);
    const operations = parsePatch(body);
    return this.#logged(provider.id, async (report) => {
      const group = await this.#group(provider.id, id);
      const add: string[] = [];
      const remove: string[] = [];
      let replace: string[] | null = null;
      let rename: string | null = null;
      for (const operation of operations) {
        const path = operation.path?.toLowerCase() ?? null;
        if (path === null) {
          const value = (operation.value ?? {}) as Record<string, unknown>;
          if (typeof value.displayName === "string") rename = scimText(value.displayName, "displayName", 256);
          if (Array.isArray(value.members)) {
            if (operation.op === "add") add.push(...this.#memberIds(value.members));
            else replace = this.#memberIds(value.members);
          }
          continue;
        }
        if (path === "displayname") {
          if (operation.op !== "remove") rename = scimText(operation.value, "displayName", 256);
          continue;
        }
        if (path === "externalid") continue;
        const filtered = /^members\[\s*value\s+eq\s+"([^"]+)"\s*\]$/i.exec(operation.path ?? "");
        if (filtered?.[1]) {
          if (operation.op !== "remove")
            throw new ScimError(400, "invalidPath", "Members are added through the path members");
          remove.push(filtered[1]);
          continue;
        }
        if (path === "members") {
          const values =
            operation.value === undefined || operation.value === null
              ? []
              : this.#memberIds(Array.isArray(operation.value) ? operation.value : [operation.value]);
          if (operation.op === "add") add.push(...values);
          else if (operation.op === "remove") {
            if (values.length === 0) replace = [];
            else remove.push(...values);
          } else replace = values;
          continue;
        }
        throw new ScimError(400, "invalidPath", `The path ${operation.path} is not supported for groups`);
      }
      if (rename) await this.#rename(provider.id, group, rename, report);
      if (replace !== null) {
        const wanted = new Set([...replace, ...add].filter((member) => !remove.includes(member)));
        const current = await this.#memberIdsOf(group.id);
        await this.#changeMembers(
          provider.id,
          group,
          [...wanted].filter((member) => !current.has(member)),
          [...current].filter((member) => !wanted.has(member)),
          report,
        );
      } else if (add.length > 0 || remove.length > 0) {
        await this.#changeMembers(provider.id, group, add, remove, report);
      }
      return this.#groupResource(base, await this.#group(provider.id, id), true);
    });
  }

  async deleteGroup(providerId: string, id: string): Promise<void> {
    const provider = await this.admit(providerId);
    await this.#logged(provider.id, async (report) => {
      const group = await this.#group(provider.id, id);
      const members = await this.#memberIdsOf(group.id);
      await this.#changeMembers(provider.id, group, [], [...members], report);
      await this.#database.transaction(async (tx) => {
        await tx
          .update(providerGroups)
          .set({ missingSince: new Date(), updatedAt: new Date() })
          .where(eq(providerGroups.id, group.id));
        await this.#audit.record(tx, {
          name: "scim.groupChanged",
          actor: SYSTEM,
          targetId: provider.id,
          fields: {
            groupId: group.id,
            externalId: group.externalId,
            name: group.name,
            operation: "deleted",
            membersAdded: 0,
            membersRemoved: members.size,
          },
        });
      });
      report.changes.push({
        kind: "groupDeleted",
        accountId: null,
        organizationId: null,
        detail: group.name ?? group.externalId,
      });
    });
  }

  #memberIds(values: unknown[]): string[] {
    return values.flatMap((value) => {
      const id = (value as { value?: unknown } | null)?.value;
      return typeof id === "string" && id.trim() ? [id.trim().toLowerCase()] : [];
    });
  }

  async #memberIdsOf(groupId: string): Promise<Set<string>> {
    const rows = await this.#database
      .select({ identityId: identityGroups.identityId })
      .from(identityGroups)
      .where(eq(identityGroups.groupId, groupId));
    return new Set(rows.map((row) => row.identityId));
  }

  async #rename(
    providerId: string,
    group: typeof providerGroups.$inferSelect,
    name: string,
    report: SyncReport,
  ) {
    if (name === group.name) return;
    await this.#database.transaction(async (tx) => {
      await tx
        .update(providerGroups)
        .set({ name, seenAt: new Date(), updatedAt: new Date() })
        .where(eq(providerGroups.id, group.id));
      report.changes.push({
        kind: "groupRenamed",
        accountId: null,
        organizationId: null,
        detail: `${group.name ?? group.externalId} → ${name}`,
      });
      await this.#mapping.renameManagedGroups(tx, group.id, name, report);
      await this.#audit.record(tx, {
        name: "scim.groupChanged",
        actor: SYSTEM,
        targetId: providerId,
        fields: {
          groupId: group.id,
          externalId: group.externalId,
          name,
          operation: "updated",
          membersAdded: 0,
          membersRemoved: 0,
        },
      });
    });
  }

  async #changeMembers(
    providerId: string,
    group: typeof providerGroups.$inferSelect,
    add: string[],
    remove: string[],
    report: SyncReport,
  ): Promise<void> {
    const requested = [...new Set([...add, ...remove])].filter((id) => GUID.test(id));
    const known =
      requested.length === 0
        ? []
        : await this.#database
            .select({ id: identities.id, accountId: identities.accountId })
            .from(identities)
            .where(and(eq(identities.providerId, providerId), inArray(identities.id, requested)));
    const accountOf = new Map(known.map((row) => [row.id, row.accountId]));
    for (const id of new Set([...add, ...remove])) {
      if (!accountOf.has(id)) {
        report.warnings.push({ kind: "memberUnknown", accountId: null, ruleId: null, detail: id });
      }
    }
    let added = 0;
    let removed = 0;
    const touched = [...accountOf.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    for (const [identityId, accountId] of touched) {
      await this.#database.transaction(async (tx) => {
        await tx
          .select({ id: identities.id })
          .from(identities)
          .where(eq(identities.id, identityId))
          .for("update");
        if (remove.includes(identityId)) {
          const deleted = await tx
            .delete(identityGroups)
            .where(and(eq(identityGroups.identityId, identityId), eq(identityGroups.groupId, group.id)))
            .returning({ identityId: identityGroups.identityId });
          removed += deleted.length;
        } else {
          const inserted = await tx
            .insert(identityGroups)
            .values({ identityId, groupId: group.id })
            .onConflictDoNothing()
            .returning({ identityId: identityGroups.identityId });
          added += inserted.length;
        }
        await tx
          .update(identities)
          .set({ groupsReadAt: new Date(), groupsReadFailedAt: null, groupsWithheldNotifiedAt: null })
          .where(eq(identities.id, identityId));
        await this.#mapping.reconcile(tx, accountId, report);
      });
    }
    if (added + removed === 0) return;
    await this.#audit.recordAlone({
      name: "scim.groupChanged",
      actor: SYSTEM,
      targetId: providerId,
      fields: {
        groupId: group.id,
        externalId: group.externalId,
        name: group.name,
        operation: "updated",
        membersAdded: added,
        membersRemoved: removed,
      },
    });
  }

  async #logged<T>(providerId: string, work: (report: SyncReport) => Promise<T>): Promise<T> {
    const report = emptyReport();
    const started = new Date();
    let failure: unknown = null;
    try {
      return await work(report);
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      await this.#mapping.dispatch(report.mailIds);
      if (failure !== null || report.changes.length > 0 || report.warnings.length > 0) {
        await this.#database.insert(providerSyncRuns).values({
          providerId,
          trigger: "scim",
          status: failure !== null ? "failed" : report.warnings.length > 0 ? "warnings" : "succeeded",
          startedAt: started,
          heartbeatAt: new Date(),
          finishedAt: new Date(),
          changes: report.changes,
          warnings: report.warnings,
          error: failure === null ? null : message(failure).slice(0, 500),
        });
      }
    }
  }
}
