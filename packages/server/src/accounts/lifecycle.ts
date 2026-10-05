import { accountNameSchema, emailSchema } from "@pagehall/shared";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { AuditEvents, AuditLog } from "../audit/audit-log.js";
import {
  accountTokens,
  authChallenges,
  rateLimits,
  recoveryCodes,
  sessions,
  signInFailures,
  totpCredentials,
  webauthnCredentials,
} from "../auth/schema.js";
import { accountSubject, clientSubject } from "../auth/throttle.js";
import { type AuthorizationService, ForbiddenError } from "../authorization/service.js";
import type { Encryption } from "../crypto/envelope.js";
import type { Database, Transaction } from "../database/database.js";
import { identities, providerDeactivations, providerGrants, signInRefusals } from "../identity/schema.js";
import { mailOutbox } from "../mail/schema.js";
import { knownDevices, notifications } from "../notifications/schema.js";
import {
  groupManagers,
  groupMembers,
  invitations,
  type MembershipKind,
  memberships,
  registrationTokens,
  roleAssignments,
} from "../organizations/access-schema.js";
import type { MembershipService } from "../organizations/memberships.js";
import { OrganizationError } from "../organizations/organizations.js";
import { settingValues } from "../settings/schema.js";
import { apiTokens } from "../tokens/schema.js";
import { withUniqueEmail } from "./accounts.js";
import { type Principal, SYSTEM } from "./principal.js";
import { accounts, instance } from "./schema.js";

const MANAGE_ACCOUNTS = "instance.accounts.manage";

export interface PlaceholderMerge {
  memberships: number;
  groups: number;
  roles: number;
}

export interface Anonymization {
  endedSessions: number;
  removedIdentities: number;
  endedMemberships: number;
}

export function formerUserName(accountId: string): string {
  return `Former user ${accountId.slice(0, 8)}`;
}

function messageContext(id: string): string {
  return `mail_outbox.message:${id}`;
}

