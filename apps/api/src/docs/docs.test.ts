import { publicApiDocumentationSetting } from "@pagehall/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateOpenApi, serializeOpenApi } from "../openapi/document.js";
import {
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  signedInClient,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";
import { DOCS_CONTENT_SECURITY_POLICY } from "./docs.controller.js";

describe.skipIf(!databaseBaseUrl)("API reference page", () => {
  let test: AuthTestApp;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
  });

  afterAll(async () => {
    await test?.close();
  });

  it("is only for signed-in users by default", async () => {
    const anonymous = new TestClient(test.app);
    const page = await anonymous.get("/api/docs");
    expect(page.statusCode).toBe(401);
    expect(page.json()).toMatchObject({ code: "notSignedIn" });
    expect((await anonymous.get("/api/docs/openapi.json")).statusCode).toBe(401);
  });

  it("serves the page, its scripts and the description from the instance itself", async () => {
    const account = await createAccount(test, "reader@pagehall.test");
    const client = await signedInClient(test, account.email, account.password);
    const page = await client.get("/api/docs");
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(page.headers["content-security-policy"]).toBe(DOCS_CONTENT_SECURITY_POLICY);
    expect(page.body).not.toMatch(/https?:\/\//);
    const scripts = [...page.body.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
    expect(scripts).toEqual(["/api/docs/scalar.js", "/api/docs/init.js"]);
    expect(page.body).not.toMatch(/<script>|<style|style=/);

    const scalar = await client.get("/api/docs/scalar.js");
    expect(scalar.statusCode).toBe(200);
    expect(scalar.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(scalar.body.length).toBeGreaterThan(1_000_000);
    const init = await client.get("/api/docs/init.js");
    expect(init.body).toContain('"url":"/api/docs/openapi.json"');
    expect(init.body).toContain('"withDefaultFonts":false');
    expect(init.body).toContain('"telemetry":false');

    const description = await client.get("/api/docs/openapi.json");
    expect(description.body).toBe(serializeOpenApi(generateOpenApi()));
    expect(DOCS_CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(DOCS_CONTENT_SECURITY_POLICY).toContain("connect-src 'self'");
    expect(DOCS_CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
  });

  it("can be made public", async () => {
    await test.runtime.settings.set(publicApiDocumentationSetting, {}, "instance", true);
    try {
      const anonymous = new TestClient(test.app);
      expect((await anonymous.get("/api/docs")).statusCode).toBe(200);
      expect((await anonymous.get("/api/docs/openapi.json")).statusCode).toBe(200);
    } finally {
      await test.runtime.settings.set(publicApiDocumentationSetting, {}, "instance", false);
    }
  });
});
