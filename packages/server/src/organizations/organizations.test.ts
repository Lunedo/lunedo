import { randomUUID } from "node:crypto";
import { proposeFormats } from "@lunedo/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { InvalidTokenError } from "../auth/errors.js";
import { ForbiddenError } from "../authorization/service.js";
import { languageSetting } from "../settings/builtin.js";
import { formatSettings } from "../settings/preferences.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { deliverPendingMail, testJobContext } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { LastOwnerError } from "./memberships.js";
import { OrganizationError } from "./organizations.js";
import {
  guestInactivityDaysSetting,
  organizationSettingsChain,
  selfRegistrationSetting,
} from "./settings.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("organizations", () => {
  let test: TestServices;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
    await test.pool.query(
      "insert into setting_values (id, level, scope_id, key, value) values (gen_random_uuid(), 'instance', '00000000-0000-0000-0000-000000000000', 'mail.smtp', $1)",
      [
        JSON.stringify({
          host: "smtp.example.org",
          port: 25,
          security: "none",
          username: null,
          from: "wiki@example.org",
        }),
      ],
    );
  });

  afterAll(async () => {
    await test?.close();
  });

  async function standard(home: string | null, email = `${randomUUID()}@example.org`): Promise<string> {
    const account = await test.database.transaction((tx) =>
      test.services.accounts.createStandard(tx, {
        email,
        name: "Person",
        password: "a long test passphrase",
        homeOrganizationId: home,
      }),
    );
    return account.id;
  }

  async function organization(name = `Organization ${randomUUID().slice(0, 8)}`) {
    const owner = await standard(null);
    const created = await test.services.organizations.createAsActor(SYSTEM, { name, ownerAccountId: owner });
    return { id: created.id, owner, slug: created.slug };
  }

  async function sentMailTo(address: string) {
    await deliverPendingMail(test.services, test.database);
    return test.mail.sent.filter((mail) => mail.to.toLowerCase() === address.toLowerCase());
  }

  function token(text: string | undefined): string {
    const match = /#token=([\w-]{43})/.exec(text ?? "");
    if (!match?.[1]) throw new Error("No token in the mail");
    return match[1];
  }

  it("creates organizations with a unique slug, language and time zone", async () => {
    const owner = await standard(null);
    const first = await test.services.organizations.createAsActor(SYSTEM, {
      name: "Café Ölberg",
      language: "de",
      timeZone: "Europe/Vienna",
      ownerAccountId: owner,
    });
    expect(first).toMatchObject({ slug: "cafe-olberg", language: "de", timeZone: "Europe/Vienna" });
    const second = await test.services.organizations.createAsActor(SYSTEM, {
      name: "Café Ölberg",
      ownerAccountId: owner,
    });
    expect(second.slug).toBe("cafe-olberg-2");
    await expect(
      test.services.organizations.createAsActor(SYSTEM, {
        name: "Other",
        slug: "Cafe-Olberg",
        ownerAccountId: owner,
      }),
    ).rejects.toMatchObject({ code: "slugTaken" });
    const account = await test.services.accounts.get(owner);
    expect(account?.homeOrganizationId).toBe(first.id);
  });

  it("gives a new organization the formats that fit its language and time zone", async () => {
    const owner = await standard(null);
    const vienna = await test.services.organizations.createAsActor(SYSTEM, {
      name: "Formats Vienna",
      language: "de",
      timeZone: "Europe/Vienna",
      ownerAccountId: owner,
    });
    const zurich = await test.services.organizations.createAsActor(SYSTEM, {
      name: "Formats Zurich",
      language: "de",
      timeZone: "Europe/Zurich",
      ownerAccountId: owner,
    });
    const formatsOf = async (organizationId: string) =>
      Object.fromEntries(
        await Promise.all(
          Object.entries(formatSettings).map(async ([name, setting]) => [
            name,
            await test.settings.get(setting, organizationSettingsChain(organizationId)),
          ]),
        ),
      );
    expect(await formatsOf(vienna.id)).toEqual(proposeFormats("de", "Europe/Vienna"));
    expect(await formatsOf(zurich.id)).toEqual(proposeFormats("de", "Europe/Zurich"));
    expect((await formatsOf(vienna.id)).timeFormat).toBe("24h");
  });

  it("writes mails in the language of the home organization unless the account chose one", async () => {
    const owner = await standard(null);
    const german = await test.services.organizations.createAsActor(SYSTEM, {
      name: `Deutsch ${randomUUID().slice(0, 6)}`,
      language: "de",
      ownerAccountId: owner,
    });
    const person = await standard(german.id);
    expect(await test.services.mail.languageOf(person)).toBe("de");
    await test.settings.set(languageSetting, { user: person }, "user", "en");
    expect(await test.services.mail.languageOf(person)).toBe("en");
  });

  it("assigns each domain to at most one organization", async () => {
    const first = await organization();
    const second = await organization();
    expect(await test.services.organizations.addDomain(SYSTEM, first.id, "Example.ORG")).toBe("example.org");
    await expect(
      test.services.organizations.addDomain(SYSTEM, second.id, "example.org"),
    ).rejects.toMatchObject({
      code: "domainTaken",
    });
    await expect(test.services.organizations.addDomain(SYSTEM, second.id, "not a domain")).rejects.toThrow();
    expect(await test.services.organizations.organizationForEmail("Someone@EXAMPLE.org")).toBe(first.id);
    expect(await test.services.organizations.removeDomain(SYSTEM, first.id, "example.org")).toBe(true);
  });

  describe("invitations", () => {
    it("create an account with a verified address when accepted, once only", async () => {
      const org = await organization();
      const email = `invited-${randomUUID().slice(0, 6)}@example.net`;
      const invitation = await test.services.invitations.create(accountPrincipal(org.owner), org.id, {
        email,
        kind: "member",
        role: { builtIn: "administrator" },
      });
      expect(invitation.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
      const mail = (await sentMailTo(email)).at(-1);
      expect(mail?.text).toContain("https://wiki.example.org/accept-invitation#token=");
      const stored = await test.pool.query<{ token_hash: Buffer }>(
        "select token_hash from invitations where id = $1",
        [invitation.id],
      );
      expect(stored.rows[0]?.token_hash).toHaveLength(32);

      await expect(
        test.services.invitations.accept(token(mail?.text), {}, "203.0.113.1"),
      ).rejects.toMatchObject({
        code: "accountDetailsRequired",
      });
      const accepted = await test.services.invitations.accept(
        token(mail?.text),
        { name: "Invited Person", password: "an invited passphrase" },
        "203.0.113.1",
      );
      expect(accepted).toMatchObject({ organizationId: org.id, accountCreated: true });
      const account = await test.pool.query(
        "select type, home_organization_id, email_verified_at is not null as verified from accounts where id = $1",
        [accepted.accountId],
      );
      expect(account.rows).toEqual([{ type: "standard", home_organization_id: org.id, verified: true }]);
      expect(
        await test.services.authorization.authorize(
          accountPrincipal(accepted.accountId),
          "organization.members.manage",
          {
            type: "organization",
            id: org.id,
          },
        ),
      ).toBe(true);
      await expect(
        test.services.invitations.accept(
          token(mail?.text),
          { name: "x", password: "an invited passphrase" },
          "203.0.113.1",
        ),
      ).rejects.toThrow(InvalidTokenError);
    });

    it("add guests with the inviter as responsible person and join existing accounts", async () => {
      const org = await organization();
      const guestEmail = `guest-${randomUUID().slice(0, 6)}@contractor.example`;
      await test.services.invitations.create(accountPrincipal(org.owner), org.id, {
        email: guestEmail,
        kind: "guest",
      });
      const guest = await test.services.invitations.accept(
        token((await sentMailTo(guestEmail)).at(-1)?.text),
        { name: "Guest", password: "a guest passphrase" },
        "203.0.113.2",
      );
      const membership = await test.pool.query(
        "select m.kind, m.responsible_account_id, a.type, a.home_organization_id from memberships m join accounts a on a.id = m.account_id where m.account_id = $1",
        [guest.accountId],
      );
      expect(membership.rows).toEqual([
        { kind: "guest", responsible_account_id: org.owner, type: "guest", home_organization_id: null },
      ]);

      const other = await organization();
      const memberEmail = `member-${randomUUID().slice(0, 6)}@example.com`;
      const existing = await standard(other.id, memberEmail);
      await test.services.invitations.create(accountPrincipal(org.owner), org.id, {
        email: memberEmail,
        kind: "collaborator",
      });
      const joined = await test.services.invitations.accept(
        token((await sentMailTo(memberEmail)).at(-1)?.text),
        {},
        "203.0.113.2",
      );
      expect(joined).toMatchObject({ accountId: existing, accountCreated: false });
      const kinds = await test.pool.query(
        "select organization_id, kind from memberships where account_id = $1 order by kind",
        [existing],
      );
      expect(kinds.rows).toEqual([
        { organization_id: other.id, kind: "member" },
        { organization_id: org.id, kind: "collaborator" },
      ]);
    });

    it("cannot be accepted after revocation or expiry, and need an account for collaborators", async () => {
      const org = await organization();
      const email = `revoked-${randomUUID().slice(0, 6)}@example.net`;
      const invitation = await test.services.invitations.create(accountPrincipal(org.owner), org.id, {
        email,
        kind: "member",
      });
      const revokedToken = token((await sentMailTo(email)).at(-1)?.text);
      expect(await test.services.invitations.revoke(accountPrincipal(org.owner), org.id, invitation.id)).toBe(
        true,
      );
      await expect(
        test.services.invitations.accept(
          revokedToken,
          { name: "x", password: "a long passphrase here" },
          "203.0.113.3",
        ),
      ).rejects.toThrow(InvalidTokenError);

      await test.services.invitations.create(accountPrincipal(org.owner), org.id, { email, kind: "member" });
      const expiredToken = token((await sentMailTo(email)).at(-1)?.text);
      await test.pool.query(
        "update invitations set expires_at = now() - interval '1 second' where lower(email) = lower($1)",
        [email],
      );
      await expect(
        test.services.invitations.accept(
          expiredToken,
          { name: "x", password: "a long passphrase here" },
          "203.0.113.3",
        ),
      ).rejects.toThrow(InvalidTokenError);

      const collaborator = `nobody-${randomUUID().slice(0, 6)}@example.net`;
      await test.services.invitations.create(accountPrincipal(org.owner), org.id, {
        email: collaborator,
        kind: "collaborator",
      });
      await expect(
        test.services.invitations.accept(
          token((await sentMailTo(collaborator)).at(-1)?.text),
          { name: "x", password: "a long passphrase here" },
          "203.0.113.3",
        ),
      ).rejects.toMatchObject({ code: "invalidInvitation" });
    });

    it("refuse roles above the inviter's own level", async () => {
      const org = await organization();
      const admin = await standard(org.id);
      await test.services.roles.assign(SYSTEM, {
        scope: "organization",
        organizationId: org.id,
        role: { builtIn: "administrator" },
        principal: { kind: "account", id: admin },
      });
      await expect(
        test.services.invitations.create(accountPrincipal(admin), org.id, {
          email: `owner-${randomUUID().slice(0, 6)}@example.net`,
          kind: "member",
          role: { builtIn: "owner" },
        }),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  it("makes the first standard membership the home organization, never a guest or collaborator one", async () => {
    const first = await organization();
    const second = await organization();
    const person = await standard(null);
    const add = (organizationId: string, kind: "member" | "collaborator" | "guest") =>
      test.database.transaction((tx) =>
        test.services.memberships.add(tx, accountPrincipal(first.owner), {
          organizationId,
          accountId: person,
          kind,
        }),
      );
    const home = async () => (await test.services.accounts.get(person))?.homeOrganizationId;
    const without = async () =>
      (await test.services.overview.listAccounts({ limit: 200 }, { withoutOrganization: true })).items.map(
        (item) => item.id,
      );

    expect(await without()).toContain(person);
    await add(second.id, "guest");
    expect(await home()).toBeNull();
    await test.pool.query("delete from memberships where account_id = $1", [person]);
    await add(second.id, "collaborator");
    expect(await home()).toBeNull();
    expect(await without()).not.toContain(person);

    await add(first.id, "member");
    expect(await home()).toBe(first.id);
    const audited = await test.pool.query(
      "select actor_type, fields from audit_events where name = 'account.organizationAssigned' and target_id = $1",
      [person],
    );
    expect(audited.rows).toEqual([{ actor_type: "system", fields: { organizationId: first.id } }]);
    const listed = await test.services.overview.listAccounts({ limit: 200 });
    expect(listed.items.find((item) => item.id === person)?.organizations).toEqual([
      { id: first.id, name: expect.any(String), home: true },
      { id: second.id, name: expect.any(String), home: false },
    ]);

    const third = await organization();
    await add(third.id, "member");
    expect(await home()).toBe(first.id);
  });

  it("registers accounts in the organization of an assigned domain only when allowed", async () => {
    const org = await organization();
    const domain = `${randomUUID().slice(0, 8)}.example`;
    await test.services.organizations.addDomain(SYSTEM, org.id, domain);
    const email = `self@${domain}`;
    await test.services.invitations.handleRegistrationRequest(
      testJobContext("organizations.registration-request", { email }),
    );
    expect(await sentMailTo(email)).toEqual([]);

    await test.settings.set(selfRegistrationSetting, { organization: org.id }, "organization", true);
    await test.services.invitations.handleRegistrationRequest(
      testJobContext("organizations.registration-request", { email }),
    );
    const mail = (await sentMailTo(email)).at(-1);
    expect(mail?.subject).toContain("Confirm your registration");
    const registered = await test.services.invitations.completeRegistration(
      token(mail?.text),
      { name: "Self", password: "a self registered passphrase" },
      "203.0.113.4",
    );
    expect(registered.organizationId).toBe(org.id);
    const account = await test.pool.query(
      "select home_organization_id, email_verified_at is not null as verified from accounts where id = $1",
      [registered.accountId],
    );
    expect(account.rows).toEqual([{ home_organization_id: org.id, verified: true }]);

    await test.services.invitations.handleRegistrationRequest(
      testJobContext("organizations.registration-request", {
        email: `other@unassigned-${randomUUID().slice(0, 6)}.example`,
      }),
    );
    await test.services.invitations.handleRegistrationRequest(
      testJobContext("organizations.registration-request", { email }),
    );
    expect(await sentMailTo(email)).toHaveLength(1);
  });

  describe("deactivation", () => {
    it("ends all sessions at once and is allowed for home organization administrators", async () => {
      const org = await organization();
      const admin = await standard(org.id);
      await test.services.roles.assign(SYSTEM, {
        scope: "organization",
        organizationId: org.id,
        role: { builtIn: "administrator" },
        principal: { kind: "account", id: admin },
      });
      const person = await standard(org.id);
      for (let i = 0; i < 2; i++) {
        await test.database.transaction((tx) =>
          test.services.sessions.create(tx, {
            accountId: person,
            kind: "full",
            methods: ["password"],
            client: {},
          }),
        );
      }
      expect(
        await test.services.authorization.authorize(accountPrincipal(admin), "account.deactivate", {
          type: "account",
          id: person,
        }),
      ).toBe(true);
      expect(await test.services.memberships.deactivate(accountPrincipal(admin), person)).toBe(2);
      expect((await test.pool.query("select 1 from sessions where account_id = $1", [person])).rows).toEqual(
        [],
      );
      await expect(test.services.memberships.deactivate(accountPrincipal(admin), org.owner)).rejects.toThrow(
        ForbiddenError,
      );
      await expect(
        test.services.memberships.deactivate(accountPrincipal(admin), admin),
      ).rejects.toMatchObject({
        code: "deactivateSelf",
      });
      await expect(test.services.memberships.deactivate(SYSTEM, org.owner)).rejects.toThrow(LastOwnerError);
    });

    it("hands guests of a leaving responsible person to the administrators", async () => {
      const org = await organization();
      const responsible = await standard(org.id);
      const guestEmail = `guest-${randomUUID().slice(0, 6)}@contractor.example`;
      await test.services.invitations.create(accountPrincipal(responsible), org.id, {
        email: guestEmail,
        kind: "guest",
      });
      const guest = await test.services.invitations.accept(
        token((await sentMailTo(guestEmail)).at(-1)?.text),
        { name: "Guest", password: "a guest passphrase" },
        "203.0.113.5",
      );
      await test.services.memberships.deactivate(SYSTEM, responsible);
      const membership = await test.pool.query(
        "select responsible_account_id from memberships where account_id = $1",
        [guest.accountId],
      );
      expect(membership.rows).toEqual([{ responsible_account_id: null }]);

      await test.settings.set(guestInactivityDaysSetting, { organization: org.id }, "organization", 1);
      await test.pool.query("update accounts set created_at = now() - interval '2 days' where id = $1", [
        guest.accountId,
      ]);
      await test.services.lifecycle.sendReminders();
      const ownerEmail = await test.pool.query<{ email: string }>(
        "select email from accounts where id = $1",
        [org.owner],
      );
      const notices = await sentMailTo(ownerEmail.rows[0]?.email ?? "");
      expect(notices.map((mail) => mail.subject)).toContain(
        `Guest Guest has been inactive in ${await nameOf(org.id)}`,
      );
      await test.services.lifecycle.sendReminders();
      expect(await sentMailTo(ownerEmail.rows[0]?.email ?? "")).toHaveLength(notices.length);
    });
  });

  async function nameOf(organizationId: string): Promise<string> {
    const result = await test.pool.query<{ name: string }>("select name from organizations where id = $1", [
      organizationId,
    ]);
    return result.rows[0]?.name ?? "";
  }

  it("reminds the responsible people before access expires", async () => {
    const org = await organization();
    const creator = await standard(org.id);
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: org.id,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: creator },
    });
    const person = await standard(org.id);
    await test.services.roles.assign(accountPrincipal(creator), {
      scope: "organization",
      organizationId: org.id,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: person },
      expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    });
    await test.services.lifecycle.sendReminders();
    const creatorEmail = await test.pool.query<{ email: string }>(
      "select email from accounts where id = $1",
      [creator],
    );
    const reminders = await sentMailTo(creatorEmail.rows[0]?.email ?? "");
    expect(reminders.map((mail) => mail.text)).toEqual([expect.stringContaining("The role administrator")]);
  });

  it("keeps a reminder due when its notification fails, so the next run sends it", async () => {
    await test.services.lifecycle.sendReminders();
    const org = await organization();
    const creator = await standard(org.id);
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: org.id,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: creator },
    });
    const person = await standard(org.id);
    const assignment = await test.services.roles.assign(accountPrincipal(creator), {
      scope: "organization",
      organizationId: org.id,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: person },
      expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    });
    const failure = vi
      .spyOn(test.services.notifications, "notify")
      .mockRejectedValueOnce(new Error("The node stopped"));
    await expect(test.services.lifecycle.sendReminders()).rejects.toThrow("The node stopped");
    failure.mockRestore();
    const marked = await test.pool.query("select expiry_reminded_at from role_assignments where id = $1", [
      assignment.id,
    ]);
    expect(marked.rows).toEqual([{ expiry_reminded_at: null }]);

    expect(await test.services.lifecycle.sendReminders()).toBe(1);
    const notices = await test.pool.query(
      "select params from notifications where recipient_id = $1 and type = 'access.expiring'",
      [creator],
    );
    expect(notices.rows).toEqual([
      { params: expect.objectContaining({ kind: "role", name: "administrator" }) },
    ]);
  });

  it("transfers the instance ownership to an instance administrator only", async () => {
    const owner = await standard(null);
    const administrator = await standard(null);
    const outsider = await standard(null);
    await test.pool.query("update instance set owner_account_id = $1", [owner]);
    await test.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: administrator },
    });
    await expect(
      test.services.memberships.transferOwnership(accountPrincipal(administrator), owner),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      test.services.memberships.transferOwnership(accountPrincipal(owner), outsider),
    ).rejects.toThrow(OrganizationError);
    await test.services.memberships.transferOwnership(accountPrincipal(owner), administrator);
    expect(await test.services.accounts.ownerId()).toBe(administrator);
    expect(
      await test.services.authorization.authorize(accountPrincipal(owner), "instance.accounts.manage", {
        type: "instance",
      }),
    ).toBe(true);
    expect(
      await test.services.authorization.authorize(accountPrincipal(owner), "instance.ownership.transfer", {
        type: "instance",
      }),
    ).toBe(false);
    await test.pool.query("update instance set owner_account_id = null");
  });

  it("lets organization administrators read only their own organization's audit log", async () => {
    const first = await organization();
    const second = await organization();
    const firstEvents = await test.services.auditReader.list(accountPrincipal(first.owner), {
      scope: { type: "organization", id: first.id },
    });
    expect(firstEvents.items.map((event) => event.name)).toEqual(
      expect.arrayContaining(["organization.created", "membership.added", "role.assigned"]),
    );
    await expect(
      test.services.auditReader.list(accountPrincipal(first.owner), {
        scope: { type: "organization", id: second.id },
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      test.services.auditReader.list(accountPrincipal(first.owner), {
        scope: { type: "instance", id: "00000000-0000-0000-0000-000000000000" },
      }),
    ).rejects.toThrow(ForbiddenError);
    const auditor = await standard(null);
    await test.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "securityAuditor" },
      principal: { kind: "account", id: auditor },
    });
    expect(
      (
        await test.services.auditReader.list(accountPrincipal(auditor), {
          scope: { type: "organization", id: second.id },
        })
      ).items.length,
    ).toBeGreaterThan(0);
    const results = await test.services.audit.verify();
    expect(results.filter((result) => result.scope.id === first.id)).toEqual([
      { scope: { type: "organization", id: first.id }, entries: expect.any(Number), broken: null },
    ]);
  });
});
