import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  type ContentLevel,
  contentLevels,
  type Principal,
  SYSTEM,
  type TokenGrant,
  type TokenScopes,
} from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import { accountScopeChain } from "../accounts/scope.js";
import type { AuditLog } from "../audit/audit-log.js";
import { RateLimitedError } from "../auth/errors.js";
import { clientSubject, type RateLimiter } from "../auth/throttle.js";
import { hashToken } from "../auth/tokens.js";
import { intersectAreas } from "../authorization/areas.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import { afterKey, FIRST_PAGE, type Page, type PageRequest, pageLimit, toPage } from "../database/keyset.js";
import { defineJob } from "../jobs/job-queue.js";
import type { NotificationService } from "../notifications/service.js";
import { memberships } from "../organizations/access-schema.js";
import { OrganizationError } from "../organizations/organizations.js";
import type { ScopeChain, SettingsService } from "../settings/service.js";
import { apiTokenPrefix, generateApiToken, isValidApiTokenFormat } from "./format.js";
import { apiTokens, serviceAccounts } from "./schema.js";
import {
  tokenExpiryReminderDaysSetting,
  tokenMaxLifetimeSetting,
  tokenRequestsPerMinuteSetting,
  tokenUnusedNoticeDaysSetting,
} from "./settings.js";

export const apiTokenExpiryJob = defineJob({
  name: "api-tokens.process-expiry",
  duringMaintenance: "run",
  payload: z.object({}),
  retryLimit: 2,
});

export const API_TOKEN_EXPIRY_SCHEDULE = "*/5 * * * *";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60_000;
const REJECTION_EVENTS_PER_CLIENT_PER_MINUTE = 10;
export const MAX_TOKEN_KNOWLEDGE_BASES = 100;

import { tokenNameSchema, tokenScopesSchema } from "@pagehall/shared";

export { tokenNameSchema, tokenScopesSchema };

export interface ApiToken {
  id: string;
  accountId: string;
  organizationId: string | null;
  name: string;
  prefix: string;
  scopes: TokenScopes;
  contentLevel: ContentLevel;
  knowledgeBaseIds: string[] | null;
  expiresAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  revokedAt: Date | null;
}

export interface AuthenticatedToken {
  accountId: string;
  grant: TokenGrant;
}

export class TokenRejectedError extends Error {
  override name = "TokenRejectedError";

  constructor(readonly reason: "malformed" | "unknown" | "revoked" | "expired" | "accountInactive") {
    super("The API token is not valid");
  }
}

const columns = {
  id: apiTokens.id,
  accountId: apiTokens.accountId,
  organizationId: apiTokens.organizationId,
  name: apiTokens.name,
  prefix: apiTokens.tokenPrefix,
  scopes: apiTokens.scopes,
  contentLevel: apiTokens.contentLevel,
  knowledgeBaseIds: apiTokens.knowledgeBaseIds,
  expiresAt: apiTokens.expiresAt,
  createdBy: apiTokens.createdBy,
  createdAt: apiTokens.createdAt,
  lastUsedAt: apiTokens.lastUsedAt,
  lastUsedIp: apiTokens.lastUsedIp,
  revokedAt: apiTokens.revokedAt,
};

function toToken(
  row: Omit<ApiToken, "scopes" | "contentLevel"> & { scopes: unknown; contentLevel: string },
): ApiToken {
  return { ...row, scopes: row.scopes as TokenScopes, contentLevel: contentLevelOf(row.contentLevel) };
}

function contentLevelOf(value: string): ContentLevel {
  return (contentLevels as readonly string[]).includes(value) ? (value as ContentLevel) : "read";
}

export function defaultContentLevel(scopes: TokenScopes): ContentLevel {
  return scopes.organization?.spaces === "manage" ? "publish" : "read";
}

function checkContentLevel(scopes: TokenScopes, level: ContentLevel): void {
  if (level !== "read" && scopes.organization?.spaces !== "manage") {
    throw new OrganizationError(
      "invalidScopes",
      "A token that writes content needs the spaces area with manage",
    );
  }
}

