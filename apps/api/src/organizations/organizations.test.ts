import {
  accountAttemptLimitSetting,
  clientAttemptLimitSetting,
  selfServiceOrganizationsSetting,
} from "@pagehall/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  firstOrganizationId,
  OWNER,
  signedInClient,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

function linkToken(text: string | undefined): string {
  const match = /#token=([\w-]{43})/.exec(text ?? "");
  if (!match?.[1]) throw new Error("The mail contains no link with a token");
  return match[1];
}

describe.skipIf(!databaseBaseUrl)("organizations through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let organizationId: string;
  let roleId: string;
  let groupId: string;
  let memberId: string;
  let memberClient: TestClient;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function mailTo(address: string) {
    await test.deliverMail();
    return test.mail.sent.filter((mail) => mail.to.toLowerCase() === address.toLowerCase()).at(-1);
  }

  it("lets the owner create an organization and assign a domain", async () => {
    const created = await owner.post("/api/v1/organizations", {
      name: "Engineering",
      language: "de",
      timeZone: "Europe/Vienna",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: "Engineering",
      slug: "engineering",
      language: "de",
      timeZone: "Europe/Vienna",
    });
    organizationId = created.json().id;

    const list = (await owner.get("/api/v1/organizations")).json().items;
    expect(list.map((entry: { name: string }) => entry.name)).toEqual(["Engineering", "Test organization"]);

    expect(
      (await owner.post(`/api/v1/organizations/${organizationId}/domains`, { domain: "engineering.example" }))
        .statusCode,
    ).toBe(201);
    expect(
      (
        await owner.post(`/api/v1/organizations/${organizationId}/domains`, { domain: "engineering.example" })
      ).json(),
    ).toMatchObject({
      code: "domainTaken",
    });
    expect((await owner.get(`/api/v1/organizations/${organizationId}/domains`)).json()).toEqual({
      items: [{ domain: "engineering.example" }],
      nextCursor: null,
    });
    expect(
      (await owner.patch(`/api/v1/organizations/${organizationId}`, { name: "Engineering Team" })).json(),
    ).toMatchObject({
      name: "Engineering Team",
    });
  });

  it("lets the owner create custom roles and groups", async () => {
    const role = await owner.post(`/api/v1/organizations/${organizationId}/roles`, {
      name: "Audit readers",
      areas: { auditLog: "view", membersAndGroups: "view" },
    });
    expect(role.statusCode).toBe(201);
    roleId = role.json().id;
    expect(
      (
        await owner.post(`/api/v1/organizations/${organizationId}/roles`, {
          name: "Bad",
          areas: { unknown: "view" },
        })
      ).statusCode,
    ).toBe(400);

    const group = await owner.post(`/api/v1/organizations/${organizationId}/groups`, { name: "Platform" });
    expect(group.statusCode).toBe(201);
    groupId = group.json().id;
    const details = (await owner.get(`/api/v1/groups/${groupId}`)).json();
    expect(details.managers).toEqual([expect.objectContaining({ name: "Olivia Owner" })]);
    expect(details).not.toHaveProperty("members");
    expect((await owner.get(`/api/v1/groups/${groupId}/members`)).json()).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("invites a member with a role who creates the account on acceptance", async () => {
    const invited = await owner.post(`/api/v1/organizations/${organizationId}/invitations`, {
      email: "new.member@engineering.example",
      kind: "member",
      role: { customRoleId: roleId },
    });
    expect(invited.statusCode).toBe(201);
    expect(invited.json()).not.toHaveProperty("token");
    expect(
      (await owner.get(`/api/v1/organizations/${organizationId}/invitations`)).json().items,
    ).toHaveLength(1);
    const mail = await mailTo("new.member@engineering.example");
    expect(mail?.subject).toBe("Olivia Owner hat Sie zu Engineering Team auf Test wiki eingeladen");

    const accepted = await new TestClient(test.app).post("/api/v1/invitations/accept", {
      token: linkToken(mail?.text),
      name: "New Member",
      password: "a member passphrase",
    });
    expect(accepted.json()).toMatchObject({ organizationId, accountCreated: true });
    memberId = accepted.json().accountId;
    memberClient = await signedInClient(test, "new.member@engineering.example", "a member passphrase");
    const members = (await memberClient.get(`/api/v1/organizations/${organizationId}/members`)).json().items;
    expect(members.map((entry: { name: string }) => entry.name).sort()).toEqual([
      "New Member",
      "Olivia Owner",
    ]);
    expect(members.find((entry: { accountId: string }) => entry.accountId === memberId).roles).toEqual([
      expect.objectContaining({ role: "Audit readers", customRoleId: roleId }),
    ]);
  });

  it("invites a guest who sees the organization but not its members", async () => {
    await owner.post(`/api/v1/organizations/${organizationId}/invitations`, {
      email: "guest@contractor.example",
      kind: "guest",
    });
    const mail = await mailTo("guest@contractor.example");
    await new TestClient(test.app).post("/api/v1/invitations/accept", {
      token: linkToken(mail?.text),
      name: "Contractor",
      password: "a guest passphrase",
    });
    const guest = await signedInClient(test, "guest@contractor.example", "a guest passphrase");
    expect((await guest.get(`/api/v1/organizations/${organizationId}`)).statusCode).toBe(200);
    const members = await guest.get(`/api/v1/organizations/${organizationId}/members`);
    expect(members.statusCode).toBe(403);
    expect(members.json()).toMatchObject({ code: "forbidden", denials: ["limitedMembership"] });
  });

  it("hides organizations and their groups from non-members", async () => {
    const outsider = await createAccount(test, "outsider@example.org");
    const client = await signedInClient(test, outsider.email, outsider.password);
    for (const url of [
      `/api/v1/organizations/${organizationId}`,
      `/api/v1/organizations/${organizationId}/members`,
      `/api/v1/groups/${groupId}`,
      "/api/v1/organizations/00000000-0000-7000-8000-000000000000",
    ]) {
      const response = await client.get(url);
      expect(response.statusCode, url).toBe(404);
    }
    expect(
      (await client.get("/api/v1/organizations")).json().items.map((entry: { id: string }) => entry.id),
    ).toEqual([await firstOrganizationId(test)]);
  });

  it("lets members create groups only when the organization allows it", async () => {
    expect(
      (await memberClient.post(`/api/v1/organizations/${organizationId}/groups`, { name: "Readers" }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await owner.request(
          "PUT",
          `/api/v1/organizations/${organizationId}/settings/organizations.membersCreateGroups`,
          {
            value: true,
          },
        )
      ).statusCode,
    ).toBe(204);
    const created = await memberClient.post(`/api/v1/organizations/${organizationId}/groups`, {
      name: "Readers",
    });
    expect(created.statusCode).toBe(201);
    expect(
      (await memberClient.post(`/api/v1/groups/${created.json().id}/members`, { accountId: memberId }))
        .statusCode,
    ).toBe(204);
  });

  it("refuses roles beyond one's own level", async () => {
    const response = await memberClient.post(`/api/v1/organizations/${organizationId}/role-assignments`, {
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: memberId },
    });
    expect(response.statusCode).toBe(403);
    const assignment = await owner.post(`/api/v1/organizations/${organizationId}/role-assignments`, {
      role: { builtIn: "administrator" },
      principal: { kind: "group", id: groupId },
    });
    expect(assignment.statusCode).toBe(201);
    expect((await owner.post(`/api/v1/groups/${groupId}/members`, { accountId: memberId })).statusCode).toBe(
      204,
    );
    expect((await memberClient.get(`/api/v1/organizations/${organizationId}/invitations`)).statusCode).toBe(
      200,
    );
    expect(
      (
        await memberClient.post(`/api/v1/organizations/${organizationId}/role-assignments`, {
          role: { builtIn: "owner" },
          principal: { kind: "account", id: memberId },
        })
      ).json(),
    ).toMatchObject({ code: "forbidden", denials: ["ownerOnly"] });
  });

  it("explains the permissions of a member", async () => {
    const decisions = (
      await owner.get(`/api/v1/organizations/${organizationId}/members/${memberId}/permissions`)
    ).json();
    const audit = decisions.find(
      (decision: { action: string }) => decision.action === "organization.audit.view",
    );
    expect(audit).toMatchObject({ allowed: true });
    expect(audit.grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: { customRoleId: roleId, name: "Audit readers" } }),
      ]),
    );
  });

  it("gives an instance administrator time-limited break-glass access and tells the owners", async () => {
    const administrator = await createAccount(test, "instance.admin@example.org");
    expect(
      (
        await owner.post("/api/v1/instance/role-assignments", {
          role: { builtIn: "administrator" },
          principal: { kind: "account", id: administrator.id },
        })
      ).statusCode,
    ).toBe(201);
    const client = await signedInClient(test, administrator.email, administrator.password);
    await addTotp(client);
    expect((await client.get(`/api/v1/organizations/${organizationId}/members`)).statusCode).toBe(404);
    expect(
      (await client.post(`/api/v1/organizations/${organizationId}/break-glass`, { reason: "short" }))
        .statusCode,
    ).toBe(400);
    const access = await client.post(`/api/v1/organizations/${organizationId}/break-glass`, {
      reason: "The owners are unreachable during an outage",
    });
    expect(access.statusCode).toBe(201);
    const notice = await mailTo(OWNER.email);
    expect(notice?.subject).toBe("Emergency access to Engineering Team on Test wiki");
    expect(notice?.text).toContain("The owners are unreachable during an outage");

    expect((await client.get(`/api/v1/organizations/${organizationId}/members`)).statusCode).toBe(200);
    expect(
      (await client.delete(`/api/v1/organizations/${organizationId}/break-glass/${access.json().id}`))
        .statusCode,
    ).toBe(204);
    expect((await client.get(`/api/v1/organizations/${organizationId}/members`)).statusCode).toBe(404);
  });

  it("deactivates an account and ends its sessions at once", async () => {
    const response = await owner.post(`/api/v1/accounts/${memberId}/deactivate`);
    expect(response.json()).toMatchObject({ endedSessions: 1 });
    expect((await memberClient.get("/api/v1/auth/session")).statusCode).toBe(401);
  });

  it("transfers the instance ownership to an instance administrator", async () => {
    const accounts = (await owner.get("/api/v1/instance/accounts")).json().items;
    const administrator = accounts.find(
      (account: { email: string }) => account.email === "instance.admin@example.org",
    );
    expect((await owner.post("/api/v1/instance/ownership", { accountId: administrator.id })).statusCode).toBe(
      204,
    );
    expect((await owner.post("/api/v1/instance/ownership", { accountId: administrator.id })).statusCode).toBe(
      403,
    );
    const audit = await test.runtime.pool.query(
      "select 1 from audit_events where name = 'instance.ownershipTransferred'",
    );
    expect(audit.rows).toHaveLength(1);
  });

  it("lets self-service creators own only their own organization", async () => {
    await test.runtime.settings.set(selfServiceOrganizationsSetting, {}, "instance", true);
    const creator = await createAccount(test, "creator@example.org");
    const victim = await createAccount(test, "victim@example.org");
    const client = await signedInClient(test, creator.email, creator.password);

    const refused = await client.post("/api/v1/organizations", {
      name: "Not yours",
      ownerAccountId: victim.id,
    });
    expect(refused.statusCode).toBe(403);
    const memberships = await test.runtime.pool.query("select 1 from memberships where account_id = $1", [
      victim.id,
    ]);
    expect(memberships.rows).toHaveLength(1);

    const own = await client.post("/api/v1/organizations", { name: "Mine", ownerAccountId: creator.id });
    expect(own.statusCode).toBe(201);
    expect((await client.post("/api/v1/organizations", { name: "Also mine" })).statusCode).toBe(201);
    const byAdministrator = await owner.post("/api/v1/organizations", {
      name: "For the victim",
      ownerAccountId: victim.id,
    });
    expect(byAdministrator.statusCode).toBe(201);
    await test.runtime.settings.set(selfServiceOrganizationsSetting, {}, "instance", false);
  });

  it("pages lists in the database with an opaque cursor", async () => {
    for (const name of ["Paged A", "paged b", "Paged C"]) {
      await owner.post(`/api/v1/organizations/${organizationId}/groups`, { name });
    }
    const url = `/api/v1/organizations/${organizationId}/groups`;
    const all = (await owner.get(`${url}?limit=200`)).json().items.map((group: { id: string }) => group.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: { id: string }[]; nextCursor: string | null } = (
        await owner.get(`${url}?limit=2${cursor ? `&cursor=${cursor}` : ""}`)
      ).json();
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((group: { id: string }) => group.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all);
    const tampered = Buffer.from(JSON.stringify(["x", "not-a-uuid"])).toString("base64url");
    const invalid = await owner.get(`${url}?cursor=${tampered}`);
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "invalidInput", fields: ["cursor"] });
  });

  it("lets the manage permission of a setting's area change it, and nothing less", async () => {
    const security = await owner.post(`/api/v1/organizations/${organizationId}/roles`, {
      name: "Security only",
      areas: { signInAndSecurity: "manage" },
    });
    const viewer = await owner.post(`/api/v1/organizations/${organizationId}/roles`, {
      name: "Settings viewer",
      areas: { settings: "view" },
    });
    const securityAccount = await createAccount(
      test,
      "security.officer@engineering.example",
      undefined,
      organizationId,
    );
    const viewerAccount = await createAccount(
      test,
      "settings.viewer@engineering.example",
      undefined,
      organizationId,
    );
    for (const [role, account] of [
      [security.json().id, securityAccount.id],
      [viewer.json().id, viewerAccount.id],
    ]) {
      await owner.post(`/api/v1/organizations/${organizationId}/role-assignments`, {
        role: { customRoleId: role },
        principal: { kind: "account", id: account },
      });
    }
    const officer = await signedInClient(test, securityAccount.email, securityAccount.password);
    const reader = await signedInClient(test, viewerAccount.email, viewerAccount.password);
    const url = (key: string) => `/api/v1/organizations/${organizationId}/settings/${key}`;
    expect((await officer.request("PUT", url("auth.passwordMinLength"), { value: 14 })).statusCode).toBe(204);
    expect(
      (await officer.request("PUT", url("organizations.membersCreateGroups"), { value: true })).statusCode,
    ).toBe(403);
    expect(
      (await reader.request("PUT", url("organizations.membersCreateGroups"), { value: true })).statusCode,
    ).toBe(403);
    expect((await reader.request("PUT", url("auth.passwordMinLength"), { value: 15 })).statusCode).toBe(403);
  });
});