export class AccountLifecycleService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #authorization: AuthorizationService;
  readonly #memberships: MembershipService;
  readonly #encryption: Encryption;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    authorization: AuthorizationService;
    memberships: MembershipService;
    encryption: Encryption;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#authorization = options.authorization;
    this.#memberships = options.memberships;
    this.#encryption = options.encryption;
  }

  async createPlaceholder(
    actor: Principal,
    input: { name: string; email: string },
  ): Promise<{ id: string; name: string; email: string }> {
    const name = accountNameSchema.parse(input.name);
    const email = emailSchema.parse(input.email.trim());
    return this.#database.transaction(async (tx) => {
      await this.#authorization.require(actor, MANAGE_ACCOUNTS, { type: "instance" }, { executor: tx });
      const [row] = await withUniqueEmail(() =>
        tx
          .insert(accounts)
          .values({ type: "standard", state: "placeholder", name, email })
          .returning({ id: accounts.id, name: accounts.name, email: accounts.email }),
      );
      if (!row) throw new Error("The placeholder was not created");
      await this.#audit.record(tx, {
        name: "account.placeholderCreated",
        actor,
        targetId: row.id,
        fields: { email },
      });
      return { id: row.id, name: row.name, email };
    });
  }

  async adoptPlaceholder(
    tx: Transaction,
    placeholderId: string,
    input: { name: string; homeOrganizationId: string | null },
  ): Promise<boolean> {
    const adopted = await tx
      .update(accounts)
      .set({
        state: "active",
        name: accountNameSchema.parse(input.name),
        emailVerifiedAt: sql`now()`,
        homeOrganizationId: sql`coalesce(${accounts.homeOrganizationId}, ${input.homeOrganizationId}::uuid)`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(accounts.id, placeholderId), eq(accounts.state, "placeholder"), isNull(accounts.mergedIntoId)),
      )
      .returning({ id: accounts.id });
    if (adopted.length === 0) return false;
    const counts = await this.#holdings(tx, placeholderId);
    await this.#audit.record(tx, {
      name: "account.placeholderMerged",
      actor: SYSTEM,
      targetId: placeholderId,
      fields: { placeholderId, via: "signIn", ...counts },
    });
    return true;
  }

  async #holdings(tx: Transaction, accountId: string): Promise<PlaceholderMerge> {
    const result = await tx.execute<{ memberships: number; groups: number; roles: number }>(sql`
      select
        (select count(*)::int from memberships where account_id = ${accountId}) as memberships,
        (select count(*)::int from group_members where account_id = ${accountId}) as groups,
        (select count(*)::int from role_assignments
          where principal_kind = 'account' and principal_id = ${accountId}) as roles`);
    return result.rows[0] ?? { memberships: 0, groups: 0, roles: 0 };
  }

  async mergePlaceholder(
    actor: Principal,
    placeholderId: string,
    accountId: string,
  ): Promise<PlaceholderMerge> {
    if (placeholderId === accountId) {
      throw new OrganizationError("invalidInput", "A placeholder cannot be merged into itself");
    }
    if (actor.type === "account" && actor.id === accountId) {
      throw new ForbiddenError({
        action: "account.placeholder.merge",
        resource: { type: "account", id: accountId },
        allowed: false,
        grants: [],
        denials: ["selfExtension"],
      });
    }
    return this.#database.transaction(async (tx) => {
      await this.#authorization.require(actor, MANAGE_ACCOUNTS, { type: "instance" }, { executor: tx });
      const locked = await tx
        .select({
          id: accounts.id,
          type: accounts.type,
          state: accounts.state,
          mergedIntoId: accounts.mergedIntoId,
        })
        .from(accounts)
        .where(inArray(accounts.id, [placeholderId, accountId].sort()))
        .orderBy(accounts.id)
        .for("update");
      const placeholder = locked.find((row) => row.id === placeholderId);
      const target = locked.find((row) => row.id === accountId);
      if (placeholder?.state !== "placeholder" || placeholder.mergedIntoId !== null) {
        throw new OrganizationError("notPlaceholder", "The account is not a placeholder that can be merged");
      }
      if (target?.state !== "active" || (target.type !== "standard" && target.type !== "guest")) {
        throw new OrganizationError("notFound", "The account does not exist or is not active");
      }
      const events: AuditEvents = [];
      const counts = await this.#holdings(tx, placeholderId);
      const held = await tx
        .select({
          organizationId: memberships.organizationId,
          kind: memberships.kind,
          expiresAt: memberships.expiresAt,
        })
        .from(memberships)
        .where(eq(memberships.accountId, placeholderId));
      for (const membership of held) {
        const [existing] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, membership.organizationId),
              eq(memberships.accountId, accountId),
            ),
          );
        if (!existing) {
          const kind: MembershipKind =
            target.type === "guest"
              ? "guest"
              : membership.kind === "guest"
                ? "collaborator"
                : membership.kind;
          await this.#memberships.add(
            tx,
            actor,
            { organizationId: membership.organizationId, accountId, kind, expiresAt: membership.expiresAt },
            { collect: events },
          );
        }
        events.push({
          name: "membership.removed",
          actor,
          targetId: placeholderId,
          fields: { kind: membership.kind, reason: "merged" },
          scope: { type: "organization", id: membership.organizationId },
        });
      }
      await tx.delete(memberships).where(eq(memberships.accountId, placeholderId));
      for (const table of [groupMembers, groupManagers] as const) {
        const moved = await tx
          .delete(table)
          .where(eq(table.accountId, placeholderId))
          .returning({ groupId: table.groupId });
        if (moved.length === 0) continue;
        await tx
          .insert(table)
          .values(moved.map((row) => ({ groupId: row.groupId, accountId })))
          .onConflictDoNothing();
        for (const row of moved) {
          const organization = await tx.execute<{ organization_id: string }>(
            sql`select organization_id from groups where id = ${row.groupId}`,
          );
          const scope = organization.rows[0]?.organization_id;
          const scoped = scope ? { scope: { type: "organization" as const, id: scope } } : {};
          if (table === groupMembers) {
            events.push(
              {
                name: "group.memberAdded",
                actor,
                targetId: row.groupId,
                fields: { accountId, expiresAt: null },
                ...scoped,
              },
              {
                name: "group.memberRemoved",
                actor,
                targetId: row.groupId,
                fields: { accountId: placeholderId, reason: "merged" },
                ...scoped,
              },
            );
          } else {
            events.push(
              { name: "group.managerAdded", actor, targetId: row.groupId, fields: { accountId }, ...scoped },
              {
                name: "group.managerRemoved",
                actor,
                targetId: row.groupId,
                fields: { accountId: placeholderId },
                ...scoped,
              },
            );
          }
        }
      }
      const assignments = await tx
        .delete(roleAssignments)
        .where(
          and(
            eq(roleAssignments.principalKind, "account"),
            eq(roleAssignments.principalId, placeholderId),
            eq(roleAssignments.scope, "organization"),
          ),
        )
        .returning();
      for (const assignment of assignments) {
        const [inserted] = await tx
          .insert(roleAssignments)
          .values({
            scope: assignment.scope,
            organizationId: assignment.organizationId,
            principalKind: "account",
            principalId: accountId,
            builtInRole: assignment.builtInRole,
            customRoleId: assignment.customRoleId,
            expiresAt: assignment.expiresAt,
            createdBy: actor.type === "account" ? actor.id : null,
          })
          .onConflictDoNothing()
          .returning({ id: roleAssignments.id });
        const scope = assignment.organizationId
          ? { scope: { type: "organization" as const, id: assignment.organizationId } }
          : {};
        const role = assignment.builtInRole ?? assignment.customRoleId ?? "";
        if (inserted) {
          events.push({
            name: "role.assigned",
            actor,
            targetId: inserted.id,
            fields: {
              role,
              customRoleId: assignment.customRoleId,
              principalKind: "account",
              principalId: accountId,
              expiresAt: assignment.expiresAt?.toISOString() ?? null,
            },
            ...scope,
          });
        }
        events.push({
          name: "role.unassigned",
          actor,
          targetId: assignment.id,
          fields: { role, principalKind: "account", principalId: placeholderId, reason: "merged" },
          ...scope,
        });
      }
      await tx
        .delete(roleAssignments)
        .where(
          and(eq(roleAssignments.principalKind, "account"), eq(roleAssignments.principalId, placeholderId)),
        );
      await tx
        .update(accounts)
        .set({
          name: formerUserName(placeholderId),
          email: null,
          mergedIntoId: accountId,
          homeOrganizationId: null,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, placeholderId));
      await this.#audit.sealer?.linkSubject(tx, placeholderId, accountId);
      events.push({
        name: "account.placeholderMerged",
        actor,
        targetId: accountId,
        fields: { placeholderId, via: "administrator", ...counts },
      });
      await this.#audit.recordMany(tx, events);
      return counts;
    });
  }

  async anonymize(
    actor: Principal,
    accountId: string,
    input: { reason: string; confirmation: string },
  ): Promise<Anonymization> {
    const reason = input.reason.trim();
    if (reason.length === 0 || reason.length > 500) {
      throw new OrganizationError("invalidInput", "Give a reason of 1 to 500 characters");
    }
    return this.#database.transaction(async (tx) => {
      await this.#authorization.require(actor, MANAGE_ACCOUNTS, { type: "instance" }, { executor: tx });
      const [target] = await tx
        .select({
          id: accounts.id,
          type: accounts.type,
          state: accounts.state,
          name: accounts.name,
          email: accounts.email,
          home: accounts.homeOrganizationId,
        })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .for("update");
      if (!target || target.type === "service" || target.type === "portal" || target.state === "anonymized") {
        throw new OrganizationError("notFound", "The account does not exist or cannot be anonymized");
      }
      if (actor.type === "account" && actor.id === target.id) {
        throw new OrganizationError("anonymizeSelf", "An account cannot anonymize itself");
      }
      const [owner] = await tx.select({ id: instance.ownerAccountId }).from(instance);
      if (owner?.id === target.id) {
        throw new OrganizationError("instanceOwner", "Transfer the ownership of the instance first");
      }
      if (actor.type === "account" && owner?.id !== actor.id) {
        const targetInstanceAreas = await this.#authorization.heldAreas(target.id, "instance", null, tx);
        if (Object.keys(targetInstanceAreas).length > 0) {
          throw new ForbiddenError({
            action: "account.anonymize",
            resource: { type: "account", id: target.id },
            allowed: false,
            grants: [],
            denials: ["ownerOnly"],
          });
        }
      }
      if (input.confirmation.trim() !== target.name.trim()) {
        throw new OrganizationError("confirmationMismatch", "Type the name of the account to confirm");
      }

      const { events, ended } = await this.#memberships.endAll(tx, actor, target.id);
      const sessionIps = await tx
        .select({ clientIp: sessions.clientIp })
        .from(sessions)
        .where(eq(sessions.accountId, target.id));
      const endedSessions = await tx
        .delete(sessions)
        .where(eq(sessions.accountId, target.id))
        .returning({ id: sessions.id });
      const removedIdentities = await tx
        .delete(identities)
        .where(eq(identities.accountId, target.id))
        .returning({
          id: identities.id,
          providerId: identities.providerId,
          subject: identities.subject,
          email: identities.email,
          emailVerified: identities.emailVerified,
        });
      events.push({
        name: "account.anonymized",
        actor,
        targetId: target.id,
        fields: {
          reason,
          endedSessions: endedSessions.length,
          removedIdentities: removedIdentities.length,
          endedMemberships: ended,
        },
        ...(target.home ? { scope: { type: "organization" as const, id: target.home } } : {}),
      });
      await this.#audit.recordMany(tx, events);

      await this.#erase(
        tx,
        target,
        removedIdentities,
        sessionIps.flatMap((row) => (row.clientIp ? [row.clientIp] : [])),
      );
      return {
        endedSessions: endedSessions.length,
        removedIdentities: removedIdentities.length,
        endedMemberships: ended,
      };
    });
  }

  async #erase(
    tx: Transaction,
    target: { id: string; email: string | null },
    linked: { providerId: string; subject: string; email: string | null; emailVerified: boolean }[],
    clientIps: string[],
  ): Promise<void> {
    const id = target.id;
    const addresses = [
      ...new Set(
        [target.email, ...linked.map((identity) => (identity.emailVerified ? identity.email : null))].flatMap(
          (address) => (address ? [address.trim().toLowerCase()] : []),
        ),
      ),
    ];
    const lowerAddress = (column: typeof invitations.email | typeof signInRefusals.email) =>
      sql`lower(${column}) in (${sql.join(
        addresses.map((address) => sql`${address}`),
        sql`, `,
      )})`;
    for (const table of [
      authChallenges,
      accountTokens,
      totpCredentials,
      webauthnCredentials,
      recoveryCodes,
    ]) {
      await tx.delete(table).where(eq(table.accountId, id));
    }
    await tx.delete(knownDevices).where(eq(knownDevices.accountId, id));
    await tx.delete(providerGrants).where(eq(providerGrants.accountId, id));
    await tx.delete(providerDeactivations).where(eq(providerDeactivations.accountId, id));
    await tx.delete(apiTokens).where(eq(apiTokens.accountId, id));
    await tx
      .delete(notifications)
      .where(
        or(
          eq(notifications.recipientId, id),
          and(eq(notifications.targetType, "account"), eq(notifications.targetId, id)),
        ),
      );
    await tx.delete(settingValues).where(and(eq(settingValues.level, "user"), eq(settingValues.scopeId, id)));
    const invited =
      addresses.length > 0
        ? await tx
            .delete(invitations)
            .where(lowerAddress(invitations.email))
            .returning({ id: invitations.id })
        : [];
    await tx
      .delete(signInRefusals)
      .where(
        or(
          eq(signInRefusals.accountId, id),
          addresses.length > 0 ? lowerAddress(signInRefusals.email) : undefined,
          ...linked.map((identity) =>
            and(
              eq(signInRefusals.providerId, identity.providerId),
              eq(signInRefusals.subject, identity.subject),
            ),
          ),
        ),
      );
    if (target.email) {
      await tx
        .delete(registrationTokens)
        .where(sql`lower(${registrationTokens.email}) = lower(${target.email})`);
      const subject = accountSubject(target.email);
      await tx.delete(rateLimits).where(sql`${rateLimits.key} like ${`%:${subject}`}`);
      await tx.delete(signInFailures).where(sql`${signInFailures.key} like ${`%:${subject}`}`);
      await this.#forgetMail(tx, target.email);
    }
    for (const ip of new Set(clientIps.map(clientSubject))) {
      await tx.delete(rateLimits).where(sql`${rateLimits.key} like ${`%:client:${ip}`}`);
      await tx.delete(signInFailures).where(eq(signInFailures.key, `client:${ip}`));
    }
    await tx.execute(sql`delete from service_account_responsibles where account_id = ${id}`);
    await tx
      .update(accounts)
      .set({
        state: "anonymized",
        name: formerUserName(id),
        email: null,
        passwordHash: null,
        passwordChangedAt: null,
        emailVerifiedAt: null,
        homeOrganizationId: null,
        secondFactorResetAt: null,
        inactivityNotifiedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, id));
    const sealer = this.#audit.sealer;
    if (sealer) {
      await sealer.destroy(tx, id);
      for (const invitation of invited) await sealer.destroySubject(tx, invitation.id);
      await sealer.destroyByAddress(tx, addresses);
    }
  }

  async #forgetMail(tx: Transaction, email: string): Promise<void> {
    const queued = await tx
      .select({ id: mailOutbox.id, message: mailOutbox.message })
      .from(mailOutbox)
      .for("update");
    const recipient = email.trim().toLowerCase();
    const matching = queued.filter((row) => {
      if (!row.message) return false;
      try {
        const message = JSON.parse(this.#encryption.decryptString(row.message, messageContext(row.id))) as {
          to?: string;
        };
        return message.to?.trim().toLowerCase() === recipient;
      } catch {
        return false;
      }
    });
    if (matching.length > 0) {
      await tx.delete(mailOutbox).where(
        inArray(
          mailOutbox.id,
          matching.map((row) => row.id),
        ),
      );
    }
  }
}
