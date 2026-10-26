import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { type AccountService, emailSchema } from "../accounts/accounts.js";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { ANONYMOUS, accountPrincipal, type Principal, SYSTEM } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import type { AuditEvents, AuditLog } from "../audit/audit-log.js";
import { InvalidTokenError, RateLimitedError } from "../auth/errors.js";
import { accountSubject, clientSubject, type RateLimiter } from "../auth/throttle.js";
import { generateToken, hashToken, isWellFormedToken } from "../auth/tokens.js";
import type { Database, Transaction } from "../database/database.js";
import { afterKey, FIRST_PAGE, type Page, type PageRequest, pageLimit, toPage } from "../database/keyset.js";
import { defineJob, type JobContext, type JobQueue } from "../jobs/job-queue.js";
import type { MailService } from "../mail/mail-service.js";
import type { Language } from "../mail/templates.js";
import { languageSetting } from "../settings/builtin.js";
import type { SettingsService } from "../settings/service.js";
import { invitations, type MembershipKind, memberships, registrationTokens } from "./access-schema.js";
import type { MembershipService } from "./memberships.js";
import { lockOrganization } from "./memberships.js";
import { OrganizationError, type OrganizationService } from "./organizations.js";
import type { RoleInput, RoleService } from "./roles.js";
import { organizationDomains, organizations } from "./schema.js";
import { organizationSettingsChain, selfRegistrationSetting } from "./settings.js";

const INVITATION_DAYS = 7;
const REGISTRATION_HOURS = 24;
const HOUR_SECONDS = 60 * 60;
const ACCEPTANCES_PER_CLIENT = 30;
const REGISTRATIONS_PER_CLIENT = 10;
const REGISTRATIONS_PER_ADDRESS = 3;

export const registrationRequestJob = defineJob({
  name: "organizations.registration-request",
  duringMaintenance: "run",
  payload: z.object({ email: z.string().max(254) }),
  retryLimit: 3,
});

export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  kind: MembershipKind;
  role: string | null;
  membershipExpiresAt: Date | null;
  expiresAt: Date;
}

function scopeOf(organizationId: string) {
  return { type: "organization" as const, id: organizationId };
}

export interface InvitationPreview {
  state: "open" | "expired" | "accepted" | "revoked";
  email: string;
  expiresAt: Date;
  organizationName: string;
  invitedByName: string | null;
  knowledgeBaseName: string | null;
  newAccount: boolean;
}