export class ApiTokenService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #settings: SettingsService;
  readonly #rateLimiter: RateLimiter;
  readonly #notifications: NotificationService;
  readonly #authorization: AuthorizationService | undefined;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    settings: SettingsService;
    rateLimiter: RateLimiter;
    notifications: NotificationService;
    authorization?: AuthorizationService;
  }) {
    this.#authorization = options.authorization;
    this.#database = options.database;
    this.#audit = options.audit;
    this.#settings = options.settings;
    this.#rateLimiter = options.rateLimiter;
    this.#notifications = options.notifications;
  }

  async #owner(executor: Executor, accountId: string) {
    const [owner] = await executor
      .select({
        id: accounts.id,
        type: accounts.type,
        state: accounts.state,
        home: accounts.homeOrganizationId,
        serviceOrganization: serviceAccounts.organizationId,
      })
      .from(accounts)
      .leftJoin(serviceAccounts, eq(serviceAccounts.accountId, accounts.id))
      .where(eq(accounts.id, accountId));
    return owner;
  }

  async #chains(
    executor: Executor,
    accountId: string,
    serviceOrganization: string | null,
    organizationId: string | null,
  ): Promise<ScopeChain[]> {
    if (serviceOrganization) return [{ organization: serviceOrganization }];
    const home = await accountScopeChain(executor, accountId);
    if (organizationId) return [home, { organization: organizationId }];
    const memberOf = await executor
      .select({ organizationId: memberships.organizationId })
      .from(memberships)
      .where(
        and(
          eq(memberships.accountId, accountId),
          or(isNull(memberships.expiresAt), sql`${memberships.expiresAt} > now()`),
        ),
      );
    return [home, ...memberOf.map((row) => ({ organization: row.organizationId }))];
  }

  async #maxLifetimeDays(chains: ScopeChain[]): Promise<number | null> {
    let maxDays: number | null = null;
    for (const chain of chains) {
      const limit = await this.#settings.get(tokenMaxLifetimeSetting, chain);
      if (limit !== null) maxDays = maxDays === null ? limit : Math.min(maxDays, limit);
    }
    return maxDays;
  }

  async maxLifetimeDays(accountId: string, organizationId: string | null = null): Promise<number | null> {
    const owner = await this.#owner(this.#database, accountId);
    const service = owner?.serviceOrganization ?? null;
    return this.#maxLifetimeDays(
      await this.#chains(this.#database, accountId, service, service ?? organizationId),
    );
  }

  async ownerOrganization(accountId: string): Promise<string | null> {
    const owner = await this.#owner(this.#database, accountId);
    return owner?.serviceOrganization ?? null;
  }

  async create(
    actor: Principal,
    input: {
      accountId: string;
      name: string;
      scopes: TokenScopes;
      organizationId?: string | null;
      expiresAt?: Date | null;
      contentLevel?: ContentLevel;
      knowledgeBaseIds?: readonly string[] | null;
    },
  ): Promise<{ token: string; apiToken: ApiToken }> {
    const name = tokenNameSchema.parse(input.name);
    const scopes = tokenScopesSchema.parse(input.scopes);
    const contentLevel = input.contentLevel ?? defaultContentLevel(scopes);
    checkContentLevel(scopes, contentLevel);
    const owner = await this.#owner(this.#database, input.accountId);
    if (owner?.state !== "active" || owner.type === "portal") {
      throw new OrganizationError("invalidOwner", "Tokens belong to active accounts");
    }
    const service = owner.serviceOrganization ?? null;
    if (service && scopes.instance) {
      throw new OrganizationError("invalidScopes", "Service accounts have no instance permissions");
    }
    if (service && input.organizationId && input.organizationId !== service) {
      throw new OrganizationError("invalidScopes", "A service account token is limited to its organization");
    }
    if (!service && actor.type === "account" && actor.id !== owner.id) {
      throw new OrganizationError("invalidOwner", "Personal tokens are created by their owner");
    }
    if (input.organizationId && scopes.instance) {
      throw new OrganizationError(
        "invalidScopes",
        "A token limited to an organization has no instance scopes",
      );
    }
    const organizationId = service ?? input.organizationId ?? null;
    if (service && actor.type === "account" && actor.id !== owner.id && this.#authorization) {
      const held = await this.#authorization.heldAreas(input.accountId, "organization", service);
      await this.#authorization.checkGrant(actor, {
        scope: "organization",
        organizationId: service,
        areas: intersectAreas(scopes.organization ?? {}, held),
        actorHolds: true,
        action: "serviceAccount.manage",
      });
    }
    const maxDays = await this.#maxLifetimeDays(
      await this.#chains(this.#database, input.accountId, service, organizationId),
    );
    const now = Date.now();
    const expiresAt =
      input.expiresAt === undefined
        ? maxDays === null
          ? null
          : new Date(now + maxDays * DAY_MS)
        : input.expiresAt;
    if (expiresAt === null && maxDays !== null) {
      throw new OrganizationError("expiryRequired", `Tokens expire after at most ${maxDays} days`, {
        maxLifetimeDays: maxDays,
      });
    }
    if (expiresAt && expiresAt.getTime() <= now)
      throw new OrganizationError("expiryInPast", "The expiry must be in the future");
    if (expiresAt && maxDays !== null && expiresAt.getTime() > now + maxDays * DAY_MS) {
      throw new OrganizationError("expiryTooLate", `Tokens expire after at most ${maxDays} days`, {
        maxLifetimeDays: maxDays,
      });
    }
    const knowledgeBaseIds = await this.#knowledgeBases(
      this.#database,
      input.knowledgeBaseIds ?? null,
      organizationId,
    );
    const token = generateApiToken();
    return this.#database.transaction(async (tx) => {
      const [row] = await tx
        .insert(apiTokens)
        .values({
          accountId: input.accountId,
          organizationId,
          name,
          tokenHash: hashToken(token),
          tokenPrefix: apiTokenPrefix(token),
          scopes,
          contentLevel,
          knowledgeBaseIds,
          expiresAt,
          createdBy: actor.type === "account" ? actor.id : null,
        })
        .returning(columns);
      if (!row) throw new Error("The token was not created");
      const scope = organizationId ?? owner.home;
      await this.#audit.record(tx, {
        name: "apiToken.created",
        actor,
        targetId: row.id,
        fields: {
          accountId: input.accountId,
          name,
          organizationId,
          scopes: scopes as Record<string, Record<string, string>>,
          expiresAt: expiresAt?.toISOString() ?? null,
          contentLevel,
          knowledgeBaseIds,
        },
        ...(scope ? { scope: { type: "organization" as const, id: scope } } : {}),
      });
      return { token, apiToken: toToken(row) };
    });
  }

  async #knowledgeBases(
    executor: Executor,
    ids: readonly string[] | null,
    organizationId: string | null,
  ): Promise<string[] | null> {
    if (ids === null) return null;
    const unique = [...new Set(ids.map((id) => id.toLowerCase()))];
    if (unique.length === 0 || unique.length > MAX_TOKEN_KNOWLEDGE_BASES) {
      throw new OrganizationError(
        "invalidKnowledgeBases",
        `Choose from 1 to ${MAX_TOKEN_KNOWLEDGE_BASES} knowledge bases, or leave the token unlimited`,
      );
    }
    const found = await executor.execute<{ id: string }>(sql`
      select id from spaces where id = any(${sql.param(unique)}::uuid[]) and type = 'knowledgeBase'
        and deleted_at is null ${organizationId ? sql`and organization_id = ${organizationId}` : sql``}`);
    if (found.rows.length !== unique.length) {
      throw new OrganizationError(
        "invalidKnowledgeBases",
        "Choose knowledge bases of the organization the token belongs to",
      );
    }
    return unique.sort();
  }

  async changeContentAccess(
    actor: Principal,
    id: string,
    change: { contentLevel: ContentLevel; knowledgeBaseIds: readonly string[] | null },
  ): Promise<ApiToken> {
    return this.#database.transaction(async (tx) => {
      const [current] = await tx.select(columns).from(apiTokens).where(eq(apiTokens.id, id)).for("update");
      if (!current || current.revokedAt) throw new OrganizationError("notFound", "The token does not exist");
      const scopes = current.scopes as TokenScopes;
      checkContentLevel(scopes, change.contentLevel);
      const knowledgeBaseIds = await this.#knowledgeBases(
        tx,
        change.knowledgeBaseIds,
        current.organizationId ?? (await this.ownerOrganization(current.accountId)),
      );
      const previousLevel = contentLevelOf(current.contentLevel);
      const unchanged =
        previousLevel === change.contentLevel &&
        (current.knowledgeBaseIds === null) === (knowledgeBaseIds === null) &&
        (current.knowledgeBaseIds ?? []).join() === (knowledgeBaseIds ?? []).join();
      if (unchanged) return toToken(current);
      const [row] = await tx
        .update(apiTokens)
        .set({ contentLevel: change.contentLevel, knowledgeBaseIds, updatedAt: new Date() })
        .where(eq(apiTokens.id, id))
        .returning(columns);
      if (!row) throw new OrganizationError("notFound", "The token does not exist");
      const scope = await this.organizationOf(tx, id);
      await this.#audit.record(tx, {
        name: "apiToken.levelChanged",
        actor,
        targetId: id,
        fields: {
          accountId: current.accountId,
          name: current.name,
          contentLevel: change.contentLevel,
          previousContentLevel: previousLevel,
          knowledgeBaseIds,
          previousKnowledgeBaseIds: current.knowledgeBaseIds,
        },
        ...(scope ? { scope: { type: "organization" as const, id: scope } } : {}),
      });
      return toToken(row);
    });
  }

  async get(id: string): Promise<ApiToken | null> {
    const [row] = await this.#database.select(columns).from(apiTokens).where(eq(apiTokens.id, id));
    return row ? toToken(row) : null;
  }

  async listForAccount(accountId: string, page: PageRequest = FIRST_PAGE): Promise<Page<ApiToken>> {
    const rows = await this.#database
      .select(columns)
      .from(apiTokens)
      .where(
        and(
          eq(apiTokens.accountId, accountId),
          isNull(apiTokens.revokedAt),
          afterKey([apiTokens.id], page.after),
        ),
      )
      .orderBy(asc(apiTokens.id))
      .limit(pageLimit(page));
    return toPage(rows, page, (row) => [row.id], toToken);
  }

  #inOrganization(organizationId: string) {
    const owners = this.#database
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.homeOrganizationId, organizationId));
    return or(eq(apiTokens.organizationId, organizationId), inArray(apiTokens.accountId, owners));
  }

  async listForOrganization(organizationId: string, page: PageRequest = FIRST_PAGE): Promise<Page<ApiToken>> {
    const rows = await this.#database
      .select(columns)
      .from(apiTokens)
      .where(
        and(
          isNull(apiTokens.revokedAt),
          this.#inOrganization(organizationId),
          afterKey([apiTokens.id], page.after),
        ),
      )
      .orderBy(asc(apiTokens.id))
      .limit(pageLimit(page));
    return toPage(rows, page, (row) => [row.id], toToken);
  }

  async belongsToOrganization(tokenId: string, organizationId: string): Promise<boolean> {
    const [row] = await this.#database
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(
        and(eq(apiTokens.id, tokenId), isNull(apiTokens.revokedAt), this.#inOrganization(organizationId)),
      );
    return row !== undefined;
  }

  async organizationOf(executor: Executor, id: string): Promise<string | null> {
    const result = await executor.execute<{ organization_id: string | null }>(sql`
      select coalesce(t.organization_id, a.home_organization_id) as organization_id
      from api_tokens t join accounts a on a.id = t.account_id where t.id = ${id}`);
    return result.rows[0]?.organization_id ?? null;
  }

  async rename(actor: Principal, id: string, name: string): Promise<ApiToken> {
    const parsed = tokenNameSchema.parse(name);
    return this.#database.transaction(async (tx) => {
      const [current] = await tx
        .select({ name: apiTokens.name })
        .from(apiTokens)
        .where(eq(apiTokens.id, id))
        .for("update");
      const [row] = await tx
        .update(apiTokens)
        .set({ name: parsed, updatedAt: new Date() })
        .where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt)))
        .returning(columns);
      if (!row) throw new OrganizationError("notFound", "The token does not exist");
      const scope = await this.organizationOf(tx, id);
      await this.#audit.record(tx, {
        name: "apiToken.updated",
        actor,
        targetId: id,
        fields: { name: parsed, previous: { name: current?.name ?? null } },
        ...(scope ? { scope: { type: "organization" as const, id: scope } } : {}),
      });
      return toToken(row);
    });
  }

  async revoke(actor: Principal, id: string): Promise<boolean> {
    return this.#database.transaction(async (tx) => {
      const [row] = await tx
        .update(apiTokens)
        .set({ revokedAt: sql`now()`, updatedAt: new Date() })
        .where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt)))
        .returning({ accountId: apiTokens.accountId });
      if (!row) return false;
      const scope = await this.organizationOf(tx, id);
      await this.#audit.record(tx, {
        name: "apiToken.revoked",
        actor,
        targetId: id,
        fields: { accountId: row.accountId, reason: "revoked" },
        ...(scope ? { scope: { type: "organization" as const, id: scope } } : {}),
      });
      return true;
    });
  }

  async #reject(
    reason: "unknown" | "revoked" | "expired" | "accountInactive",
    tokenId: string | null,
    organizationId: string | null,
    clientIp: string | undefined,
  ): Promise<never> {
    const limit = await this.#rateLimiter.consume(
      `rejectedToken:client:${clientSubject(clientIp ?? "unknown")}`,
      REJECTION_EVENTS_PER_CLIENT_PER_MINUTE,
      60,
    );
    if (limit.allowed) {
      await this.#audit.recordAlone({
        name: "apiToken.rejected",
        actor: { type: "anonymous" },
        targetId: tokenId,
        fields: { reason },
        ...(organizationId ? { scope: { type: "organization" as const, id: organizationId } } : {}),
      });
    }
    throw new TokenRejectedError(reason);
  }

  async authenticate(token: string, clientIp: string | undefined): Promise<AuthenticatedToken> {
    if (!isValidApiTokenFormat(token)) throw new TokenRejectedError("malformed");
    const result = await this.#database.execute<{
      id: string;
      account_id: string;
      organization_id: string | null;
      scopes: TokenScopes;
      content_level: string;
      knowledge_base_ids: string[] | null;
      expired: boolean;
      revoked: boolean;
      state: string;
      last_used_at: Date | string | null;
      scope_organization: string | null;
    }>(sql`
      select t.id, t.account_id, t.organization_id, t.scopes, t.content_level, t.knowledge_base_ids,
        t.revoked_at is not null as revoked,
        (t.expires_at is not null and t.expires_at <= now()) as expired, a.state, t.last_used_at,
        coalesce(t.organization_id, a.home_organization_id) as scope_organization
      from api_tokens t join accounts a on a.id = t.account_id
      where t.token_hash = ${hashToken(token)}`);
    const row = result.rows[0];
    if (!row) return this.#reject("unknown", null, null, clientIp);
    if (row.revoked) return this.#reject("revoked", row.id, row.scope_organization, clientIp);
    if (row.expired) return this.#reject("expired", row.id, row.scope_organization, clientIp);
    if (row.state !== "active")
      return this.#reject("accountInactive", row.id, row.scope_organization, clientIp);
    const perMinute = await this.#settings.get(tokenRequestsPerMinuteSetting, {});
    const limit = await this.#rateLimiter.consume(`apiToken:${row.id}`, perMinute, 60);
    if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);
    const lastUsed = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
    if (Date.now() - lastUsed >= TOUCH_INTERVAL_MS) {
      await this.#database
        .update(apiTokens)
        .set({ lastUsedAt: sql`now()`, lastUsedIp: clientIp ?? null })
        .where(
          and(
            eq(apiTokens.id, row.id),
            or(isNull(apiTokens.lastUsedAt), lte(apiTokens.lastUsedAt, sql`now() - interval '1 minute'`)),
          ),
        );
    }
    return {
      accountId: row.account_id,
      grant: {
        id: row.id,
        organizationId: row.organization_id,
        scopes: row.scopes,
        contentLevel: contentLevelOf(row.content_level),
        knowledgeBaseIds: row.knowledge_base_ids,
      },
    };
  }

  async recordExpired(): Promise<number> {
    const expired = await this.#database.execute<{
      id: string;
      account_id: string;
      organization_id: string | null;
    }>(sql`
      update api_tokens t set expiry_recorded_at = now()
      from accounts a
      where a.id = t.account_id and t.expiry_recorded_at is null and t.revoked_at is null
        and t.expires_at <= now()
      returning t.id, t.account_id, coalesce(t.organization_id, a.home_organization_id) as organization_id`);
    for (const token of expired.rows) {
      await this.#audit.recordAlone({
        name: "apiToken.expired",
        actor: SYSTEM,
        targetId: token.id,
        fields: { accountId: token.account_id },
        ...(token.organization_id
          ? { scope: { type: "organization" as const, id: token.organization_id } }
          : {}),
      });
    }
    return expired.rows.length;
  }

  async sendReminders(): Promise<number> {
    const days = await this.#settings.get(tokenExpiryReminderDaysSetting, {});
    const due = await this.#database.execute<{ id: string }>(sql`
      select id from api_tokens
      where expiry_reminded_at is null and revoked_at is null
        and expires_at > now() and expires_at <= now() + make_interval(days => ${days})
      limit 500`);
    const mailIds: string[] = [];
    let reminded = 0;
    for (const { id } of due.rows) {
      const result = await this.#database.transaction(async (tx) => {
        const marked = await tx.execute<{
          name: string;
          expires_at: Date | string;
          account_id: string;
          organization_id: string | null;
          service_account_id: string | null;
        }>(sql`
          update api_tokens t set expiry_reminded_at = now()
          from accounts a left join service_accounts s on s.account_id = a.id
          where t.id = ${id} and a.id = t.account_id and t.expiry_reminded_at is null and t.revoked_at is null
          returning t.name, t.expires_at, t.account_id,
            coalesce(t.organization_id, s.organization_id, a.home_organization_id) as organization_id,
            s.account_id as service_account_id`);
        const token = marked.rows[0];
        if (!token) return null;
        const recipients = await this.#tokenRecipients(
          tx,
          token.account_id,
          token.service_account_id,
          token.organization_id,
        );
        return this.#notifications.notify(tx, {
          type: "apiToken.expiring",
          recipients,
          organizationId: token.organization_id,
          targetId: id,
          params: {
            tokenName: token.name,
            expiresAt: new Date(token.expires_at).toISOString(),
            serviceAccountId: token.service_account_id,
          },
        });
      });
      if (!result) continue;
      mailIds.push(...result.mailIds);
      reminded += result.recipients;
    }
    await this.#notifications.dispatch(mailIds);
    return reminded;
  }

  async notifyUnused(): Promise<number> {
    const days = await this.#settings.get(tokenUnusedNoticeDaysSetting, {});
    const idle = sql`coalesce(t.last_used_at, t.created_at)`;
    const due = await this.#database.execute<{ id: string }>(sql`
      select t.id from api_tokens t
      where t.revoked_at is null and (t.expires_at is null or t.expires_at > now())
        and ${idle} <= now() - make_interval(days => ${days})
        and (t.unused_noticed_at is null or t.unused_noticed_at < ${idle})
      limit 500`);
    const mailIds: string[] = [];
    let notified = 0;
    for (const { id } of due.rows) {
      const result = await this.#database.transaction(async (tx) => {
        const marked = await tx.execute<{
          name: string;
          last_used_at: Date | string | null;
          account_id: string;
          organization_id: string | null;
          service_account_id: string | null;
        }>(sql`
          update api_tokens t set unused_noticed_at = now()
          from accounts a left join service_accounts s on s.account_id = a.id
          where t.id = ${id} and a.id = t.account_id and t.revoked_at is null
            and ${idle} <= now() - make_interval(days => ${days})
            and (t.unused_noticed_at is null or t.unused_noticed_at < ${idle})
          returning t.name, t.last_used_at, t.account_id,
            coalesce(t.organization_id, s.organization_id, a.home_organization_id) as organization_id,
            s.account_id as service_account_id`);
        const token = marked.rows[0];
        if (!token) return null;
        const recipients = await this.#tokenRecipients(
          tx,
          token.account_id,
          token.service_account_id,
          token.organization_id,
        );
        return this.#notifications.notify(tx, {
          type: "apiToken.unused",
          recipients,
          organizationId: token.organization_id,
          targetId: id,
          params: {
            tokenName: token.name,
            lastUsedAt: token.last_used_at ? new Date(token.last_used_at).toISOString() : null,
            days,
            serviceAccountId: token.service_account_id,
          },
        });
      });
      if (!result) continue;
      mailIds.push(...result.mailIds);
      notified += result.recipients;
    }
    await this.#notifications.dispatch(mailIds);
    return notified;
  }

  async #tokenRecipients(
    tx: Transaction,
    accountId: string,
    serviceAccountId: string | null,
    organizationId: string | null,
  ): Promise<string[]> {
    if (!serviceAccountId) {
      const owner = await tx.execute<{ id: string }>(sql`
        select id from accounts where id = ${accountId} and state = 'active'`);
      return owner.rows.map((row) => row.id);
    }
    const responsible = await tx.execute<{ id: string }>(sql`
      select a.id from service_account_responsibles r join accounts a on a.id = r.account_id
      where r.service_account_id = ${serviceAccountId} and a.state = 'active'`);
    if (responsible.rows.length > 0 || !organizationId) return responsible.rows.map((row) => row.id);
    const owners = await tx.execute<{ id: string }>(sql`
      select distinct a.id from role_assignments ra
      join accounts a on a.id = ra.principal_id
      join memberships m on m.account_id = a.id and m.organization_id = ra.organization_id
      where ra.organization_id = ${organizationId} and ra.principal_kind = 'account'
        and ra.built_in_role = 'owner' and a.state = 'active' and m.kind = 'member'`);
    return owners.rows.map((row) => row.id);
  }
}
