import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { accountAttemptLimitSetting, clientAttemptLimitSetting, SYSTEM } from "@pagehall/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { registeredRoutes } from "../access/route-access.verifier.js";
import { CSRF_HEADER } from "../http/csrf.js";
import {
  MAINTENANCE_ACCESS_REMOVALS,
  MAINTENANCE_ALLOWED_WRITES,
  writesDuringMaintenance,
} from "../http/maintenance.js";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  firstOrganizationId,
  OWNER,
  signedInClient,
} from "../testing/accounts.js";
import {
  type AuthTestApp,
  createAuthTestApp,
  databaseBaseUrl,
  TEST_ORIGIN,
  TestClient,
} from "../testing/auth-app.js";

const MEMBER = { email: "maintenance-member@pagehall.test", password: "a long enough passphrase" };
const ID = "0192f0e0-0000-7000-8000-000000000001";

describe("writesDuringMaintenance", () => {
  it("allows reading, signing in, SCIM and switching maintenance itself, and refuses everything else", () => {
    expect(writesDuringMaintenance("GET", "/api/v1/spaces/:spaceId")).toBe("allowed");
    expect(writesDuringMaintenance("HEAD", "/api/v1/files/:fileId")).toBe("allowed");
    expect(writesDuringMaintenance("post", "/api/v1/auth/sign-in")).toBe("allowed");
    expect(writesDuringMaintenance("PATCH", "/scim/v2/:providerId/Users/:id")).toBe("allowed");
    expect(writesDuringMaintenance("PUT", "/api/v1/instance/maintenance")).toBe("allowed");
    expect(writesDuringMaintenance("POST", "/api/v1/instance/backups/runs")).toBe("allowed");
    expect(writesDuringMaintenance("PUT", "/api/v1/instance/backups/target")).toBe("refused");
    expect(writesDuringMaintenance("POST", "/api/v1/instance/maintenance")).toBe("refused");
    expect(writesDuringMaintenance("PUT", "/api/v1/instance/settings/:key")).toBe("refused");
    expect(writesDuringMaintenance("POST", "/api/v1/a-route-added-later")).toBe("refused");
    expect(writesDuringMaintenance("POST", "/api/v1/share-links/:token/open")).toBe("allowed");
    expect(writesDuringMaintenance("POST", undefined)).toBe("refused");
  });
});

describe("removing access during maintenance", () => {
  it("allows every route that only removes access", () => {
    for (const route of [
      "DELETE /api/v1/account/sessions/:id",
      "POST /api/v1/account/sessions/end-others",
      "POST /api/v1/accounts/:accountId/deactivate",
      "DELETE /api/v1/account/tokens/:tokenId",
      "DELETE /api/v1/instance/identity-providers/:providerId/scim/tokens/:tokenId",
      "DELETE /api/v1/pages/:pageId/share-links/:linkId",
      "DELETE /api/v1/organizations/:organizationId/members/:accountId",
      "DELETE /api/v1/groups/:groupId/members/:accountId",
    ]) {
      const [method = "", path] = route.split(" ");
      expect(writesDuringMaintenance(method, path), route).toBe("allowed");
    }
  });

  it("keeps refusing routes that can also grant access or change content", () => {
    for (const route of [
      "PATCH /api/v1/organizations/:organizationId/members/:accountId",
      "POST /api/v1/pages/:pageId/access",
      "DELETE /api/v1/spaces/:spaceId/restricted-pages/:itemId/restrictions/:kind",
      "DELETE /api/v1/meetings/:meetingId/attendees/:accountId",
      "POST /api/v1/instance/accounts/:accountId/anonymize",
    ]) {
      const [method = "", path] = route.split(" ");
      expect(writesDuringMaintenance(method, path), route).toBe("refused");
    }
    expect(MAINTENANCE_ACCESS_REMOVALS.filter((route) => !/^(DELETE|POST) /.test(route))).toEqual([]);
  });
});

