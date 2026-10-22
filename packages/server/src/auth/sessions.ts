import { and, desc, eq, inArray, lt, ne, or, type SQL, sql } from "drizzle-orm";
import { UAParser } from "ua-parser-js";
import { SYSTEM } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import { accountScopeChain } from "../accounts/scope.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { SignInMethod } from "../audit/catalog.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import { settingValues } from "../settings/schema.js";
import type { SettingsService } from "../settings/service.js";
import { sessions } from "./schema.js";
import {
  maxSessionsSetting,
  reauthenticationSetting,
  sessionIdleTimeoutSetting,
  sessionLifetimeSetting,
} from "./settings.js";
import { generateToken, hashToken, isWellFormedToken } from "./tokens.js";

const MINUTE = 60_000;
const TOUCH_INTERVAL = MINUTE;

export const SESSION_COOKIE = "__Host-lunedo-session";

export type SessionKind = (typeof sessions.$inferSelect)["kind"];

export interface Session {
  id: string;
  accountId: string;
  kind: SessionKind;
  methods: SignInMethod[];
  createdAt: Date;
  lastUsedAt: Date;
  reauthenticatedAt: Date | null;
  clientIp: string | null;
  browser: string | null;
  operatingSystem: string | null;
}

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
  deviceToken?: string;
}

const sessionColumns = {
  id: sessions.id,
  accountId: sessions.accountId,
  kind: sessions.kind,
  methods: sessions.methods,
  createdAt: sessions.createdAt,
  lastUsedAt: sessions.lastUsedAt,
  reauthenticatedAt: sessions.reauthenticatedAt,
  clientIp: sessions.clientIp,
  browser: sessions.browser,
  operatingSystem: sessions.operatingSystem,
};

export function describeClient(userAgent: string | undefined): {
  browser: string | null;
  operatingSystem: string | null;
} {
  if (!userAgent) return { browser: null, operatingSystem: null };
  const parsed = new UAParser(userAgent.slice(0, 512)).getResult();
  return { browser: parsed.browser.name ?? null, operatingSystem: parsed.os.name ?? null };
}

export class SessionService {
  readonly #database: Database;
  readonly #settings: SettingsService;
  readonly #audit: AuditLog;
  readonly #clock: () => Date;

  constructor(options: {
    database: Database;
    settings: SettingsService;
    audit: AuditLog;
    clock?: () => Date;
  }) {
    this.#database = options.database;
    this.#settings = options.settings;
    this.#audit = options.audit;
    this.#clock = options.clock ?? (() => new Date());
  }

  async create(
    tx: Transaction,
    options: {
      accountId: string;
      kind: SessionKind;
      methods: SignInMethod[];
      client: ClientInfo;
      identityId?: string | null;
      providerSessionId?: string | null;
    },
  ): Promise<{ session: Session; token: string }> {
    const { accountId, client } = options;
    await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).for("update");
    const now = this.#clock();

