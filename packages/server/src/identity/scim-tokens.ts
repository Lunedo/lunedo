import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import { hashToken } from "../auth/tokens.js";
import type { Database, Transaction } from "../database/database.js";
import { OrganizationError } from "../organizations/organizations.js";
import { identityProviders, scimTokens } from "./schema.js";

const TOKEN_PREFIX = "phscim_";
const PREFIX_LENGTH = TOKEN_PREFIX.length + 6;
export const SCIM_TOKEN_OVERLAP_DAYS = 7;
const LAST_USED_PRECISION_MS = 60_000;

export interface ScimTokenSummary {
  id: string;
  prefix: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface CreatedScimToken extends ScimTokenSummary {
  token: string;
}

export interface ScimStatus {
  tokens: ScimTokenSummary[];
  lastRequestAt: Date | null;
  lastDay: { requests: number; changes: number; failed: number };
}

export class ScimTokenRejectedError extends Error {
  override name = "ScimTokenRejectedError";

  constructor() {
    super("The SCIM token is not valid for this provider");
  }
}

function generate(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/**
 * Bearer tokens with which a provider sends SCIM requests. They are shown once, stored as a
 * hash and bound to one provider. A renewal keeps the old token valid for a short overlap.
 */
export class ScimTokenService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #clock: () => Date;

  constructor(options: { database: Database; audit: AuditLog; clock?: () => Date }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#clock = options.clock ?? (() => new Date());
  }

  async list(providerId: string): Promise<ScimTokenSummary[]> {
    return this.#database
      .select({
        id: scimTokens.id,
        prefix: scimTokens.prefix,
        expiresAt: scimTokens.expiresAt,
        lastUsedAt: scimTokens.lastUsedAt,
        createdAt: scimTokens.createdAt,
      })
      .from(scimTokens)
      .where(
        and(
          eq(scimTokens.providerId, providerId),
          or(isNull(scimTokens.expiresAt), gt(scimTokens.expiresAt, this.#clock())),
        ),
      )
      .orderBy(asc(scimTokens.createdAt), asc(scimTokens.id));
  }

  async status(providerId: string): Promise<ScimStatus> {
    const tokens = await this.list(providerId);
    const [used] = await this.#database
      .select({ lastUsedAt: sql<Date | string | null>`max(${scimTokens.lastUsedAt})` })
      .from(scimTokens)
      .where(eq(scimTokens.providerId, providerId));
    const result = await this.#database.execute<{ requests: number; changes: number; failed: number }>(sql`
      select count(*)::int as requests,
        coalesce(sum(jsonb_array_length(changes)), 0)::int as changes,
        count(*) filter (where status = 'failed')::int as failed
      from provider_sync_runs
      where provider_id = ${providerId} and trigger = 'scim' and started_at > now() - interval '1 day'`);
    const lastDay = result.rows[0] ?? { requests: 0, changes: 0, failed: 0 };
    return {
      tokens,
      lastRequestAt: used?.lastUsedAt ? new Date(used.lastUsedAt) : null,
      lastDay: {
        requests: Number(lastDay.requests),
        changes: Number(lastDay.changes),
        failed: Number(lastDay.failed),
      },
    };
  }

  async enabled(providerId: string): Promise<boolean> {
    return (await this.list(providerId)).length > 0;
  }

  async #lockProvider(tx: Transaction, providerId: string) {
    const [provider] = await tx
      .select({ id: identityProviders.id })
      .from(identityProviders)
      .where(eq(identityProviders.id, providerId))
      .for("update");
    if (!provider) throw new OrganizationError("notFound", "The identity provider does not exist");
  }

  async create(actor: Principal, providerId: string): Promise<CreatedScimToken> {
    const token = generate();
    return this.#database.transaction(async (tx) => {
      await this.#lockProvider(tx, providerId);
      const [row] = await tx
        .insert(scimTokens)
        .values({
          providerId,
          tokenHash: hashToken(token),
          prefix: token.slice(0, PREFIX_LENGTH),
          createdBy: actor.type === "account" ? actor.id : null,
        })
        .returning();
      if (!row) throw new Error("The SCIM token was not stored");
      await this.#audit.record(tx, {
        name: "identityProvider.scimTokenCreated",
        actor,
        targetId: providerId,
        fields: { credentialId: row.id, prefix: row.prefix },
      });
      return {
        id: row.id,
        prefix: row.prefix,
        expiresAt: null,
        lastUsedAt: null,
        createdAt: row.createdAt,
        token,
      };
    });
  }

  async renew(actor: Principal, providerId: string, tokenId: string): Promise<CreatedScimToken> {
    const token = generate();
    return this.#database.transaction(async (tx) => {
      await this.#lockProvider(tx, providerId);
      const overlapEnd = new Date(this.#clock().getTime() + SCIM_TOKEN_OVERLAP_DAYS * 24 * 60 * 60 * 1000);
      const [previous] = await tx
        .update(scimTokens)
        .set({ expiresAt: sql`least(coalesce(${scimTokens.expiresAt}, ${overlapEnd}), ${overlapEnd})` })
        .where(
          and(
            eq(scimTokens.id, tokenId),
            eq(scimTokens.providerId, providerId),
            or(isNull(scimTokens.expiresAt), gt(scimTokens.expiresAt, this.#clock())),
          ),
        )
        .returning({ id: scimTokens.id, expiresAt: scimTokens.expiresAt });
      if (!previous?.expiresAt) throw new OrganizationError("notFound", "The SCIM token does not exist");
      const [row] = await tx
        .insert(scimTokens)
        .values({
          providerId,
          tokenHash: hashToken(token),
          prefix: token.slice(0, PREFIX_LENGTH),
          createdBy: actor.type === "account" ? actor.id : null,
        })
        .returning();
      if (!row) throw new Error("The SCIM token was not stored");
      await this.#audit.record(tx, {
        name: "identityProvider.scimTokenRenewed",
        actor,
        targetId: providerId,
        fields: {
          credentialId: row.id,
          prefix: row.prefix,
          previousCredentialId: previous.id,
          previousExpiresAt: previous.expiresAt.toISOString(),
        },
      });
      return {
        id: row.id,
        prefix: row.prefix,
        expiresAt: null,
        lastUsedAt: null,
        createdAt: row.createdAt,
        token,
      };
    });
  }

  async remove(actor: Principal, providerId: string, tokenId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await this.#lockProvider(tx, providerId);
      const [removed] = await tx
        .delete(scimTokens)
        .where(and(eq(scimTokens.id, tokenId), eq(scimTokens.providerId, providerId)))
        .returning({ id: scimTokens.id, prefix: scimTokens.prefix });
      if (!removed) throw new OrganizationError("notFound", "The SCIM token does not exist");
      await this.#audit.record(tx, {
        name: "identityProvider.scimTokenRemoved",
        actor,
        targetId: providerId,
        fields: { credentialId: removed.id, prefix: removed.prefix },
      });
    });
  }

  async authenticate(providerId: string, token: string): Promise<void> {
    if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) throw new ScimTokenRejectedError();
    const now = this.#clock();
    const [row] = await this.#database
      .select({ id: scimTokens.id, lastUsedAt: scimTokens.lastUsedAt })
      .from(scimTokens)
      .where(
        and(
          eq(scimTokens.tokenHash, hashToken(token)),
          eq(scimTokens.providerId, providerId),
          or(isNull(scimTokens.expiresAt), gt(scimTokens.expiresAt, now)),
        ),
      );
    if (!row) throw new ScimTokenRejectedError();
    if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_PRECISION_MS) {
      await this.#database.update(scimTokens).set({ lastUsedAt: now }).where(eq(scimTokens.id, row.id));
    }
  }
}
