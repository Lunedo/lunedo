import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createServerRuntime, instanceUrlSetting, type ServerRuntime } from "@pagehall/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiContextOf } from "../context.js";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  OWNER,
  signedInClient,
  totpNow,
} from "../testing/accounts.js";
import {
  type AuthTestApp,
  createAuthTestApp,
  databaseBaseUrl,
  TEST_ORIGIN,
  TestClient,
} from "../testing/auth-app.js";
import { createTestApp } from "../testing/create-test-app.js";

const NEW_ADDRESS = "https://new.pagehall.test";

describe.skipIf(!databaseBaseUrl)("the address of the instance", () => {
  let test: AuthTestApp;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
  });

  afterAll(async () => {
    await test?.close();
  });

  let secret: string | null = null;

  async function signedInOwner(app: NestFastifyApplication) {
    const owner = new TestClient(app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    if (!secret) {
      secret = (await addTotp(owner)).secret;
      return owner;
    }
    const second = await owner.post("/api/v1/auth/sign-in/second-factor", {
      type: "totp",
      code: totpNow(secret, 1),
    });
    expect(second.statusCode, second.body).toBe(200);
    return owner;
  }

  it("cannot be changed here while the server environment sets it", async () => {
    const owner = await signedInOwner(test.app);
    expect((await owner.get("/api/v1/instance/address")).json()).toEqual({
      url: TEST_ORIGIN,
      source: "environment",
    });
    const refused = await owner.put("/api/v1/instance/address", { url: NEW_ADDRESS });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: "instanceUrlFromEnvironment" });
    const generic = await owner.put("/api/v1/instance/settings/instance.url", { value: NEW_ADDRESS });
    expect(generic.json()).toMatchObject({ code: "settingManagedElsewhere" });
    expect((await owner.get("/api/v1/instance/info")).json().url).toBe(TEST_ORIGIN);
  });

  describe("without the environment variable", () => {
    let runtime: ServerRuntime;
    let app: NestFastifyApplication;

    beforeAll(async () => {
      const env = Object.fromEntries(
        Object.entries(test.env).filter(([key]) => !(key in configuredSetupEnv)),
      );
      runtime = await createServerRuntime({ role: "api", env });
      app = await createTestApp(apiContextOf(runtime));
    });

    afterAll(async () => {
      await app?.close();
      await runtime?.close();
    });

    it("moves the instance, ends every session and records it", async () => {
      const owner = await signedInOwner(app);
      const person = await createAccount(test, "address-change@pagehall.test");
      const other = await signedInClient(test, person.email, person.password);
      expect((await owner.get("/api/v1/instance/address")).json()).toEqual({
        url: TEST_ORIGIN,
        source: "setting",
      });
      const invalid = await owner.put("/api/v1/instance/address", { url: "not an address" });
      expect(invalid.statusCode).toBe(400);

      const moved = await owner.put("/api/v1/instance/address", { url: NEW_ADDRESS });
      expect(moved.statusCode).toBe(200);
      expect(moved.json().url).toBe(NEW_ADDRESS);
      expect(moved.json().endedSessions).toBeGreaterThanOrEqual(2);
      expect((await owner.get("/api/v1/auth/session")).statusCode).toBe(401);
      expect((await other.get("/api/v1/auth/session")).statusCode).toBe(401);

      const fresh = new TestClient(app, { origin: NEW_ADDRESS });
      expect((await fresh.get("/api/v1/instance/info")).json().url).toBe(NEW_ADDRESS);
      const events = await runtime.pool.query("select fields from audit_events where name = $1", [
        "instance.addressChanged",
      ]);
      expect(events.rows).toEqual([
        { fields: { url: NEW_ADDRESS, previousUrl: TEST_ORIGIN, endedSessions: expect.any(Number) } },
      ]);
    });
  });

  it("takes the address from the environment again when the server starts", async () => {
    await test.runtime.settings.set(instanceUrlSetting, {}, "instance", NEW_ADDRESS);
    const restarted = await createServerRuntime({ role: "api", env: test.env });
    try {
      expect(await restarted.settings.get(instanceUrlSetting, {})).toBe(TEST_ORIGIN);
    } finally {
      await restarted.close();
    }
  });
});