    const ended: { id: string; accountId: string; reason: "replacedOnDevice" | "sessionLimit" }[] = [];
    if (client.deviceToken) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${hashToken(client.deviceToken).toString("hex")}, 0))`,
      );
      const replaced = await tx
        .delete(sessions)
        .where(eq(sessions.deviceHash, hashToken(client.deviceToken)))
        .returning({ id: sessions.id, accountId: sessions.accountId });
      ended.push(...replaced.map((row) => ({ ...row, reason: "replacedOnDevice" as const })));
    }

    const token = generateToken();
    const [session] = await tx
      .insert(sessions)
      .values({
        accountId,
        tokenHash: hashToken(token),
        kind: options.kind,
        deviceHash: client.deviceToken ? hashToken(client.deviceToken) : null,
        methods: options.methods,
        identityId: options.identityId ?? null,
        providerSessionId: options.providerSessionId ?? null,
        clientIp: client.ip ?? null,
        ...describeClient(client.userAgent),
        createdAt: now,
        lastUsedAt: now,
        reauthenticatedAt: now,
      })
      .returning(sessionColumns);
    if (!session) throw new Error("The session was not created");
    await tx.update(accounts).set({ lastActiveAt: now }).where(eq(accounts.id, accountId));

    const limit = await this.#settings.get(maxSessionsSetting, await accountScopeChain(tx, accountId));
    const surplus = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.accountId, accountId))
      .orderBy(desc(sessions.lastUsedAt), desc(sessions.id))
      .offset(limit);
    if (surplus.length > 0) {
      await tx.delete(sessions).where(
        inArray(
          sessions.id,
          surplus.map((row) => row.id),
        ),
      );
      ended.push(...surplus.map((row) => ({ id: row.id, accountId, reason: "sessionLimit" as const })));
    }

    for (const entry of ended) {
      await this.#audit.record(tx, {
        name: "auth.sessionEnded",
        actor: SYSTEM,
        targetId: entry.accountId,
        fields: { sessionId: entry.id, reason: entry.reason },
      });
    }
    return { session, token };
  }

  async resolve(token: string): Promise<Session | null> {
    if (!isWellFormedToken(token)) return null;
    return this.#resolveWhere(eq(sessions.tokenHash, hashToken(token)));
  }

  resolveById(sessionId: string): Promise<Session | null> {
    return this.#resolveWhere(eq(sessions.id, sessionId));
  }

  async #resolveWhere(condition: SQL): Promise<Session | null> {
    const [row] = await this.#database
      .select({ ...sessionColumns, accountState: accounts.state })
      .from(sessions)
      .innerJoin(accounts, eq(accounts.id, sessions.accountId))
      .where(condition);
    if (!row) return null;
    const { accountState, ...session } = row;
    const now = this.#clock();
    if (accountState !== "active" || (await this.#expired(session, now))) {
      await this.#database.delete(sessions).where(eq(sessions.id, session.id));
      return null;
    }
    if (now.getTime() - session.lastUsedAt.getTime() >= TOUCH_INTERVAL) {
      const touched = await this.#database
        .update(sessions)
        .set({ lastUsedAt: now })
        .where(
          and(eq(sessions.id, session.id), lt(sessions.lastUsedAt, new Date(now.getTime() - TOUCH_INTERVAL))),
        )
        .returning({ id: sessions.id });
      if (touched.length > 0) {
        await this.#database
          .update(accounts)
          .set({ lastActiveAt: now })
          .where(eq(accounts.id, session.accountId));
      }
      session.lastUsedAt = now;
    }
    return session;
  }

  async #expired(session: Session, now: Date): Promise<boolean> {
    const chain = await accountScopeChain(this.#database, session.accountId);
    const idle = await this.#settings.get(sessionIdleTimeoutSetting, chain);
    const lifetime = await this.#settings.get(sessionLifetimeSetting, chain);
    return (
      now.getTime() - session.lastUsedAt.getTime() > idle * MINUTE ||
      now.getTime() - session.createdAt.getTime() > lifetime * MINUTE
    );
  }

  async isActive(sessionId: string): Promise<boolean> {
    const [row] = await this.#database
      .select({ ...sessionColumns, accountState: accounts.state })
      .from(sessions)
      .innerJoin(accounts, eq(accounts.id, sessions.accountId))
      .where(eq(sessions.id, sessionId));
    if (!row) return false;
    const { accountState, ...session } = row;
    if (accountState === "active" && !(await this.#expired(session, this.#clock()))) return true;
    await this.#database.delete(sessions).where(eq(sessions.id, session.id));
    return false;
  }

  async isRecentlyAuthenticated(session: Session): Promise<boolean> {
    if (!session.reauthenticatedAt) return false;
    const minutes = await this.#settings.get(
      reauthenticationSetting,
      await accountScopeChain(this.#database, session.accountId),
    );
    return this.#clock().getTime() - session.reauthenticatedAt.getTime() <= minutes * MINUTE;
  }

  async rotate(
    executor: Executor,
    sessionId: string,
    changes: { kind?: SessionKind; methods?: SignInMethod[]; reauthenticated?: boolean } = {},
  ): Promise<string> {
    const token = generateToken();
    const updated = await executor
      .update(sessions)
      .set({
        tokenHash: hashToken(token),
        ...(changes.kind ? { kind: changes.kind } : {}),
        ...(changes.methods ? { methods: changes.methods } : {}),
        ...(changes.reauthenticated ? { reauthenticatedAt: this.#clock() } : {}),
      })
      .where(eq(sessions.id, sessionId))
      .returning({ id: sessions.id });
    if (updated.length === 0) throw new SessionGoneError();
    return token;
  }

  async list(accountId: string): Promise<Session[]> {
    return this.#database
      .select(sessionColumns)
      .from(sessions)
      .where(eq(sessions.accountId, accountId))
      .orderBy(desc(sessions.lastUsedAt));
  }

  async end(accountId: string, sessionId: string, reason: "signedOut" | "endedByAccount"): Promise<boolean> {
    return this.#database.transaction(async (tx) => {
      const deleted = await tx
        .delete(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)))
        .returning({ id: sessions.id });
      if (deleted.length === 0) return false;
      if (reason === "signedOut") {
        await this.#audit.record(tx, { name: "auth.signedOut", targetId: accountId, fields: { sessionId } });
      } else {
        await this.#audit.record(tx, {
          name: "auth.sessionEnded",
          targetId: accountId,
          fields: { sessionId, reason: "endedByAccount" },
        });
      }
      return true;
    });
  }

  async endOthers(accountId: string, keep: string): Promise<number> {
    return this.#database.transaction(async (tx) => {
      const ended = await this.endAll(tx, accountId, { keep });
      for (const sessionId of ended) {
        await this.#audit.record(tx, {
          name: "auth.sessionEnded",
          targetId: accountId,
          fields: { sessionId, reason: "endedByAccount" },
        });
      }
      return ended.length;
    });
  }

  async endAll(executor: Executor, accountId: string, options: { keep?: string } = {}) {
    const deleted = await executor
      .delete(sessions)
      .where(and(eq(sessions.accountId, accountId), options.keep ? ne(sessions.id, options.keep) : undefined))
      .returning({ id: sessions.id });
    return deleted.map((row) => row.id);
  }

  async cleanup(): Promise<number> {
    let removed = await this.#removeExpired(null);
    const organizations = await this.#database
      .selectDistinct({ id: settingValues.scopeId })
      .from(settingValues)
      .where(
        and(
          eq(settingValues.level, "organization"),
          inArray(settingValues.key, [sessionIdleTimeoutSetting.key, sessionLifetimeSetting.key]),
        ),
      );
    for (const organization of organizations) removed += await this.#removeExpired(organization.id);
    const inactive = await this.#database
      .delete(sessions)
      .where(
        sql`not exists (select 1 from ${accounts} where ${accounts.id} = ${sessions.accountId} and ${accounts.state} = 'active')`,
      );
    return removed + (inactive.rowCount ?? 0);
  }

  async #removeExpired(organizationId: string | null): Promise<number> {
    const chain = organizationId ? { organization: organizationId } : {};
    const idle = await this.#settings.get(sessionIdleTimeoutSetting, chain);
    const lifetime = await this.#settings.get(sessionLifetimeSetting, chain);
    const now = this.#clock().getTime();
    const deleted = await this.#database
      .delete(sessions)
      .where(
        and(
          or(
            lt(sessions.lastUsedAt, new Date(now - idle * MINUTE)),
            lt(sessions.createdAt, new Date(now - lifetime * MINUTE)),
          ),
          organizationId
            ? sql`${sessions.accountId} in (select ${accounts.id} from ${accounts} where ${accounts.homeOrganizationId} = ${organizationId})`
            : undefined,
        ),
      );
    return deleted.rowCount ?? 0;
  }
}

export class SessionGoneError extends Error {
  override name = "SessionGoneError";

  constructor() {
    super("The session has ended");
  }
}
