import { accountAttemptLimitSetting, clientAttemptLimitSetting, dateFormatSetting } from "@lunedo/server";
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

interface Preference {
  key: string;
  value: unknown;
  source: string;
  levels: { level: string; value: unknown }[];
}

describe.skipIf(!databaseBaseUrl)("own preferences and permissions", () => {
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

  async function preferences(client: TestClient): Promise<Preference[]> {
    const response = await client.get("/api/v1/account/preferences");
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it("does not audit personal preferences but keeps auditing everything else", async () => {
    const person = await createAccount(test, "quiet-preferences@example.org");
    const client = await signedInClient(test, person.email, person.password);
    const audited = async () =>
      (
        await test.runtime.pool.query<{ target_id: string }>(
          "select target_id from audit_events where name = 'settings.changed' and fields->>'scopeId' = $1 order by sequence",
          [person.id],
        )
      ).rows.map((row) => row.target_id);
    for (const [key, value] of [
      ["appearance.colorMode", "dark"],
      ["appearance.textSize", 1.125],
      ["locale.language", "de"],
      ["locale.dateFormat", "YYYY-MM-DD"],
      ["locale.timeZone", "Europe/Vienna"],
    ] as const) {
      expect((await client.put(`/api/v1/account/preferences/${key}`, { value })).statusCode, key).toBe(204);
    }
    expect(await audited()).toEqual([]);
    expect(
      (
        await client.put("/api/v1/account/preferences/notifications.guestExpiring.email", {
          value: "off",
        })
      ).statusCode,
    ).toBe(204);
    expect(await audited()).toEqual(["notifications.guestExpiring.email"]);
  });

  it("lists the settings of the user level with their source", async () => {
    const list = await preferences(owner);
    expect(list.map((entry) => entry.key)).toEqual(
      expect.arrayContaining([
        "locale.language",
        "locale.timeZone",
        "locale.dateFormat",
        "appearance.colorMode",
        "appearance.textSize",
        "appearance.sidebarCollapsed",
      ]),
    );
    expect(list.map((entry) => entry.key)).not.toContain("branding.accentColor");
    expect(list.find((entry) => entry.key === "appearance.colorMode")).toMatchObject({
      value: "system",
      source: "default",
    });
  });

  it("inherits from the organization until the user sets an own value", async () => {
    const member = await createAccount(test, "preferences@example.org");
    const client = await signedInClient(test, member.email, member.password);
    await test.runtime.settings.set(
      dateFormatSetting,
      { organization: organizationId },
      "organization",
      "DD.MM.YYYY",
    );

    const inherited = (await preferences(client)).find((entry) => entry.key === "locale.dateFormat");
    expect(inherited).toMatchObject({ value: "DD.MM.YYYY", source: "organization" });
    expect(inherited?.levels.map((level) => level.level)).toEqual(["instance", "organization", "user"]);

    expect(
      (await client.put("/api/v1/account/preferences/locale.dateFormat", { value: "YYYY-MM-DD" })).statusCode,
    ).toBe(204);
    expect((await preferences(client)).find((entry) => entry.key === "locale.dateFormat")).toMatchObject({
      value: "YYYY-MM-DD",
      source: "user",
    });

    expect(
      (await client.put("/api/v1/account/preferences/locale.dateFormat", { clear: true })).statusCode,
    ).toBe(204);
    expect((await preferences(client)).find((entry) => entry.key === "locale.dateFormat")).toMatchObject({
      value: "DD.MM.YYYY",
      source: "organization",
    });
  });

  it("rejects invalid values, unknown keys, settings of other levels and locks", async () => {
    const invalid = await owner.put("/api/v1/account/preferences/appearance.textSize", { value: 3 });
    expect(invalid.json()).toMatchObject({ code: "invalidSetting" });
    expect((await owner.put("/api/v1/account/preferences/unknown.key", { value: 1 })).statusCode).toBe(404);
    expect(
      (await owner.put("/api/v1/account/preferences/branding.accentColor", { value: "red" })).statusCode,
    ).toBe(404);
    expect(
      (await owner.put("/api/v1/account/preferences/appearance.density", { value: "compact", locked: true }))
        .statusCode,
    ).toBe(400);
    expect((await owner.put("/api/v1/account/preferences/appearance.density", {})).statusCode).toBe(400);
  });

  it("keeps preferences per account", async () => {
    expect(
      (await owner.put("/api/v1/account/preferences/appearance.density", { value: "compact" })).statusCode,
    ).toBe(204);
    const other = await createAccount(test, "other.preferences@example.org");
    const client = await signedInClient(test, other.email, other.password);
    expect((await preferences(client)).find((entry) => entry.key === "appearance.density")?.value).toBe(
      "default",
    );
    expect((await preferences(owner)).find((entry) => entry.key === "appearance.density")?.value).toBe(
      "compact",
    );
  });

  it("needs a session", async () => {
    const anonymous = new TestClient(test.app);
    expect((await anonymous.get("/api/v1/account/preferences")).statusCode).toBe(401);
    expect((await anonymous.get("/api/v1/account/permissions")).statusCode).toBe(401);
  });

  it("lists the actions the account may perform", async () => {
    const own = (await owner.get(`/api/v1/account/permissions?organizationId=${organizationId}`)).json();
    expect(own.instance).toEqual(
      expect.arrayContaining(["instance.organizations.manage", "instance.settings.manage"]),
    );
    expect(own.organization).toEqual(
      expect.arrayContaining([
        "organization.view",
        "organization.members.manage",
        "organization.settings.manage",
      ]),
    );

    const member = await createAccount(test, "plain.member@example.org");
    const client = await signedInClient(test, member.email, member.password);
    const limited = (await client.get(`/api/v1/account/permissions?organizationId=${organizationId}`)).json();
    expect(limited.instance).toEqual(["instance.personalSpace.use", "instance.content.view"]);
    expect(limited.organization).toContain("organization.view");
    expect(limited.organization).toContain("organization.members.view");
    expect(limited.organization).not.toContain("organization.members.manage");
    expect(own.grantableAreas.organization).toMatchObject({ membersAndGroups: "manage", auditLog: "manage" });
    expect(own.grantableAreas.instance).toMatchObject({ accounts: "manage" });
    expect(limited.grantableAreas).toEqual({ instance: {}, organization: { membersAndGroups: "view" } });

    const created = await owner.post("/api/v1/organizations", { name: "Elsewhere" });
    const foreign = (
      await client.get(`/api/v1/account/permissions?organizationId=${created.json().id}`)
    ).json();
    expect(foreign.organization).toEqual([]);
    expect((await client.get("/api/v1/account/permissions")).json().organization).toEqual([]);
  });
});
