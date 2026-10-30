import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@lunedo/server";
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

describe.skipIf(!databaseBaseUrl)("ownership and page status through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let organizationId: string;
  let counter = 0;

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

  async function person() {
    counter += 1;
    const email = `owner${counter}@lunedo.test`;
    const password = "a long enough passphrase";
    const id = (await createAccount(test, email, password)).id;
    return { id, client: await signedInClient(test, email, password) };
  }

  async function setup() {
    const admin = await person();
    const author = await person();
    const editor = await person();
    const reader = await person();
    counter += 1;
    const created = await admin.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Owned ${counter}`,
      key: `OW${counter}X`,
      visibility: "private",
      grants: [
        { principalKind: "account", principalId: author.id, role: "editor" },
        { principalKind: "account", principalId: editor.id, role: "editor" },
        { principalKind: "account", principalId: reader.id, role: "reader" },
      ],
    });
    expect(created.statusCode, created.body).toBe(201);
    const space = created.json() as { id: string };
    const page = await author.client.post(`/api/v1/spaces/${space.id}/items`, {
      kind: "page",
      title: "Restart the VPN gateway",
      parentId: null,
      mode: "live",
    });
    expect(page.statusCode, page.body).toBe(201);
    return { admin, author, editor, reader, space, page: page.json() as { id: string } };
  }

  it("shows the owner and hands the page to an editor found by name", async () => {
    const context = await setup();
    const details = await context.reader.client.get(`/api/v1/items/${context.page.id}`);
    expect(details.json()).toMatchObject({
      ownerId: context.author.id,
      owner: { id: context.author.id, active: true },
      ownershipTransferable: false,
      status: null,
    });
    expect(
      (await context.reader.client.get(`/api/v1/items/${context.page.id}/owner-candidates`)).statusCode,
    ).toBe(403);
    expect(
      (
        await context.reader.client.put(`/api/v1/items/${context.page.id}/owner`, {
          ownerId: context.reader.id,
        })
      ).statusCode,
    ).toBe(403);

    const candidates = await context.author.client.get(`/api/v1/items/${context.page.id}/owner-candidates`);
    const ids = (candidates.json() as { id: string }[]).map((candidate) => candidate.id);
    expect(ids).toEqual(expect.arrayContaining([context.editor.id, context.admin.id]));
    expect(ids).not.toContain(context.reader.id);

    const refused = await context.author.client.put(`/api/v1/items/${context.page.id}/owner`, {
      ownerId: context.reader.id,
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ code: "ownerNeedsEditAccess" });

    const moved = await context.author.client.put(`/api/v1/items/${context.page.id}/owner`, {
      ownerId: context.editor.id,
    });
    expect(moved.statusCode, moved.body).toBe(204);
    const activity = await context.reader.client.get(`/api/v1/items/${context.page.id}/activity`);
    expect(activity.json()).toEqual([
      expect.objectContaining({
        type: "owner",
        previousOwner: expect.objectContaining({ id: context.author.id }),
        owner: expect.objectContaining({ id: context.editor.id }),
      }),
    ]);
  });

  it("lets editors set the status, space admins manage the values and asks before removing a used value", async () => {
    const context = await setup();
    const values = await context.reader.client.get(`/api/v1/spaces/${context.space.id}/page-statuses`);
    const listed = values.json() as { enabled: boolean; values: { id: string; builtIn: string | null }[] };
    expect(listed.enabled).toBe(true);
    const verified = listed.values.find((value) => value.builtIn === "verified");

    expect(
      (await context.reader.client.put(`/api/v1/items/${context.page.id}/status`, { statusId: verified?.id }))
        .statusCode,
    ).toBe(403);
    const set = await context.editor.client.put(`/api/v1/items/${context.page.id}/status`, {
      statusId: verified?.id,
    });
    expect(set.statusCode, set.body).toBe(200);
    const children = await context.reader.client.get(`/api/v1/spaces/${context.space.id}/items`);
    expect(
      (children.json().items as { id: string; status: { id: string } | null }[]).find(
        (child) => child.id === context.page.id,
      )?.status?.id,
    ).toBe(verified?.id);

    expect(
      (
        await context.editor.client.post(`/api/v1/spaces/${context.space.id}/page-statuses`, {
          name: "Outdated",
          color: "danger",
        })
      ).statusCode,
    ).toBe(403);
    const added = await context.admin.client.post(`/api/v1/spaces/${context.space.id}/page-statuses`, {
      name: "Outdated",
      color: "danger",
    });
    expect(added.statusCode, added.body).toBe(201);

    const inUse = await context.admin.client.delete(
      `/api/v1/spaces/${context.space.id}/page-statuses/${verified?.id}`,
    );
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json()).toMatchObject({ code: "statusInUse", pages: 1 });
    const removed = await context.admin.client.delete(
      `/api/v1/spaces/${context.space.id}/page-statuses/${verified?.id}?pages=1`,
    );
    expect(removed.statusCode, removed.body).toBe(204);
    expect((await context.reader.client.get(`/api/v1/items/${context.page.id}`)).json().status).toBeNull();
  });

  it("lets space admins turn the page status off and on in the space settings", async () => {
    const context = await setup();
    const settings = await context.admin.client.get(`/api/v1/spaces/${context.space.id}/settings`);
    expect((settings.json() as { key: string }[]).map((setting) => setting.key)).toContain("pages.status");
    const off = await context.admin.client.put(`/api/v1/spaces/${context.space.id}/settings/pages.status`, {
      value: false,
    });
    expect(off.statusCode, off.body).toBe(204);
    const listed = await context.reader.client.get(`/api/v1/spaces/${context.space.id}/page-statuses`);
    expect(listed.json()).toMatchObject({ enabled: false });
  });

  it("answers an unchanged item list with 304 and never to a person who may not read it", async () => {
    const context = await setup();
    const url = `/api/v1/spaces/${context.space.id}/items`;
    const first = await context.reader.client.get(url);
    expect(first.statusCode).toBe(200);
    const etag = String(first.headers.etag);
    expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(first.headers["cache-control"]).toBe("private, no-cache");

    const unchanged = await context.reader.client.get(url, { "if-none-match": etag });
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.body).toBe("");

    const renamed = await context.editor.client.patch(`/api/v1/items/${context.page.id}`, {
      title: "Restart the VPN gateway now",
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    const changed = await context.reader.client.get(url, { "if-none-match": etag });
    expect(changed.statusCode).toBe(200);
    expect(changed.headers.etag).not.toBe(etag);

    const weak = await context.reader.client.get(url, {
      "if-none-match": `W/${String(changed.headers.etag)}`,
    });
    expect(weak.statusCode).toBe(304);

    const outsider = await person();
    const refused = await outsider.client.get(url, { "if-none-match": String(changed.headers.etag) });
    expect(refused.statusCode).toBe(404);
  });

  it("lists items without an owner for space admins only", async () => {
    const context = await setup();
    await test.runtime.services.memberships.deactivate({ type: "system" }, context.author.id);
    expect(
      (await context.editor.client.get(`/api/v1/spaces/${context.space.id}/unowned-items`)).statusCode,
    ).toBe(403);
    const listed = await context.admin.client.get(`/api/v1/spaces/${context.space.id}/unowned-items`);
    expect(listed.json()).toMatchObject({
      items: [{ id: context.page.id, reason: "deactivated", formerOwner: { id: context.author.id } }],
      hidden: 0,
      nextCursor: null,
    });
    const organization = await owner.get(`/api/v1/organizations/${organizationId}/unowned-items`);
    expect(organization.statusCode).toBe(200);
    expect(organization.json().items).toEqual([]);
    expect(organization.json().hidden).toBeGreaterThanOrEqual(1);
  });
});
