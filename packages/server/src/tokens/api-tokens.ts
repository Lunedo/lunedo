import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { type Principal, SYSTEM, type TokenGrant, type TokenScopes } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import { accountScopeChain } from "../accounts/scope.js";
import type { AuditLog } from "../audit/audit-log.js";
import { RateLimitedError } from "../auth/errors.js";
import { clientSubject, type RateLimiter } from "../auth/throttle.js";
import { hashToken } from "../auth/tokens.js";
import { areasSchema } from "../authorization/areas.js";
import type { Database, Executor } from "../database/database.js";
import { afterKey, FIRST_PAGE, type Page, type PageRequest, pageLimit, toPage } from "../database/keyset.js";
import { defineJob } from "../jobs/job-queue.js";
import type { MailService } from "../mail/mail-service.js";
import { OrganizationError } from "../organizations/organizations.js";
import type { ScopeChain, SettingsService } from "../settings/service.js";
import { apiTokenPrefix, generateApiToken, isValidApiTokenFormat } from "./format.js";
import { apiTokens, serviceAccounts } from "./schema.js";
import {
  tokenExpiryReminderDaysSetting,
  tokenMaxLifetimeSetting,
  tokenRequestsPerMinuteSetting,
  tokensWithoutExpirySetting,
} from "./settings.js";

export const apiTokenExpiryJob = defineJob({
  name: "api-tokens.process-expiry",
  payload: z.object({}),
  retryLimit: 2,
});

export const API_TOKEN_EXPIRY_SCHEDULE = "*/5 * * * *";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIFETIME_DAYS = 90;
const TOUCH_INTERVAL_MS = 60_000;
const REJECTION_EVENTS_PER_CLIENT_PER_MINUTE = 10;

export const tokenNameSchema = z.string().trim().min(1).max(100);

export const tokenScopesSchema = z
  .object({
    instance: areasSchema("instance").optional(),
    organization: areasSchema("organization").optional(),
  })
  .strict()
  .refine(
    (scopes) => Object.keys(scopes.instance ?? {}).length + Object.keys(scopes.organization ?? {}).length > 0,
    "A token needs at least one scope",
  );

export interface ApiToken {
  id: string;
  accountId: string;
  organizationId: string | null;
  name: string;
  prefix: string;
  scopes: TokenScopes;
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
  expiresAt: apiTokens.expiresAt,
  createdBy: apiTokens.createdBy,
  createdAt: apiTokens.createdAt,
  lastUsedAt: apiTokens.lastUsedAt,
  lastUsedIp: apiTokens.lastUsedIp,
  revokedAt: apiTokens.revokedAt,
};

function toToken(row: Omit<ApiToken, "scopes"> & { scopes: unknown }): ApiToken {
  return { ...row, scopes: row.scopes as TokenScopes };
}

export class ApiTokenService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #settings: SettingsService;
  readonly #rateLimiter: RateLimiter;
  readonly #mail: MailService;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    settings: SettingsService;
    rateLimiter: RateLimiter;
    mail: MailService;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#settings = options.settings;
    this.#rateLimiter = options.rateLimiter;
    this.#mail = options.mail;
  }

  async #owner(executor: Executor, accountId: string) {
    const [owner] = await executor
      .select({
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

  async #chain(
    executor: Executor,
    accountId: string,
    serviceOrganization: string | null,
  ): Promise<ScopeChain> {
    return serviceOrganization
      ? { organization: serviceOrganization }
      : accountScopeChain(executor, accountId);
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
    },
  ): Promise<{ token: string; apiToken: ApiToken }> {
    const name = tokenNameSchema.parse(input.name);
    const scopes = tokenScopesSchema.parse(input.scopes);
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
    const organizationId = service ?? input.organizationId ?? null;
    const chain = await this.#chain(this.#database, input.accountId, service);
    const maxDays = await this.#settings.get(tokenMaxLifetimeSetting, chain);
    const withoutExpiry = await this.#settings.get(tokensWithoutExpirySetting, chain);
    const now = Date.now();
    let expiresAt: Date | null;
    if (input.expiresAt === undefined)
      expiresAt = new Date(now + Math.min(DEFAULT_LIFETIME_DAYS, maxDays) * DAY_MS);
    else expiresAt = input.expiresAt;
    if (expiresAt === null && !withoutExpiry) {
      throw new OrganizationError("expiryRequired", "Tokens need an expiry date");
    }
    if (expiresAt && expiresAt.getTime() <= now)
      throw new OrganizationError("expiryInPast", "The expiry must be in the future");
    if (expiresAt && expiresAt.getTime() > now + maxDays * DAY_MS) {
      throw new OrganizationError("expiryTooLate", `Tokens expire after at most ${maxDays} days`);
    }
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
        },
        ...(scope ? { scope: { type: "organization" as const, id: scope } } : {}),
      });
      return { token, apiToken: toToken(row) };
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
        fields: { name: parsed },
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
      expired: boolean;
      revoked: boolean;
      state: string;
      last_used_at: Date | string | null;
      scope_organization: string | null;
    }>(sql`
      select t.id, t.account_id, t.organization_id, t.scopes, t.revoked_at is not null as revoked,
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
      grant: { id: row.id, organizationId: row.organization_id, scopes: row.scopes },
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
    for (const { id } of due.rows) {
      const queued = await this.#database.transaction(async (tx) => {
        const marked = await tx.execute<{ name: string; expires_at: Date | string; account_id: string }>(sql`
          update api_tokens set expiry_reminded_at = now()
          where id = ${id} and expiry_reminded_at is null and revoked_at is null
          returning name, expires_at, account_id`);
        const token = marked.rows[0];
        if (!token) return [];
        const recipients = await tx.execute<{ id: string; email: string }>(sql`
          select a.id, a.email from accounts a
          where a.state = 'active' and a.email is not null and (
            a.id = ${token.account_id}
            or a.id in (select account_id from service_account_responsibles where service_account_id = ${token.account_id}))`);
        const ids: string[] = [];
        for (const recipient of recipients.rows) {
          ids.push(
            await this.#mail.queue(tx, {
              to: recipient.email,
              template: "tokenExpiring",
              language: await this.#mail.languageOf(recipient.id),
              params: { tokenName: token.name, date: new Date(token.expires_at).toISOString().slice(0, 10) },
            }),
          );
        }
        return ids;
      });
      mailIds.push(...queued);
    }
    await this.#mail.dispatch(mailIds);
    return mailIds.length;
  }
}
