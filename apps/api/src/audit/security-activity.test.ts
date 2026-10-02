import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@pagehall/server";
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

describe.skipIf(!databaseBaseUrl)("own security activity", () => {
  let test: AuthTestApp;
  let owner: TestClient;

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

  it("lists the own sign-ins, factor changes and tokens and nothing of other people", async () => {
    const person = await createAccount(test, "activity@example.org");
    const failed = await new TestClient(test.app).post("/api/v1/auth/sign-in", {
      email: person.email,
      password: "not the right passphrase",
    });
    expect(failed.statusCode).toBe(401);
    const client = await signedInClient(test, person.email, person.password);
    await addTotp(client);
    const created = await client.post("/api/v1/account/tokens", {
      name: "Backup script",
      scopes: { organization: { spaces: "view" } },
    });
    expect(created.statusCode).toBe(201);
    expect((await client.delete(`/api/v1/account/tokens/${created.json().apiToken.id}`)).statusCode).toBe(
      204,
    );
    expect(
      (await client.put("/api/v1/account/preferences/appearance.colorMode", { value: "dark" })).statusCode,
    ).toBe(204);
    const other = await createAccount(test, "someone-else@example.org");
    await signedInClient(test, other.email, other.password);

    const response = await client.get(`/api/v1/accounts/${person.id}/security-activity`);
    expect(response.statusCode).toBe(200);
    const items = response.json().items as {
      name: string;
      targetId: string;
      clientIp: string | null;
      userAgent: string | null;
      scope: { type: string; id: string };
    }[];
    const names = items.map((item) => item.name);
    expect(names.slice(0, 2)).toEqual(["apiToken.revoked", "apiToken.created"]);
    expect(names.slice(2, 4).sort()).toEqual(["twoFactor.recoveryCodesGenerated", "twoFactor.totpAdded"]);
    expect(names.slice(4)).toEqual(["auth.signedIn", "auth.signInFailed"]);
    const signIn = items.find((item) => item.name === "auth.signedIn");
    expect(signIn).toMatchObject({ targetId: person.id, scope: { type: "account", id: person.id } });
    expect(items.every((item) => item.targetId !== other.id)).toBe(true);

    const page = await client.get(`/api/v1/accounts/${person.id}/security-activity?limit=2`);
    expect(page.json().items).toHaveLength(2);
    const next = await client.get(
      `/api/v1/accounts/${person.id}/security-activity?limit=2&cursor=${page.json().nextCursor}`,
    );
    expect(next.json().items.map((item: { name: string }) => item.name)).toEqual(names.slice(2, 4));
  });

  it("does not show the activity of another account, not even to administrators", async () => {
    const person = await createAccount(test, "private-activity@example.org");
    const client = await signedInClient(test, person.email, person.password);
    const otherId = (await owner.get("/api/v1/auth/session")).json().account.id;
    expect((await client.get(`/api/v1/accounts/${otherId}/security-activity`)).statusCode).toBe(403);
    expect((await owner.get(`/api/v1/accounts/${person.id}/security-activity`)).statusCode).toBe(403);
  });
});
