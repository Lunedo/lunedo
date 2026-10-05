import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { SYSTEM } from "../accounts/principal.js";
import { passwordSignInSetting } from "../auth/settings.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("choosing the sign-in method", () => {
  let test: TestServices;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function provider(name: string, domains: string[]) {
    const { provider: created } = await test.services.identityProviders.create(SYSTEM, {
      type: "oidc",
      name,
      config: { preset: "generic", issuer: "https://idp.example.org", clientId: "pagehall", domains },
      credential: { kind: "clientSecret", secret: "secret", expiresAt: null },
    });
    return created.id;
  }

  async function account(email: string) {
    await test.database.transaction((tx) =>
      test.services.accounts.createStandard(tx, {
        email,
        name: "Person",
        password: "a long test passphrase",
        homeOrganizationId: null,
      }),
    );
  }

  it("asks for the e-mail address and offers passkeys and password sign-in without providers", async () => {
    expect(await test.services.providerSignIn.signInOptions(null)).toEqual({
      emailStep: true,
      directProvider: null,
      lastProvider: null,
      passwordSignIn: true,
      passkeys: true,
    });
    expect(await test.services.providerSignIn.discover("person@example.org")).toEqual({ step: "password" });
  });

  it("shows the button of the only provider directly when password sign-in is off", async () => {
    const id = await provider("Only", ["only.example"]);
    await test.settings.set(passwordSignInSetting, {}, "instance", false);
    try {
      expect(await test.services.providerSignIn.signInOptions(null)).toMatchObject({
        emailStep: false,
        directProvider: { id, name: "Only", preset: "generic" },
        passwordSignIn: false,
        passkeys: true,
      });
      expect(await test.services.providerSignIn.discover("person@elsewhere.example")).toEqual({
        step: "none",
      });
    } finally {
      await test.settings.set(passwordSignInSetting, {}, "instance", true);
    }
    expect(await test.services.providerSignIn.signInOptions(null)).toMatchObject({
      emailStep: true,
      directProvider: null,
    });
    await test.services.identityProviders.remove(SYSTEM, id);
  });

  it("lets the domain of the e-mail address choose the provider", async () => {
    const alpha = await provider("Alpha", ["alpha.example"]);
    const beta = await provider("Beta", ["beta.example", "beta-two.example"]);
    expect(await test.services.providerSignIn.discover(" Person@Alpha.Example ")).toEqual({
      step: "provider",
      providerId: alpha,
      name: "Alpha",
      preset: "generic",
    });
    expect(await test.services.providerSignIn.discover("person@beta-two.example")).toMatchObject({
      step: "provider",
      providerId: beta,
    });
    expect(await test.services.providerSignIn.discover("person@gamma.example")).toEqual({ step: "password" });
    expect(await test.services.providerSignIn.discover("not an address")).toEqual({ step: "password" });
  });

  it("answers the same for addresses with and without an account", async () => {
    await provider("Delta", ["delta.example"]);
    const known = `known.${randomUUID().slice(0, 8)}`;
    await account(`${known}@plain.example`);
    await account(`${known}@delta.example`);
    const unknown = `unknown.${randomUUID().slice(0, 8)}`;
    for (const domain of ["plain.example", "delta.example"]) {
      expect(await test.services.providerSignIn.discover(`${known}@${domain}`)).toEqual(
        await test.services.providerSignIn.discover(`${unknown}@${domain}`),
      );
    }
    await test.settings.set(passwordSignInSetting, {}, "instance", false);
    try {
      const withAccount = await test.services.providerSignIn.discover(`${known}@plain.example`);
      expect(withAccount).toEqual({ step: "none" });
      expect(await test.services.providerSignIn.discover(`${unknown}@plain.example`)).toEqual(withAccount);
    } finally {
      await test.settings.set(passwordSignInSetting, {}, "instance", true);
    }
  });

  it("offers the provider used last only while it exists", async () => {
    const id = await provider("Epsilon", ["epsilon.example"]);
    expect((await test.services.providerSignIn.signInOptions(id)).lastProvider).toMatchObject({
      id,
      name: "Epsilon",
    });
    await test.services.identityProviders.remove(SYSTEM, id);
    expect((await test.services.providerSignIn.signInOptions(id)).lastProvider).toBeNull();
    expect((await test.services.providerSignIn.signInOptions(randomUUID())).lastProvider).toBeNull();
  });
});
