import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@pagehall/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  firstOrganizationId,
  OWNER,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

describe.skipIf(!databaseBaseUrl)("who can receive roles", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let organizationId: string;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    organizationId = await firstOrganizationId(test);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function assignmentCount(): Promise<number> {
    const result = await test.runtime.pool.query<{ count: number }>(
      "select count(*)::int as count from role_assignments",
    );
    return result.rows[0]?.count ?? 0;
  }

  it("refuses instance roles for all internal users", async () => {
    const before = await assignmentCount();
    const refused = await owner.post("/api/v1/instance/role-assignments", {
      role: { builtIn: "securityAuditor" },
      principal: { kind: "instanceUsers" },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ code: "roleNeedsAccountOrGroup" });
    expect(await assignmentCount()).toBe(before);
  });

  it("refuses organization roles for all members and all internal users", async () => {
    const before = await assignmentCount();
    for (const kind of ["organizationMembers", "instanceUsers"]) {
      const refused = await owner.post(`/api/v1/organizations/${organizationId}/role-assignments`, {
        role: { builtIn: "administrator" },
        principal: { kind },
      });
      expect(refused.statusCode, kind).toBe(400);
      expect(refused.json(), kind).toMatchObject({ code: "roleNeedsAccountOrGroup" });
    }
    expect(await assignmentCount()).toBe(before);
  });

  it("gives one role to several people and groups at once, or to none", async () => {
    const first = await createAccount(test, "batch-first@example.org");
    const second = await createAccount(test, "batch-second@example.org");
    for (const account of [first, second]) {
      await test.runtime.pool.query(
        "insert into memberships (id, organization_id, account_id, kind) values (gen_random_uuid(), $1, $2, 'member') on conflict do nothing",
        [organizationId, account.id],
      );
    }
    const group = await owner.post(`/api/v1/organizations/${organizationId}/groups`, { name: "Batch group" });
    expect(group.statusCode).toBe(201);
    const url = `/api/v1/organizations/${organizationId}/role-assignments/batch`;

    const before = await assignmentCount();
    const failed = await owner.post(url, {
      role: { builtIn: "administrator" },
      principals: [
        { kind: "account", id: first.id },
        { kind: "account", id: "01929b1e-0000-7000-8000-000000000000" },
      ],
    });
    expect(failed.statusCode).toBe(400);
    expect(await assignmentCount()).toBe(before);

    const assigned = await owner.post(url, {
      role: { builtIn: "administrator" },
      principals: [
        { kind: "account", id: first.id },
        { kind: "account", id: second.id },
        { kind: "group", id: group.json().id },
      ],
    });
    expect(assigned.statusCode).toBe(201);
    expect(
      assigned
        .json()
        .items.map((item: { principalKind: string; principalId: string }) => [
          item.principalKind,
          item.principalId,
        ]),
    ).toEqual([
      ["account", first.id],
      ["account", second.id],
      ["group", group.json().id],
    ]);
    expect(await assignmentCount()).toBe(before + 3);

    const instanceBatch = await owner.post("/api/v1/instance/role-assignments/batch", {
      role: { builtIn: "securityAuditor" },
      principals: [
        { kind: "account", id: first.id },
        { kind: "account", id: second.id },
      ],
    });
    expect(instanceBatch.statusCode).toBe(201);
    expect(instanceBatch.json().items).toHaveLength(2);
  });
});
