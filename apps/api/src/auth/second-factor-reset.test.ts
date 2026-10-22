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

describe.skipIf(!databaseBaseUrl)("resetting another account's second factor through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let ownerId: string;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    ownerId = (await owner.get("/api/v1/auth/session")).json().account.id;
  });

  afterAll(async () => {
    await test?.close();
  });

  it("needs a reason and a recent sign-in, then forces a new second factor", async () => {
    const person = await createAccount(test, "reset-me@example.org");
    const client = await signedInClient(test, person.email, person.password);
    await addTotp(client);
    const url = `/api/v1/accounts/${person.id}/second-factor/reset`;

    expect((await owner.post(url, { reason: "   " })).json()).toMatchObject({ code: "invalidInput" });
    expect((await owner.post(url, { reason: "x".repeat(501) })).json()).toMatchObject({
      code: "invalidInput",
    });

    await test.runtime.pool.query(
      "update sessions set reauthenticated_at = now() - interval '1 hour', created_at = now() - interval '1 hour' where account_id = $1",
      [ownerId],
    );
    const stale = await owner.post(url, { reason: "Lost phone" });
    expect(stale.statusCode).toBe(403);
    expect(stale.json()).toMatchObject({ code: "reauthenticationRequired" });
    await owner.post("/api/v1/auth/reauthenticate", { method: "password", password: OWNER.password });

    const reset = await owner.post(url, { reason: "Lost phone" });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({ endedSessions: 1 });
    expect((await client.get("/api/v1/auth/session")).statusCode).toBe(401);

    const again = new TestClient(test.app);
    const signIn = await again.post("/api/v1/auth/sign-in", {
      email: person.email,
      password: person.password,
    });
    expect(signIn.json()).toMatchObject({ status: "signedIn", sessionKind: "secondFactorSetup" });
    expect((await again.get("/api/v1/account/sessions")).json()).toMatchObject({
      code: "secondFactorSetupRequired",
    });
    await addTotp(again);
    expect((await again.get("/api/v1/auth/session")).json()).toMatchObject({ sessionKind: "full" });
    expect((await again.get("/api/v1/account/security")).json()).toMatchObject({
      totp: true,
      secondFactorRequired: false,
    });
  });

  it("refuses the own account and people without the permission", async () => {
    expect(
      (await owner.post(`/api/v1/accounts/${ownerId}/second-factor/reset`, { reason: "Me" })).json(),
    ).toMatchObject({
      code: "resetOwnSecondFactor",
    });
    const person = await createAccount(test, "plain-member@example.org");
    const client = await signedInClient(test, person.email, person.password);
    const forbidden = await client.post(`/api/v1/accounts/${ownerId}/second-factor/reset`, {
      reason: "Takeover",
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("treats an ID in capital letters exactly like the same ID in small letters", async () => {
    await owner.post("/api/v1/auth/reauthenticate", { method: "password", password: OWNER.password });
    const upper = ownerId.toUpperCase();
    expect(
      (await owner.post(`/api/v1/accounts/${upper}/second-factor/reset`, { reason: "Me" })).json(),
    ).toMatchObject({ code: "resetOwnSecondFactor" });
    expect((await owner.post(`/api/v1/accounts/${upper}/sessions/end`, {})).json()).toMatchObject({
      code: "endOwnSessions",
    });
    expect((await owner.post(`/api/v1/accounts/${upper}/deactivate`, {})).json()).toMatchObject({
      code: "deactivateSelf",
    });

    const person = await createAccount(test, "capital-letters@example.org");
    for (const path of [
      (id: string) => `/api/v1/instance/accounts/${id}`,
      (id: string) => `/api/v1/accounts/${id}/security-activity`,
    ]) {
      for (const id of [person.id, ownerId]) {
        const lower = await owner.get(path(id));
        const capital = await owner.get(path(id.toUpperCase()));
        expect(capital.statusCode, path(id)).toBe(lower.statusCode);
        expect(capital.json(), path(id)).toEqual(lower.json());
      }
    }
  });
});
