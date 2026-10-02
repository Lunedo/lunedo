import { eq } from "drizzle-orm";
import type { AuditLog } from "../audit/audit-log.js";
import {
  authChallenges,
  recoveryCodes,
  sessions,
  totpCredentials,
  webauthnCredentials,
} from "../auth/schema.js";
import { secondFactorsOf } from "../auth/two-factor.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Transaction } from "../database/database.js";
import type { MailService } from "../mail/mail-service.js";
import { OrganizationError } from "../organizations/organizations.js";
import type { Principal } from "./principal.js";
import { accounts, instance } from "./schema.js";

export const SECOND_FACTOR_RESET_ACTION = "account.secondFactor.reset";
const END_SESSIONS_ACTION = "account.sessions.end";
const REACTIVATE_ACTION = "account.reactivate";

interface Target {
  id: string;
  home: string | null;
  email: string | null;
}

export class AccountAdministrationService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #audit: AuditLog;
  readonly #mail: MailService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    audit: AuditLog;
    mail: MailService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#audit = options.audit;
    this.#mail = options.mail;
  }

  async resetSecondFactor(
    actor: Principal,
    accountId: string,
    reason: string,
  ): Promise<{ endedSessions: number }> {
    let mailId: string | null = null;
    const result = await this.#database.transaction(async (tx) => {
      const target = await this.#lockActive(tx, accountId);
      if (actor.type === "account" && actor.id === target.id) {
        throw new OrganizationError(
          "resetOwnSecondFactor",
          "An account cannot reset its own second factor; use a recovery code instead",
        );
      }
      await this.#authorization.require(
        actor,
        SECOND_FACTOR_RESET_ACTION,
        { type: "account", id: accountId },
        { executor: tx },
      );
      await this.#checkRank(tx, actor, target, SECOND_FACTOR_RESET_ACTION);
      const factors = await secondFactorsOf(tx, accountId);
      await tx.delete(totpCredentials).where(eq(totpCredentials.accountId, accountId));
      await tx.delete(webauthnCredentials).where(eq(webauthnCredentials.accountId, accountId));
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.accountId, accountId));
      const ended = await tx
        .delete(sessions)
        .where(eq(sessions.accountId, accountId))
        .returning({ id: sessions.id });
      await tx.delete(authChallenges).where(eq(authChallenges.accountId, accountId));
      await tx
        .update(accounts)
        .set({ secondFactorResetAt: new Date(), updatedAt: new Date() })
        .where(eq(accounts.id, accountId));
      if (target.email) {
        mailId = await this.#mail.queue(tx, {
          to: target.email,
          template: "secondFactorReset",
          language: await this.#mail.languageOf(accountId),
          params: { reason },
          organizationId: target.home,
        });
      }
      await this.#audit.record(tx, {
        name: "account.secondFactorReset",
        actor,
        targetId: accountId,
        fields: {
          reason,
          endedSessions: ended.length,
          authenticatorApp: factors.totp,
          passkeys: factors.passkeys,
          recoveryLeft: factors.recoveryCodes,
        },
        ...(target.home ? { scope: { type: "organization" as const, id: target.home } } : {}),
      });
      return { endedSessions: ended.length };
    });
    if (mailId) await this.#mail.dispatch([mailId]);
    return result;
  }

  async endSessions(actor: Principal, accountId: string): Promise<{ endedSessions: number }> {
    return this.#database.transaction(async (tx) => {
      const target = await this.#lockActive(tx, accountId);
      if (actor.type === "account" && actor.id === target.id) {
        throw new OrganizationError("endOwnSessions", "Own sessions are ended on the security page");
      }
      await this.#authorization.require(
        actor,
        END_SESSIONS_ACTION,
        { type: "account", id: accountId },
        { executor: tx },
      );
      await this.#checkRank(tx, actor, target, END_SESSIONS_ACTION);
      const ended = await tx
        .delete(sessions)
        .where(eq(sessions.accountId, accountId))
        .returning({ id: sessions.id });
      await tx.delete(authChallenges).where(eq(authChallenges.accountId, accountId));
      await this.#audit.record(tx, {
        name: "account.sessionsEnded",
        actor,
        targetId: accountId,
        fields: { endedSessions: ended.length },
        ...(target.home ? { scope: { type: "organization" as const, id: target.home } } : {}),
      });
      return { endedSessions: ended.length };
    });
  }

  async reactivate(actor: Principal, accountId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: accounts.id,
          type: accounts.type,
          state: accounts.state,
          home: accounts.homeOrganizationId,
          email: accounts.email,
        })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .for("update");
      if (!row || row.state !== "deactivated" || row.type === "service") {
        throw new OrganizationError("notFound", "The account does not exist or is not deactivated");
      }
      const target = { id: row.id, home: row.home, email: row.email };
      await this.#authorization.require(
        actor,
        REACTIVATE_ACTION,
        { type: "account", id: accountId },
        { executor: tx },
      );
      await tx
        .update(accounts)
        .set({ state: "active", updatedAt: new Date() })
        .where(eq(accounts.id, accountId));
      await this.#checkRank(tx, actor, target, REACTIVATE_ACTION);
      await this.#audit.record(tx, {
        name: "account.reactivated",
        actor,
        targetId: accountId,
        fields: {},
        ...(target.home ? { scope: { type: "organization" as const, id: target.home } } : {}),
      });
    });
  }

  async #lockActive(tx: Transaction, accountId: string): Promise<Target> {
    const [target] = await tx
      .select({
        id: accounts.id,
        type: accounts.type,
        state: accounts.state,
        home: accounts.homeOrganizationId,
        email: accounts.email,
      })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .for("update");
    if (!target || target.state !== "active" || target.type === "service") {
      throw new OrganizationError("notFound", "The account does not exist or is not active");
    }
    return { id: target.id, home: target.home, email: target.email };
  }

  async #checkRank(tx: Transaction, actor: Principal, target: Target, action: string): Promise<void> {
    if (actor.type !== "account") return;
    await this.#authorization.checkOwnersOverAccount(actor, target.id, { executor: tx, action });
    const [row] = await tx.select({ owner: instance.ownerAccountId }).from(instance);
    const instanceOwner = row?.owner ?? null;
    const targetInstanceAreas = await this.#authorization.heldAreas(target.id, "instance", null, tx);
    const targetIsInstanceOwner = instanceOwner === target.id;
    if (targetIsInstanceOwner || Object.keys(targetInstanceAreas).length > 0) {
      await this.#authorization.checkRank(
        actor,
        {
          scope: "instance",
          organizationId: null,
          areas: targetInstanceAreas,
          owner: targetIsInstanceOwner,
          action,
        },
        { executor: tx },
      );
    }
    if (!target.home) return;
    const actorInstanceAreas = await this.#authorization.heldAreas(actor.id, "instance", null, tx);
    const actorIsInstanceOwner = instanceOwner === actor.id;
    const targetIsHomeOwner = await this.#authorization.isOrganizationOwner(target.id, target.home, tx);
    const instanceAdministrator = actorInstanceAreas.accounts === "manage";
    if (instanceAdministrator && (!targetIsHomeOwner || actorIsInstanceOwner)) return;
    await this.#authorization.checkRankOverAccount(actor, target.home, target.id, { executor: tx, action });
  }
}
