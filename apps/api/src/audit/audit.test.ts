import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@lunedo/server";
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
import { csvCell } from "./audit.controller.js";

describe("CSV cells", () => {
  it("quote values and defuse formulas", () => {
    expect(csvCell("plain")).toBe('"plain"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("+1")).toBe(`"'+1"`);
    expect(csvCell("-1")).toBe(`"'-1"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell("\tx")).toBe(`"'\tx"`);
    expect(csvCell(null)).toBe("");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvCell(new Date("2026-10-01T08:00:00Z"))).toBe('"2026-10-01T08:00:00.000Z"');
  });
});

describe.skipIf(!databaseBaseUrl)("audit log through the API", () => {
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
    for (const name of ["=cmd|' /C calc'!A0", "Writers", "Readers"]) {
      await owner.post(`/api/v1/organizations/${organizationId}/groups`, { name });
    }
  });

  afterAll(async () => {
    await test?.close();
  });

  it("filters and pages the events of an organization", async () => {
    const base = `/api/v1/organizations/${organizationId}/audit-events`;
    const groups = await owner.get(`${base}?name=group.created&targetType=group`);
    expect(groups.statusCode).toBe(200);
    expect(groups.json().items.map((entry: { fields: { name: string } }) => entry.fields.name)).toEqual([
      "Readers",
      "Writers",
      "=cmd|' /C calc'!A0",
    ]);
    const first = (await owner.get(`${base}?name=group.created&limit=2`)).json();
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await owner.get(`${base}?name=group.created&limit=2&cursor=${first.nextCursor}`)).json();
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const future = new Date(Date.now() + 60_000).toISOString();
    expect((await owner.get(`${base}?from=${encodeURIComponent(future)}`)).json().items).toEqual([]);
    const ownerId = groups.json().items[0].actorId;
    const byActor = (await owner.get(`${base}?actorId=${ownerId}&limit=200`)).json().items;
    expect(byActor.every((entry: { actorId: string }) => entry.actorId === ownerId)).toBe(true);
    expect((await owner.get(`${base}?cursor=not-a-cursor`)).json()).toMatchObject({ code: "invalidInput" });
    expect((await owner.get(`${base}?limit=1000`)).statusCode).toBe(400);
  });

  it("streams a filtered CSV export and audits it", async () => {
    const response = await owner.get(
      `/api/v1/organizations/${organizationId}/audit-events/export?name=group.created`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(response.headers["content-disposition"]).toContain("attachment");
    const lines = response.body.trim().split("\r\n");
    expect(lines[0]).toBe(
      "time,actor,action,target,scope,changes,occurredAt,name,scopeType,scopeId,actorType,actorId,targetType,targetId,fields,clientIp,userAgent,requestId,sequence,id",
    );
    expect(lines[1]).toMatch(/^"[^"]+","Olivia Owner","group.created","Readers","[^"]+","name: Readers",/);
    expect(lines).toHaveLength(4);
    expect(response.body).toContain(`"{""name"":""=cmd|' /C calc'!A0""}"`);
    expect(lines.slice(1).every((line) => line.includes('"group.created"'))).toBe(true);
    const exported = (
      await owner.get(`/api/v1/organizations/${organizationId}/audit-events?name=audit.exported`)
    ).json();
    expect(exported.items[0].fields).toMatchObject({ scopeType: "organization", name: "group.created" });
  });

  it("lists events readably with names, scope and changes", async () => {
    const put = (value: string) => owner.put("/api/v1/instance/settings/branding.accentColor", { value });
    expect((await put("violet")).statusCode).toBe(204);
    expect((await put("blue")).statusCode).toBe(204);
    const [latest] = (await owner.get("/api/v1/instance/audit-events?name=settings.changed&limit=1")).json()
      .items;
    expect(latest).toMatchObject({
      labelKey: "audit.events.settings.changed",
      changeKind: "setting",
      actor: { type: "account", name: "Olivia Owner" },
      target: { type: "setting", id: "branding.accentColor" },
      scope: { type: "instance", id: null },
      changes: [{ property: "value", old: "violet", new: "blue" }],
    });
    expect(latest).not.toHaveProperty("labels");

    const groups = (
      await owner.get(`/api/v1/organizations/${organizationId}/audit-events?name=group.created&limit=1`)
    ).json().items;
    expect(groups[0]).toMatchObject({
      target: { type: "group", name: "Readers" },
      scope: { type: "organization", id: organizationId, name: expect.any(String) },
      changes: [{ property: "name", old: null, new: "Readers" }],
    });
  });

  it("gives the security auditor everything and members nothing", async () => {
    const auditor = await createAccount(test, "auditor@lunedo.test");
    const assigned = await owner.post("/api/v1/instance/role-assignments", {
      role: { builtIn: "securityAuditor" },
      principal: { kind: "account", id: auditor.id },
    });
    expect(assigned.statusCode, assigned.body).toBe(201);
    const auditorClient = await signedInClient(test, auditor.email, auditor.password);
    await addTotp(auditorClient);
    const all = await auditorClient.get("/api/v1/instance/audit-events?limit=200");
    expect(all.statusCode).toBe(200);
    const scopes = new Set(all.json().items.map((entry: { scopeType: string }) => entry.scopeType));
    expect(scopes).toEqual(new Set(["instance", "organization"]));
    const filtered = (
      await auditorClient.get(`/api/v1/instance/audit-events?organizationId=${organizationId}`)
    ).json();
    expect(filtered.items.every((entry: { scopeId: string }) => entry.scopeId === organizationId)).toBe(true);
    const csv = await auditorClient.get("/api/v1/instance/audit-events/export");
    expect(csv.statusCode).toBe(200);

    const member = await createAccount(test, "curious@lunedo.test");
    const memberClient = await signedInClient(test, member.email, member.password);
    expect((await memberClient.get(`/api/v1/organizations/${organizationId}/audit-events`)).statusCode).toBe(
      403,
    );
    expect((await memberClient.get("/api/v1/instance/audit-events")).statusCode).toBe(403);
    expect(
      (await memberClient.get(`/api/v1/organizations/${organizationId}/audit-events/export`)).statusCode,
    ).toBe(403);
  });
});
