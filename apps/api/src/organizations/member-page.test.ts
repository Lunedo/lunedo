import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@lunedo/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  OWNER,
  signedInClient,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

interface Person {
  id: string;
  client: TestClient;
}

describe.skipIf(!databaseBaseUrl)("the page of a member", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let ownerId: string;
  let organizationId: string;
  let otherOrganizationId: string;
  let counter = 0;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    ownerId = (await owner.get("/api/v1/auth/session")).json().account.id;
    organizationId = (await owner.post("/api/v1/organizations", { name: "Nordwind" })).json().id;
    otherOrganizationId = (await owner.post("/api/v1/organizations", { name: "Elsewhere" })).json().id;
  });

  afterAll(async () => {
    await test?.close();
  });

  async function person(organization = organizationId): Promise<Person> {
    counter += 1;
    const email = `member-page${counter}@lunedo.test`;
    const account = await createAccount(test, email, "a long enough passphrase", organization);
    return { id: account.id, client: await signedInClient(test, email, "a long enough passphrase") };
  }

  async function space(by: TestClient, key: string, grants: unknown[] = [], confidential = false) {
    const created = await by.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Space ${key}`,
      key,
      visibility: "private",
      ...(confidential ? { confidential: true } : {}),
      grants,
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json() as { id: string; key: string };
  }

  async function administrator(): Promise<Person> {
    const admin = await person();
    const assigned = await owner.post(`/api/v1/organizations/${organizationId}/role-assignments`, {
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: admin.id },
    });
    expect(assigned.statusCode, assigned.body).toBe(201);
    return admin;
  }

  async function roleIn(spaceId: string, accountId: string): Promise<string | null> {
    const result = await test.runtime.pool.query<{ role: string }>(
      "select role::text as role from space_permissions where space_id = $1 and principal_kind = 'account' and principal_id = $2",
      [spaceId, accountId],
    );
    return result.rows[0]?.role ?? null;
  }

  it("shows groups and spaces of this organization only, without confidential and personal spaces", async () => {
    const member = await person();
    const group = (
      await owner.post(`/api/v1/organizations/${organizationId}/groups`, { name: `IT ${counter}` })
    ).json() as { id: string };
    expect(
      (await owner.post(`/api/v1/groups/${group.id}/members`, { accountId: member.id })).statusCode,
    ).toBe(204);
    const visible = await space(owner, `MPA${counter}`, [
      { principalKind: "group", principalId: group.id, role: "editor" },
    ]);
    const secret = await space(
      owner,
      `MPB${counter}`,
      [{ principalKind: "account", principalId: member.id, role: "reader" }],
      true,
    );
    const details = await owner.get(`/api/v1/organizations/${organizationId}/members/${member.id}`);
    expect(details.statusCode, details.body).toBe(200);
    const body = details.json();
    expect(body.groupDetails).toEqual([
      expect.objectContaining({ id: group.id, managedBy: null, viaProvider: null, spaces: 1 }),
    ]);
    expect(body.spaces.map((entry: { id: string }) => entry.id)).toEqual([visible.id]);
    expect(body.spaces[0]).toMatchObject({ role: "editor", sources: [{ kind: "group", groupId: group.id }] });
    expect(JSON.stringify(body)).not.toContain(secret.key);
    expect(body).toMatchObject({ homeOrganization: true, signIn: { password: true, providers: [] } });

    const outsider = await person(otherOrganizationId);
    expect(
      (await owner.get(`/api/v1/organizations/${organizationId}/members/${outsider.id}`)).statusCode,
    ).toBe(404);
    const colleague = await person();
    expect(
      (await colleague.client.get(`/api/v1/organizations/${organizationId}/members/${member.id}`)).statusCode,
    ).toBe(403);
  });

  it("leaves out spaces for member managers who may not view the spaces of the organization", async () => {
    const viewer = await person();
    const role = await owner.post(`/api/v1/organizations/${organizationId}/roles`, {
      name: `People viewer ${counter}`,
      areas: { membersAndGroups: "manage" },
    });
    expect(role.statusCode, role.body).toBe(201);
    const assigned = await owner.post(`/api/v1/organizations/${organizationId}/role-assignments`, {
      role: { customRoleId: role.json().id },
      principal: { kind: "account", id: viewer.id },
    });
    expect(assigned.statusCode, assigned.body).toBe(201);
    const details = await viewer.client.get(`/api/v1/organizations/${organizationId}/members/${ownerId}`);
    expect(details.statusCode, details.body).toBe(200);
    expect(details.json().spaces).toBeNull();
  });

  it("lets space admins add people to their own spaces without telling anyone", async () => {
    const spaceAdmin = await person();
    const member = await person();
    const own = await space(spaceAdmin.client, `MPC${counter}`);
    const added = await spaceAdmin.client.post(
      `/api/v1/organizations/${organizationId}/members/${member.id}/spaces`,
      { spaces: [{ spaceId: own.id, role: "commenter" }] },
    );
    expect(added.statusCode, added.body).toBe(204);
    expect(await roleIn(own.id, member.id)).toBe("commenter");
    const foreign = await space(owner, `MPD${counter}`);
    const refused = await spaceAdmin.client.post(
      `/api/v1/organizations/${organizationId}/members/${member.id}/spaces`,
      { spaces: [{ spaceId: foreign.id, role: "reader" }] },
    );
    expect(refused.statusCode).toBe(403);
    expect(await roleIn(foreign.id, member.id)).toBeNull();
    const notified = await test.runtime.pool.query<{ count: string }>(
      "select count(*) as count from notifications where type = 'space.memberAddedByAdministration' and target_id = $1",
      [own.id],
    );
    expect(Number(notified.rows[0]?.count)).toBe(0);
  });

  it("lets organization administrators add people to normal spaces, telling the space admins and the audit log", async () => {
    const admin = await administrator();
    const spaceAdmin = await person();
    const member = await person();
    const first = await space(spaceAdmin.client, `MPE${counter}`);
    const second = await space(spaceAdmin.client, `MPF${counter}`);
    const added = await admin.client.post(
      `/api/v1/organizations/${organizationId}/members/${member.id}/spaces`,
      {
        spaces: [
          { spaceId: first.id, role: "reader" },
          { spaceId: second.id, role: "editor" },
        ],
      },
    );
    expect(added.statusCode, added.body).toBe(204);
    expect(await roleIn(first.id, member.id)).toBe("reader");
    expect(await roleIn(second.id, member.id)).toBe("editor");
    const notified = await test.runtime.pool.query<{ recipient_id: string }>(
      "select recipient_id from notifications where type = 'space.memberAddedByAdministration' and target_id = any($1::text[])",
      [[first.id, second.id]],
    );
    expect(notified.rows.map((row) => row.recipient_id)).toEqual([spaceAdmin.id, spaceAdmin.id]);
    const events = await owner.get(
      `/api/v1/organizations/${organizationId}/audit-events?name=space.memberAddedByAdministration&personId=${member.id}`,
    );
    expect(events.statusCode, events.body).toBe(200);
    expect(events.json().items).toHaveLength(2);
  });

  it("refuses confidential and personal spaces, oneself, a role held already and other organizations, all or none", async () => {
    const admin = await administrator();
    const member = await person();
    const normal = await space(owner, `MPG${counter}`);
    const confidential = await space(owner, `MPH${counter}`, [], true);
    const personal = await member.client.post("/api/v1/account/personal-space", { overviewTitle: "Home" });
    expect(personal.statusCode, personal.body).toBeLessThan(300);
    const personalId = (personal.json() as { id: string }).id;
    const add = (spaces: { spaceId: string; role: string }[], accountId = member.id, by = admin.client) =>
      by.post(`/api/v1/organizations/${organizationId}/members/${accountId}/spaces`, { spaces });
    const both = await add([
      { spaceId: normal.id, role: "reader" },
      { spaceId: confidential.id, role: "reader" },
    ]);
    expect(both.statusCode).toBe(404);
    expect(await roleIn(normal.id, member.id)).toBeNull();
    expect((await add([{ spaceId: personalId, role: "reader" }])).statusCode).toBe(404);
    expect((await add([{ spaceId: normal.id, role: "admin" }], admin.id)).statusCode).toBe(403);
    const appoint = await add([{ spaceId: normal.id, role: "admin" }]);
    expect(appoint.statusCode).toBe(403);
    expect(appoint.json().code).toBe("administratorBySpaceAdmins");
    const robot = await owner.post(`/api/v1/organizations/${organizationId}/service-accounts`, {
      name: `Robot ${counter}`,
    });
    expect(robot.statusCode, robot.body).toBe(201);
    expect(
      (await add([{ spaceId: normal.id, role: "reader" }], robot.json().accountId ?? robot.json().id))
        .statusCode,
    ).toBe(400);
    expect(await roleIn(normal.id, admin.id)).toBeNull();
    expect((await add([{ spaceId: normal.id, role: "reader" }])).statusCode).toBe(204);
    expect((await add([{ spaceId: normal.id, role: "editor" }])).statusCode).toBe(409);
    const outsider = await person(otherOrganizationId);
    expect((await add([{ spaceId: normal.id, role: "reader" }], outsider.id)).statusCode).toBe(400);
    expect(
      (
        await add([
          { spaceId: normal.id, role: "reader" },
          { spaceId: normal.id, role: "editor" },
        ])
      ).statusCode,
    ).toBe(400);
  });

  it("filters the audit log by person within the organization", async () => {
    const member = await person();
    const group = (
      await owner.post(`/api/v1/organizations/${organizationId}/groups`, { name: `Audit ${counter}` })
    ).json() as { id: string };
    await owner.post(`/api/v1/groups/${group.id}/members`, { accountId: member.id });
    const events = await owner.get(
      `/api/v1/organizations/${organizationId}/audit-events?personId=${member.id}`,
    );
    expect(events.statusCode, events.body).toBe(200);
    const items = events.json().items as { name: string; scopeType: string; scopeId: string }[];
    expect(items.map((item) => item.name)).toContain("group.memberAdded");
    expect(items.every((item) => item.scopeType === "organization" && item.scopeId === organizationId)).toBe(
      true,
    );
    const instance = await owner.get(`/api/v1/instance/audit-events?personId=${member.id}&level=instance`);
    expect(instance.statusCode, instance.body).toBe(200);
    expect(
      (instance.json().items as { scopeType: string }[]).every((item) => item.scopeType === "instance"),
    ).toBe(true);
  });
});
