import { randomUUID } from "node:crypto";
import {
  accountAttemptLimitSetting,
  accountPrincipal,
  clientAttemptLimitSetting,
  SYSTEM,
} from "@lunedo/server";
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

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

describe.skipIf(!databaseBaseUrl)("own profile", () => {
  let test: AuthTestApp;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function person(prefix: string, homeOrganizationId?: string) {
    const account = await createAccount(
      test,
      `${prefix}.${randomUUID().slice(0, 8)}@example.org`,
      undefined,
      homeOrganizationId,
    );
    return { account, client: await signedInClient(test, account.email, account.password) };
  }

  async function auditEvents(accountId: string, name: string) {
    const result = await test.runtime.pool.query<{ name: string }>(
      "select name from audit_events where target_id = $1 and name = $2",
      [accountId, name],
    );
    return result.rows.length;
  }

  it("changes the own name and job title and records it", async () => {
    const { account, client } = await person("profile.name");
    expect((await client.get("/api/v1/account/profile")).json()).toEqual({
      name: account.name,
      jobTitle: null,
      pictureRef: null,
      nameProvider: null,
    });

    const changed = await client.patch("/api/v1/account/profile", {
      name: "  Ada Lovelace ",
      jobTitle: " Head of Engineering ",
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ name: "Ada Lovelace", jobTitle: "Head of Engineering" });
    expect((await client.get("/api/v1/auth/session")).json().account.name).toBe("Ada Lovelace");
    expect(await auditEvents(account.id, "account.profileChanged")).toBe(1);

    const cleared = await client.patch("/api/v1/account/profile", { jobTitle: "" });
    expect(cleared.json()).toMatchObject({ name: "Ada Lovelace", jobTitle: null });
    expect(await auditEvents(account.id, "account.profileChanged")).toBe(2);

    await client.patch("/api/v1/account/profile", { jobTitle: null });
    expect(await auditEvents(account.id, "account.profileChanged")).toBe(2);
  });

  it("refuses names and job titles that are empty or too long", async () => {
    const { client } = await person("profile.limits");
    expect((await client.patch("/api/v1/account/profile", { name: "   " })).statusCode).toBe(400);
    expect((await client.patch("/api/v1/account/profile", { name: "x".repeat(201) })).statusCode).toBe(400);
    expect((await client.patch("/api/v1/account/profile", { jobTitle: "x".repeat(101) })).statusCode).toBe(
      400,
    );
    expect((await client.patch("/api/v1/account/profile", { email: "other@example.org" })).statusCode).toBe(
      400,
    );
    expect((await client.patch("/api/v1/account/profile", { jobTitle: "x".repeat(100) })).statusCode).toBe(
      200,
    );
  });

  it("keeps a name that an identity provider sets, while the job title stays editable", async () => {
    const { account, client } = await person("profile.provider");
    const provider = randomUUID();
    await test.runtime.pool.query(
      "insert into identity_providers (id, type, preset, name, config) values ($1, 'oidc', 'generic', 'Company login', '{}')",
      [provider],
    );
    await test.runtime.pool.query(
      "insert into identities (id, account_id, provider_id, subject, display_name) values ($1, $2, $3, $4, 'Ada from the provider')",
      [randomUUID(), account.id, provider, randomUUID()],
    );
    expect((await client.get("/api/v1/account/profile")).json().nameProvider).toBe("Company login");

    const refused = await client.patch("/api/v1/account/profile", { name: "Someone else" });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: "nameFromProvider" });
    expect((await client.get("/api/v1/account/profile")).json().name).toBe(account.name);
    expect(
      (await client.patch("/api/v1/account/profile", { name: account.name, jobTitle: "Ops" })).json(),
    ).toMatchObject({ jobTitle: "Ops" });

    await test.runtime.pool.query("update identity_providers set deactivated_at = now() where id = $1", [
      provider,
    ]);
    expect((await client.get("/api/v1/account/profile")).json().nameProvider).toBeNull();
    expect((await client.patch("/api/v1/account/profile", { name: "Someone else" })).statusCode).toBe(200);
  });

  it("uploads, serves, replaces and removes the own picture", async () => {
    const { account, client } = await person("profile.picture");
    const uploaded = await client.put("/api/v1/account/profile/picture", {
      contentType: "image/png",
      data: PNG.toString("base64"),
    });
    expect(uploaded.statusCode).toBe(200);
    const first = uploaded.json().pictureRef;
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect((await client.get("/api/v1/auth/session")).json().account.pictureRef).toBe(first);

    const served = await client.get(`/api/v1/accounts/${account.id}/picture?v=${first}`);
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(served.rawPayload.equals(PNG)).toBe(true);

    const replaced = await client.put("/api/v1/account/profile/picture", {
      contentType: "image/png",
      data: PNG.toString("base64"),
    });
    const second = replaced.json().pictureRef;
    expect(second).not.toBe(first);
    const files = await test.runtime.pool.query<{ state: string }>(
      "select f.state from stored_files f where f.id in (select file_id from account_pictures where account_id = $1)",
      [account.id],
    );
    expect(files.rows).toEqual([{ state: "ready" }]);
    const orphaned = await test.runtime.pool.query(
      "select 1 from stored_files where state = 'orphaned' and id not in (select file_id from account_pictures)",
    );
    expect(orphaned.rows.length).toBeGreaterThan(0);
    expect(await auditEvents(account.id, "account.pictureChanged")).toBe(2);

    const removed = await client.delete("/api/v1/account/profile/picture");
    expect(removed.json().pictureRef).toBeNull();
    expect((await client.get(`/api/v1/accounts/${account.id}/picture`)).statusCode).toBe(404);
    expect(await auditEvents(account.id, "account.pictureChanged")).toBe(3);
    await client.delete("/api/v1/account/profile/picture");
    expect(await auditEvents(account.id, "account.pictureChanged")).toBe(3);
  });

  it("refuses pictures that are not small PNG, JPEG or WebP images", async () => {
    const { client } = await person("profile.invalid");
    const url = "/api/v1/account/profile/picture";
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(
      (await client.put(url, { contentType: "image/png", data: svg.toString("base64") })).json(),
    ).toMatchObject({
      code: "invalidPicture",
    });
    expect(
      (await client.put(url, { contentType: "image/jpeg", data: PNG.toString("base64") })).json(),
    ).toMatchObject({
      code: "invalidPicture",
    });
    const large = Buffer.concat([PNG, Buffer.alloc(256 * 1024)]);
    expect(
      (await client.put(url, { contentType: "image/png", data: large.toString("base64") })).statusCode,
    ).toBe(400);
    expect(
      (await client.put(url, { contentType: "image/svg+xml", data: svg.toString("base64") })).statusCode,
    ).toBe(400);
    expect((await client.get("/api/v1/account/profile")).json().pictureRef).toBeNull();
  });

  it("shows a picture only to people who may see the person", async () => {
    const { account, client } = await person("profile.visible");
    await client.put("/api/v1/account/profile/picture", {
      contentType: "image/png",
      data: PNG.toString("base64"),
    });
    const url = `/api/v1/accounts/${account.id}/picture`;

    const colleague = await person("profile.colleague");
    expect((await colleague.client.get(url)).statusCode).toBe(200);

    const other = await test.runtime.services.organizations.createAsActor(SYSTEM, {
      name: `Other ${randomUUID().slice(0, 8)}`,
      ownerAccountId: (await createAccount(test, `other.owner.${randomUUID().slice(0, 8)}@example.org`)).id,
    });
    const outsider = await person("profile.outsider", other.id);
    await test.runtime.pool.query("delete from memberships where account_id = $1 and organization_id <> $2", [
      outsider.account.id,
      other.id,
    ]);
    expect((await outsider.client.get(url)).statusCode).toBe(404);
    expect((await new TestClient(test.app).get(url)).statusCode).toBe(401);
  });

  it("lists the picture and job title with organization members", async () => {
    const { account, client } = await person("profile.listed");
    await client.patch("/api/v1/account/profile", { jobTitle: "Service desk" });
    const uploaded = (
      await client.put("/api/v1/account/profile/picture", {
        contentType: "image/png",
        data: PNG.toString("base64"),
      })
    ).json();
    const organizationId = account.homeOrganizationId ?? "";
    const viewer = new TestClient(test.app);
    await viewer.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(viewer);
    const members = await viewer.get(
      `/api/v1/organizations/${organizationId}/members?q=${encodeURIComponent(account.name)}`,
    );
    expect(members.json().items).toEqual([
      expect.objectContaining({
        accountId: account.id,
        jobTitle: "Service desk",
        pictureRef: uploaded.pictureRef,
      }),
    ]);
  });

  it("forgets the picture and job title when the account is anonymized", async () => {
    const { account, client } = await person("profile.anonymized");
    await client.patch("/api/v1/account/profile", { jobTitle: "Temporary" });
    await client.put("/api/v1/account/profile/picture", {
      contentType: "image/png",
      data: PNG.toString("base64"),
    });
    const fileId = (
      await test.runtime.pool.query<{ file_id: string }>(
        "select file_id from account_pictures where account_id = $1",
        [account.id],
      )
    ).rows[0]?.file_id;
    await test.runtime.pool.query("update accounts set state = 'deactivated' where id = $1", [account.id]);
    const owner = await test.runtime.services.accounts.ownerId();
    await test.runtime.services.accountLifecycle.anonymize(accountPrincipal(owner ?? ""), account.id, {
      reason: "Left the company",
      confirmation: account.name,
    });
    const row = (
      await test.runtime.pool.query<{ job_title: string | null; picture_ref: string | null }>(
        "select job_title, picture_ref from accounts where id = $1",
        [account.id],
      )
    ).rows[0];
    expect(row).toEqual({ job_title: null, picture_ref: null });
    const file = await test.runtime.pool.query<{ state: string }>(
      "select state from stored_files where id = $1",
      [fileId],
    );
    expect(file.rows).toEqual([{ state: "orphaned" }]);
  });
});