export class InvitationService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #accounts: AccountService;
  readonly #memberships: MembershipService;
  readonly #roles: RoleService;
  readonly #organizations: OrganizationService;
  readonly #mail: MailService;
  readonly #settings: SettingsService;
  readonly #rateLimiter: RateLimiter;
  readonly #jobs: JobQueue | undefined;
  readonly #acceptListeners: ((tx: Transaction, invitationId: string, accountId: string) => Promise<void>)[] =
    [];

  onAccepted(listener: (tx: Transaction, invitationId: string, accountId: string) => Promise<void>): void {
    this.#acceptListeners.push(listener);
  }

  constructor(options: {
    database: Database;
    audit: AuditLog;
    accounts: AccountService;
    memberships: MembershipService;
    roles: RoleService;
    organizations: OrganizationService;
    mail: MailService;
    settings: SettingsService;
    rateLimiter: RateLimiter;
    jobs: JobQueue | undefined;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#accounts = options.accounts;
    this.#memberships = options.memberships;
    this.#roles = options.roles;
    this.#organizations = options.organizations;
    this.#mail = options.mail;
    this.#settings = options.settings;
    this.#rateLimiter = options.rateLimiter;
    this.#jobs = options.jobs;
  }

  async #language(email: string, organizationId: string): Promise<Language> {
    const existing = await this.#accounts.findByEmail(email);
    if (existing) return this.#mail.languageOf(existing.id);
    return this.#settings.get(languageSetting, organizationSettingsChain(organizationId));
  }

  async #link(path: string, token: string): Promise<string> {
    return `${await this.#settings.get(instanceUrlSetting, {})}${path}#token=${token}`;
  }

  async list(organizationId: string, page: PageRequest = FIRST_PAGE): Promise<Page<Invitation>> {
    const sortEmail = sql<string>`lower(${invitations.email})`;
    const rows = await this.#database
      .select({ invitation: invitations, sortEmail })
      .from(invitations)
      .where(
        and(
          eq(invitations.organizationId, organizationId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, sql`now()`),
          afterKey([sortEmail, invitations.id], page.after),
        ),
      )
      .orderBy(sortEmail, invitations.id)
      .limit(pageLimit(page));
    return toPage(
      rows,
      page,
      (row) => [row.sortEmail, row.invitation.id],
      ({ invitation: row }) => ({
        id: row.id,
        organizationId: row.organizationId,
        email: row.email,
        kind: row.kind,
        role: row.builtInRole ?? row.customRoleId,
        membershipExpiresAt: row.membershipExpiresAt,
        expiresAt: row.expiresAt,
      }),
    );
  }

  async create(
    actor: Principal,
    organizationId: string,
    input: {
      email: string;
      kind: MembershipKind;
      role?: RoleInput | null;
      membershipExpiresAt?: Date | null;
      responsibleAccountId?: string | null;
    },
    options: {
      within?: (tx: Transaction, invitationId: string) => Promise<void>;
      portal?: { spaceId: string; name: string };
    } = {},
  ): Promise<Invitation> {
    const email = emailSchema.parse(input.email.trim());
    if (input.role && input.kind !== "member") {
      throw new OrganizationError("invalidInvitation", "Guests and collaborators cannot receive roles");
    }
    if (input.membershipExpiresAt && input.membershipExpiresAt.getTime() <= Date.now()) {
      throw new OrganizationError("expiryInPast", "The expiry must be in the future");
    }
    const responsible =
      input.kind === "guest"
        ? (input.responsibleAccountId ?? (actor.type === "account" ? actor.id : null))
        : null;
    const token = generateToken();
    const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * HOUR_SECONDS * 1000);
    const language = await this.#language(email, organizationId);
    const link = await this.#link("/accept-invitation", token);
    const { invitation, mailId } = await this.#database.transaction(async (tx) => {
      await lockOrganization(tx, organizationId);
      const role = input.role
        ? await this.#roles.checkAssignable(actor, organizationId, input.role, tx)
        : null;
      if (responsible) {
        const [member] = await tx
          .select({ kind: memberships.kind })
          .from(memberships)
          .where(and(eq(memberships.organizationId, organizationId), eq(memberships.accountId, responsible)));
        if (member?.kind !== "member") {
          throw new OrganizationError(
            "invalidResponsible",
            "The responsible person must be a member of the organization",
          );
        }
      }
      const portalSpace = options.portal?.spaceId;
      await tx
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(invitations.organizationId, organizationId),
            sql`lower(${invitations.email}) = lower(${email})`,
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            portalSpace
              ? sql`exists (select 1 from portal_invitations pi
                  where pi.invitation_id = ${invitations.id} and pi.space_id = ${portalSpace})`
              : sql`true`,
          ),
        );
      const [row] = await tx
        .insert(invitations)
        .values({
          organizationId,
          email,
          kind: input.kind,
          builtInRole: input.role && "builtIn" in input.role ? input.role.builtIn : null,
          customRoleId: input.role && "customRoleId" in input.role ? input.role.customRoleId : null,
          tokenHash: hashToken(token),
          invitedBy: actor.type === "account" ? actor.id : null,
          responsibleAccountId: responsible,
          membershipExpiresAt: input.membershipExpiresAt ?? null,
          expiresAt,
        })
        .returning();
      if (!row) throw new Error("The invitation was not created");
      if (options.portal) {
        await tx.execute(sql`
          insert into portal_invitations (invitation_id, space_id) values (${row.id}, ${options.portal.spaceId})`);
      }
      await options.within?.(tx, row.id);
      const [organization] = await tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, organizationId));
      const [inviter] =
        actor.type === "account"
          ? await tx.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, actor.id))
          : [];
      const inviterName = inviter?.name ?? organization?.name ?? "";
      const id = options.portal
        ? await this.#mail.queue(tx, {
            to: email,
            template: "portalInvitation",
            language,
            params: { knowledgeBaseName: options.portal.name, inviterName, link, days: INVITATION_DAYS },
          })
        : await this.#mail.queue(tx, {
            to: email,
            template: "invitation",
            language,
            params: { organizationName: organization?.name ?? "", inviterName, link, days: INVITATION_DAYS },
          });
      await this.#audit.record(tx, {
        name: "invitation.created",
        actor,
        targetId: row.id,
        fields: { email, kind: input.kind, expiresAt: expiresAt.toISOString() },
        scope: scopeOf(organizationId),
      });
      return {
        invitation: {
          id: row.id,
          organizationId,
          email,
          kind: row.kind,
          role,
          membershipExpiresAt: row.membershipExpiresAt,
          expiresAt,
        },
        mailId: id,
      };
    });
    await this.#mail.dispatch([mailId]);
    return invitation;
  }

  async revoke(actor: Principal, organizationId: string, id: string): Promise<boolean> {
    return this.#database.transaction(async (tx) => {
      const revoked = await tx
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(invitations.id, id),
            eq(invitations.organizationId, organizationId),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
          ),
        )
        .returning({ id: invitations.id });
      if (revoked.length === 0) return false;
      await this.#audit.record(tx, {
        name: "invitation.revoked",
        actor,
        targetId: id,
        fields: {},
        scope: scopeOf(organizationId),
      });
      return true;
    });
  }

  async #limit(key: string, limit: number): Promise<void> {
    const result = await this.#rateLimiter.consume(key, limit, HOUR_SECONDS);
    if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
  }

  async preview(token: string, clientIp: string | undefined): Promise<InvitationPreview> {
    await this.#limit(`invitation:client:${clientSubject(clientIp ?? "unknown")}`, ACCEPTANCES_PER_CLIENT);
    if (!isWellFormedToken(token)) throw new InvalidTokenError();
    const inviter = alias(accounts, "inviter");
    const [row] = await this.#database
      .select({
        email: invitations.email,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
        revokedAt: invitations.revokedAt,
        expired: sql<boolean>`${invitations.expiresAt} <= now()`,
        organizationName: organizations.name,
        invitedByName: inviter.name,
        knowledgeBaseName: sql<string | null>`(select s.name from portal_invitations pi
          join spaces s on s.id = pi.space_id where pi.invitation_id = ${invitations.id})`,
      })
      .from(invitations)
      .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
      .leftJoin(inviter, eq(inviter.id, invitations.invitedBy))
      .where(eq(invitations.tokenHash, hashToken(token)));
    if (!row) throw new InvalidTokenError();
    const state = row.acceptedAt ? "accepted" : row.revokedAt ? "revoked" : row.expired ? "expired" : "open";
    const existing = state === "open" ? await this.#accounts.findByEmail(row.email) : null;
    return {
      state,
      email: row.email,
      expiresAt: row.expiresAt,
      organizationName: row.organizationName,
      invitedByName: row.invitedByName,
      knowledgeBaseName: row.knowledgeBaseName,
      newAccount: state === "open" && !existing,
    };
  }

  async accept(
    token: string,
    input: { name?: string; password?: string },
    clientIp: string | undefined,
  ): Promise<{
    accountId: string;
    organizationId: string;
    accountCreated: boolean;
    portalSpaceId: string | null;
  }> {
    await this.#limit(`invitation:client:${clientSubject(clientIp ?? "unknown")}`, ACCEPTANCES_PER_CLIENT);
    if (!isWellFormedToken(token)) throw new InvalidTokenError();
    return this.#database.transaction(async (tx) => {
      const [invitation] = await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(
          and(
            eq(invitations.tokenHash, hashToken(token)),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, sql`now()`),
          ),
        )
        .returning();
      if (!invitation) throw new InvalidTokenError();
      await lockOrganization(tx, invitation.organizationId);
      const events: AuditEvents = [];
      const portalRow = await tx.execute<{ space_id: string }>(
        sql`select space_id from portal_invitations where invitation_id = ${invitation.id}`,
      );
      const portalSpaceId = portalRow.rows[0]?.space_id ?? null;
      const existing = await this.#accounts.findByEmail(invitation.email, tx);
      let accountId: string;
      let kind = invitation.kind;
      if (existing) {
        if (existing.state !== "active") throw new InvalidTokenError();
        if (portalSpaceId && existing.type !== "portal") {
          throw new OrganizationError(
            "portalInvitationAccountExists",
            "This e-mail address already belongs to a Lunedo account. Sign in with it and ask the people who invited you to give that account access.",
          );
        }
        if (existing.type === "guest" && kind !== "guest") {
          throw new OrganizationError("invalidInvitation", "A guest account can only join as a guest");
        }
        if (existing.type === "standard" && kind === "guest") kind = "collaborator";
        accountId = existing.id;
        await tx
          .update(accounts)
          .set({ emailVerifiedAt: sql`coalesce(${accounts.emailVerifiedAt}, now())` })
          .where(eq(accounts.id, accountId));
      } else {
        if (kind === "collaborator") {
          throw new OrganizationError("invalidInvitation", "Collaborators join with their existing account");
        }
        if (!input.name || !input.password) {
          throw new OrganizationError(
            "accountDetailsRequired",
            "A name and a password are needed to create the account",
          );
        }
        const home =
          kind === "member"
            ? ((await this.#organizations.organizationForEmail(invitation.email, tx)) ??
              invitation.organizationId)
            : null;
        const created = await this.#accounts.create(
          tx,
          {
            type: portalSpaceId ? "portal" : kind === "guest" ? "guest" : "standard",
            email: invitation.email,
            name: input.name,
            password: input.password,
            homeOrganizationId: home,
            emailVerified: true,
          },
          { collect: events },
        );
        accountId = created.id;
      }
      const [membership] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, invitation.organizationId),
            eq(memberships.accountId, accountId),
          ),
        );
      if (!membership) {
        await this.#memberships.add(
          tx,
          ANONYMOUS,
          {
            organizationId: invitation.organizationId,
            accountId,
            kind,
            expiresAt: invitation.membershipExpiresAt,
            responsibleAccountId: invitation.responsibleAccountId,
          },
          { collect: events },
        );
      }
      if (kind === "member" && (invitation.builtInRole || invitation.customRoleId)) {
        await this.#roles.assign(
          invitation.invitedBy ? { type: "account", id: invitation.invitedBy } : SYSTEM,
          {
            scope: "organization",
            organizationId: invitation.organizationId,
            role: invitation.builtInRole
              ? { builtIn: invitation.builtInRole }
              : { customRoleId: invitation.customRoleId ?? "" },
            principal: { kind: "account", id: accountId },
          },
          { tx, collect: events },
        );
      }
      if (portalSpaceId) {
        await tx.execute(sql`
          insert into portal_readers (space_id, account_id) values (${portalSpaceId}, ${accountId})
          on conflict do nothing`);
      }
      for (const listener of this.#acceptListeners) await listener(tx, invitation.id, accountId);
      const accepting = accountPrincipal(accountId);
      events.push({
        name: "invitation.accepted",
        actor: accepting,
        targetId: invitation.id,
        fields: { accountId, accountCreated: !existing },
        scope: scopeOf(invitation.organizationId),
      });
      await this.#audit.recordMany(
        tx,
        events.map((event) =>
          event.actor === undefined || event.actor.type === "anonymous"
            ? { ...event, actor: accepting }
            : event,
        ),
      );
      await this.#audit.sealer?.linkSubject(tx, invitation.id, accountId);
      return {
        accountId,
        organizationId: invitation.organizationId,
        accountCreated: !existing,
        portalSpaceId,
      };
    });
  }

  async requestRegistration(email: string, clientIp: string | undefined): Promise<void> {
    await this.#limit(
      `registration:client:${clientSubject(clientIp ?? "unknown")}`,
      REGISTRATIONS_PER_CLIENT,
    );
    const allowed = await this.#rateLimiter.consume(
      `registration:account:${accountSubject(email)}`,
      REGISTRATIONS_PER_ADDRESS,
      HOUR_SECONDS,
    );
    if (!allowed.allowed || !this.#jobs) return;
    await this.#jobs.enqueue(registrationRequestJob, { email: email.trim() });
  }

  async selfRegistrationOpen(): Promise<boolean> {
    const rows = await this.#database
      .selectDistinct({ organizationId: organizationDomains.organizationId })
      .from(organizationDomains);
    for (const { organizationId } of rows) {
      if (await this.#settings.get(selfRegistrationSetting, organizationSettingsChain(organizationId)))
        return true;
    }
    return false;
  }

  handleRegistrationRequest = async (job: JobContext<{ email: string }>): Promise<void> => {
    const parsed = emailSchema.safeParse(job.payload.email);
    if (!parsed.success) return;
    const email = parsed.data;
    const organizationId = await this.#organizations.organizationForEmail(email);
    if (!organizationId || (await this.#accounts.findByEmail(email))) return;
    if (!(await this.#settings.get(selfRegistrationSetting, organizationSettingsChain(organizationId))))
      return;
    const token = generateToken();
    const link = await this.#link("/complete-registration", token);
    const language = await this.#settings.get(languageSetting, organizationSettingsChain(organizationId));
    const mailId = await this.#database.transaction(async (tx) => {
      await tx.insert(registrationTokens).values({
        organizationId,
        email,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + REGISTRATION_HOURS * HOUR_SECONDS * 1000),
      });
      const [organization] = await tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, organizationId));
      return this.#mail.queue(tx, {
        to: email,
        template: "registration",
        language,
        params: { organizationName: organization?.name ?? "", link, hours: REGISTRATION_HOURS },
      });
    });
    await this.#mail.dispatch([mailId]);
  };

  async completeRegistration(
    token: string,
    input: { name: string; password: string },
    clientIp: string | undefined,
  ): Promise<{ accountId: string; organizationId: string }> {
    await this.#limit(
      `registration:complete:${clientSubject(clientIp ?? "unknown")}`,
      ACCEPTANCES_PER_CLIENT,
    );
    if (!isWellFormedToken(token)) throw new InvalidTokenError();
    return this.#database.transaction(async (tx: Transaction) => {
      const [registration] = await tx
        .update(registrationTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(registrationTokens.tokenHash, hashToken(token)),
            isNull(registrationTokens.usedAt),
            gt(registrationTokens.expiresAt, sql`now()`),
          ),
        )
        .returning();
      if (!registration) throw new InvalidTokenError();
      if (
        !(await this.#settings.get(
          selfRegistrationSetting,
          organizationSettingsChain(registration.organizationId),
        ))
      ) {
        throw new InvalidTokenError();
      }
      const account = await this.#accounts.create(tx, {
        type: "standard",
        email: registration.email,
        name: input.name,
        password: input.password,
        homeOrganizationId: registration.organizationId,
        emailVerified: true,
      });
      return { accountId: account.id, organizationId: registration.organizationId };
    });
  }

  async cleanup(): Promise<number> {
    const invitationsRemoved = await this.#database.transaction(async (tx) => {
      const removed = await tx
        .delete(invitations)
        .where(sql`${invitations.expiresAt} < now() - interval '30 days'`)
        .returning({ id: invitations.id, email: invitations.email });
      const sealer = this.#audit.sealer;
      if (sealer)
        for (const invitation of removed) await sealer.tagAddress(tx, invitation.id, invitation.email);
      return removed.length;
    });
    const tokensRemoved = await this.#database
      .delete(registrationTokens)
      .where(sql`${registrationTokens.usedAt} is not null or ${registrationTokens.expiresAt} < now()`);
    return invitationsRemoved + (tokensRemoved.rowCount ?? 0);
  }
}
