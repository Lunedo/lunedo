import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { SYSTEM } from "../accounts/principal.js";
import { RateLimitedError } from "../auth/errors.js";
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
      config: { preset: "generic", issuer: "https://idp.example.org", clientId: "lunedo", domains },
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
      providers: [],
      lastProvider: null,
      passkeys: true,
    });
    expect(await test.services.providerSignIn.discover("person@example.org")).toEqual({ step: "password" });
  });

  it("answers a whole office behind one address and limits a flood", async () => {
    const office = "198.51.100.60";
    for (let person = 0; person < 300; person++) {
      await test.services.providerSignIn.discover(`person${person}@example.org`, office);
    }
    await expect(test.services.providerSignIn.discover("one.more@example.org", office)).rejects.toThrow(
      RateLimitedError,
    );
    await expect(
      test.services.providerSignIn.discover("one.more@example.org", "198.51.100.61"),
    ).resolves.toEqual({
      step: "password",
    });
  });

  it("keeps the e-mail step with a single provider, because local accounts sign in with a password", async () => {
    const id = await provider("Only", ["only.example"]);
    expect(await test.services.providerSignIn.signInOptions(null)).toMatchObject({
      providers: [{ id, name: "Only", preset: "generic" }],
      passkeys: true,
    });
    expect(await test.services.providerSignIn.discover("person@elsewhere.example")).toEqual({
      step: "password",
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
    const listed = (await test.services.providerSignIn.signInOptions(null)).providers.map(
      (entry) => entry.id,
    );
    expect(listed).toEqual(expect.arrayContaining([alpha, beta]));
    expect(listed.indexOf(alpha)).toBeLessThan(listed.indexOf(beta));
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
