import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { BASE_URL } from "../support/environment.js";
import { identityProviders, newTestUser, TEST_USERS } from "../support/idp.js";

const REDIRECT_URI = `${BASE_URL}/e2e/identity-provider-callback`;

function base64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function claimsOf(token: string): Record<string, unknown> {
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

for (const provider of identityProviders) {
  test.describe(provider.name, () => {
    test("publishes its discovery document under the issuer", async () => {
      const response = await fetch(`${provider.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
      expect(response.ok).toBe(true);
      const discovery = (await response.json()) as { issuer: string };
      expect(discovery.issuer).toBe(provider.issuer);
    });

    test("signs a test user in and sends group IDs and names", async ({ page }) => {
      const discovery = (await (
        await fetch(`${provider.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`)
      ).json()) as { authorization_endpoint: string; token_endpoint: string };
      const verifier = base64url(randomBytes(32));
      const state = base64url(randomBytes(16));
      const authorize = new URL(discovery.authorization_endpoint);
      authorize.search = new URLSearchParams({
        response_type: "code",
        client_id: provider.clientId,
        redirect_uri: REDIRECT_URI,
        scope: provider.scopes,
        state,
        nonce: base64url(randomBytes(16)),
        code_challenge: base64url(createHash("sha256").update(verifier).digest()),
        code_challenge_method: "S256",
      }).toString();

      const callback = page.waitForRequest((request) => request.url().startsWith(REDIRECT_URI), {
        timeout: 30_000,
      });
      await page.goto(authorize.toString());
      await provider.signIn(page, "alice");
      const received = new URL((await callback).url());
      expect(received.searchParams.get("error")).toBeNull();
      expect(received.searchParams.get("state")).toBe(state);

      const tokens = await fetch(discovery.token_endpoint, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: received.searchParams.get("code") ?? "",
          redirect_uri: REDIRECT_URI,
          client_id: provider.clientId,
          client_secret: provider.clientSecret,
          code_verifier: verifier,
        }),
      });
      expect(tokens.ok).toBe(true);
      const claims = claimsOf(((await tokens.json()) as { id_token: string }).id_token);
      expect(claims.iss).toBe(provider.issuer);
      expect([claims.aud].flat()).toContain(provider.clientId);
      expect(claims.email).toBe(TEST_USERS.alice.email);
      expect([...(claims.groups as string[])].sort()).toEqual(
        [await provider.groupId("engineering"), await provider.groupId("admins")].sort(),
      );
      expect([...(claims.group_names as string[])].sort()).toEqual(["admins", "engineering"]);
    });

    test("changes users and groups through the admin interface", async () => {
      const person = newTestUser("admin-check");
      await provider.createUser(person);
      try {
        const engineering = await provider.groupId("engineering");
        const admins = await provider.groupId("admins");
        await provider.addToGroup(person.username, "engineering");
        expect(await provider.userGroups(person.username)).toEqual([engineering]);
        await provider.setUserEnabled(person.username, false);
        expect(await provider.isUserEnabled(person.username)).toBe(false);
        await provider.removeFromGroup(person.username, "engineering");
        expect(await provider.userGroups(person.username)).toEqual([]);
        await provider.addToGroup(person.username, "admins");
        expect(await provider.userGroups(person.username)).toEqual([admins]);
        await provider.setUserEnabled(person.username, true);
        expect(await provider.isUserEnabled(person.username)).toBe(true);
      } finally {
        await provider.deleteUser(person.username);
      }
    });

    test("renames a group without changing its ID", async () => {
      const admins = await provider.groupId("admins");
      try {
        await provider.renameGroup("admins", "administrators");
        expect(await provider.groupId("admins")).toBe(admins);
      } finally {
        await provider.renameGroup("admins", "admins");
      }
    });
  });
}