describe.skipIf(!databaseBaseUrl)("maintenance mode through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let member: TestClient;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    await createAccount(test, MEMBER.email, MEMBER.password);
    member = await signedInClient(test, MEMBER.email, MEMBER.password);
  });

  afterAll(async () => {
    await test?.close();
  });

  afterEach(async () => {
    await test.runtime.services.maintenance.set(SYSTEM, { enabled: false });
  });

  it("lets only instance administrators switch it and shows it to everyone", async () => {
    expect((await member.put("/api/v1/instance/maintenance", { enabled: true })).statusCode).toBe(403);
    expect((await member.get("/api/v1/instance/maintenance")).statusCode).toBe(403);
    expect(
      (await new TestClient(test.app).put("/api/v1/instance/maintenance", { enabled: true })).statusCode,
    ).toBe(401);

    const on = await owner.put("/api/v1/instance/maintenance", {
      enabled: true,
      message: "Update until 18:00",
    });
    expect(on.statusCode, on.body).toBe(200);
    expect(on.json()).toMatchObject({
      enabled: true,
      message: "Update until 18:00",
      blockSignIn: false,
      changedBy: { name: "Olivia Owner" },
    });
    const shown = await new TestClient(test.app).get("/api/v1/maintenance");
    expect(shown.statusCode).toBe(200);
    expect(shown.json()).toMatchObject({ enabled: true, message: "Update until 18:00" });
    expect(Object.keys(shown.json() as object).sort()).toEqual([
      "blockSignIn",
      "enabled",
      "message",
      "startedAt",
    ]);

    const tooLong = await owner.put("/api/v1/instance/maintenance", {
      enabled: true,
      message: "x".repeat(501),
    });
    expect(tooLong.statusCode).toBe(400);
    const off = await owner.put("/api/v1/instance/maintenance", { enabled: false });
    expect(off.json()).toMatchObject({ enabled: false, message: "" });
  });

  it("refuses changes for everyone, also administrators, and keeps reading working", async () => {
    await owner.put("/api/v1/instance/maintenance", { enabled: true, message: "Back at 18:00" });
    const refused = await member.put("/api/v1/account/preferences/locale.language", { value: "de" });
    expect(refused.statusCode).toBe(503);
    expect(refused.headers["retry-after"]).toBe("60");
    expect(refused.json()).toMatchObject({ code: "maintenanceMode", maintenanceMessage: "Back at 18:00" });
    const settings = await owner.put("/api/v1/instance/settings/instance.name", { value: "Changed" });
    expect(settings.statusCode).toBe(503);
    expect((await member.get("/api/v1/auth/session")).statusCode).toBe(200);
    expect((await owner.get("/api/v1/instance/settings")).statusCode).toBe(200);

    const signOut = await signedInClient(test, MEMBER.email, MEMBER.password);
    expect((await signOut.post("/api/v1/auth/sign-out")).statusCode).toBe(204);

    expect((await owner.put("/api/v1/instance/maintenance", { enabled: false })).statusCode).toBe(200);
    expect(
      (await member.put("/api/v1/account/preferences/locale.language", { value: "de" })).statusCode,
    ).toBe(204);
  });

  it("refuses every write route that is not on the list, before checking access", async () => {
    await test.runtime.services.maintenance.set(SYSTEM, { enabled: true, message: "" });
    const routes = registeredRoutes(
      test.app.get(DiscoveryService),
      test.app.get(MetadataScanner),
      test.app.get(Reflector),
    );
    const writes = routes
      .map((route) => ({ method: route.route.split(" ")[0] ?? "", path: route.path }))
      .filter((route) => !["GET", "HEAD", "OPTIONS"].includes(route.method));
    const listed = new Set(writes.map((route) => `${route.method} ${route.path}`));
    for (const allowed of [...MAINTENANCE_ALLOWED_WRITES, ...MAINTENANCE_ACCESS_REMOVALS]) {
      expect(listed.has(allowed), allowed).toBe(true);
    }

    const unexpected: string[] = [];
    for (const route of writes) {
      if (writesDuringMaintenance(route.method, route.path) === "allowed") continue;
      const response = await test.app.inject({
        method: route.method as "POST",
        url: route.path.replace(/:[A-Za-z]+/g, ID),
        headers: { [CSRF_HEADER]: "1", origin: TEST_ORIGIN, "content-type": "application/json" },
        payload: "{}",
      });
      if (response.statusCode !== 503 || (response.json() as { code?: string }).code !== "maintenanceMode") {
        unexpected.push(`${route.method} ${route.path}: ${response.statusCode}`);
      }
    }
    expect(unexpected).toEqual([]);
    expect(writes.length).toBeGreaterThan(100);
  });

  it("lets people and administrators remove access while everything else is refused", async () => {
    const organizationId = await firstOrganizationId(test);
    const person = await createAccount(test, "maintenance-leaver@pagehall.test", MEMBER.password);
    const first = await signedInClient(test, person.email, MEMBER.password);
    const second = await signedInClient(test, person.email, MEMBER.password);
    const created = await first.post("/api/v1/account/tokens", {
      name: "Leaked script",
      scopes: { organization: { membersAndGroups: "view" } },
    });
    expect(created.statusCode, created.body).toBe(201);
    const { token, apiToken } = created.json() as { token: string; apiToken: { id: string } };
    const bearer = { authorization: `Bearer ${token}` };
    const script = new TestClient(test.app);
    expect((await script.get(`/api/v1/organizations/${organizationId}/members`, bearer)).statusCode).toBe(
      200,
    );

    await owner.put("/api/v1/instance/maintenance", { enabled: true, message: "Update" });
    expect((await first.post("/api/v1/account/sessions/end-others")).statusCode).toBe(200);
    expect((await second.get("/api/v1/auth/session")).statusCode).toBe(401);
    expect((await first.delete(`/api/v1/account/tokens/${apiToken.id}`)).statusCode).toBe(204);
    expect((await script.get(`/api/v1/organizations/${organizationId}/members`, bearer)).statusCode).toBe(
      401,
    );

    const deactivated = await owner.post(`/api/v1/accounts/${person.id}/deactivate`);
    expect(deactivated.statusCode, deactivated.body).toBe(200);
    expect((await first.get("/api/v1/auth/session")).statusCode).toBe(401);
  });

  it("opens a share link during maintenance", async () => {
    await test.runtime.services.maintenance.set(SYSTEM, { enabled: true, message: "" });
    const opened = await new TestClient(test.app).post("/api/v1/share-links/not-a-real-link-token/open", {});
    expect(opened.statusCode).not.toBe(503);
  });

  it("pauses signing in for everyone except instance administrators when asked", async () => {
    await owner.put("/api/v1/instance/maintenance", {
      enabled: true,
      message: "Migration",
      blockSignIn: true,
    });
    const refused = await new TestClient(test.app).post("/api/v1/auth/sign-in", MEMBER);
    expect(refused.statusCode).toBe(503);
    expect(refused.json()).toMatchObject({ code: "signInPaused", maintenanceMessage: "Migration" });
    expect((await member.get("/api/v1/auth/session")).statusCode).toBe(200);

    const administrator = new TestClient(test.app);
    const signedIn = await administrator.post("/api/v1/auth/sign-in", OWNER);
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    expect(signedIn.json()).toMatchObject({ status: "secondFactorRequired" });

    await owner.put("/api/v1/instance/maintenance", {
      enabled: true,
      message: "Migration",
      blockSignIn: false,
    });
    expect((await new TestClient(test.app).post("/api/v1/auth/sign-in", MEMBER)).statusCode).toBe(200);
  });
});
