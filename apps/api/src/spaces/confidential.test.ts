import { get, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createServerRuntime, membersCreateConfidentialSpacesSetting } from "@pagehall/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiContextOf } from "../context.js";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  OWNER,
  signedInClient,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";
import { createTestApp } from "../testing/create-test-app.js";

const SESSION_COOKIE = "__Host-pagehall-session";
const SECRET_TITLE = "Salary review Mila";
const SECRET_TEXT = "Raise by four percent";
const SPACE_NAME = "Works council";

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

interface Person {
  id: string;
  email: string;
  password: string;
  client: TestClient;
}

describe.skipIf(!databaseBaseUrl)("confidential spaces through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let ownerId: string;
  let organizationId: string;
  let instanceAdministrator: Person;
  let counter = 0;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    ownerId = (await owner.get("/api/v1/auth/session")).json().account.id;
    expect(ownerId).toMatch(/^[0-9a-f-]{36}$/);
    const created = await owner.post("/api/v1/organizations", { name: "Confidential matters" });
    expect(created.statusCode, created.body).toBe(201);
    organizationId = created.json().id;
    instanceAdministrator = await person(false);
    const assigned = await owner.post("/api/v1/instance/role-assignments", {
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: instanceAdministrator.id },
    });
    expect(assigned.statusCode, assigned.body).toBe(201);
    await addTotp(instanceAdministrator.client);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function person(member = true): Promise<Person> {
    counter += 1;
    const email = `confidential${counter}@pagehall.test`;
    const password = "a long enough passphrase";
    const account = await createAccount(test, email, password, member ? organizationId : undefined);
    return { id: account.id, email, password, client: await signedInClient(test, email, password) };
  }

  async function confidentialSpace(admin: Person, others: { person: Person; role: string }[] = []) {
    counter += 1;
    const created = await admin.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `${SPACE_NAME} ${counter}`,
      key: `WC${counter}X`,
      visibility: "private",
      confidential: true,
      grants: others.map(({ person, role }) => ({ principalKind: "account", principalId: person.id, role })),
    });
    expect(created.statusCode, created.body).toBe(201);
    const space = created.json() as { id: string; key: string; name: string; confidential: boolean };
    expect(space.confidential).toBe(true);
    const page = await admin.client.post(`/api/v1/spaces/${space.id}/items`, {
      kind: "page",
      title: SECRET_TITLE,
      parentId: null,
      mode: "live",
    });
    expect(page.statusCode, page.body).toBe(201);
    const pageId = (page.json() as { id: string }).id;
    const stored = await admin.client.put(`/api/v1/pages/${pageId}/content`, {
      document: { type: "doc", content: [paragraph(SECRET_TEXT)] },
    });
    expect(stored.statusCode, stored.body).toBe(200);
    return { ...space, pageId };
  }

  function expectHidden(body: string, space: { name: string; key?: string }, path: string) {
    expect(body, path).not.toContain(SECRET_TITLE);
    expect(body, path).not.toContain(SECRET_TEXT);
    expect(body, path).not.toContain(space.name);
  }

  it("cannot be read by organization or instance administrators through any content path", async () => {
    const admin = await person();
    const space = await confidentialSpace(admin);
    for (const client of [owner, instanceAdministrator.client]) {
      for (const path of [
        `/api/v1/spaces/${space.id}`,
        `/api/v1/space-keys/${space.key}`,
        `/api/v1/spaces/${space.id}/items`,
        `/api/v1/items/${space.pageId}`,
        `/api/v1/pages/${space.pageId}/content`,
        `/api/v1/pages/${space.pageId}/markdown`,
        `/api/v1/spaces/${space.id}/permissions`,
        `/api/v1/spaces/${space.id}/trash`,
      ]) {
        const response = await client.get(path);
        expect(response.statusCode, path).toBeGreaterThanOrEqual(400);
        expectHidden(response.body, space, path);
      }
      for (const path of [
        "/api/v1/spaces",
        `/api/v1/items?q=${encodeURIComponent("Salary")}`,
        "/api/v1/recent",
      ]) {
        expectHidden((await client.get(path)).body, space, path);
      }
    }
    expect((await admin.client.get(`/api/v1/pages/${space.pageId}/content`)).body).toContain(SECRET_TEXT);
  });

  it("refuse groups, all members and all internal users as holders", async () => {
    const admin = await person();
    const space = await confidentialSpace(admin);
    const group = await owner.post(`/api/v1/organizations/${organizationId}/groups`, {
      name: `Council ${counter}`,
    });
    expect(group.statusCode, group.body).toBe(201);
    for (const holder of [
      { principalKind: "group", principalId: group.json().id },
      { principalKind: "organizationMembers", principalId: null },
      { principalKind: "instanceUsers", principalId: null },
    ]) {
      const granted = await admin.client.post(`/api/v1/spaces/${space.id}/permissions`, {
        action: "grant",
        ...holder,
        role: "reader",
      });
      expect(granted.statusCode, JSON.stringify(holder)).toBe(400);
      expect(granted.json().code).toBe("invalidHolder");
      const created = await admin.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
        name: "Second council",
        key: `SC${counter}${holder.principalKind.length}`,
        visibility: "private",
        confidential: true,
        grants: [{ ...holder, role: "reader" }],
      });
      expect(created.statusCode, JSON.stringify(holder)).toBe(400);
    }
    const opened = await admin.client.put(`/api/v1/spaces/${space.id}/visibility`, {
      visibility: "organization",
    });
    expect(opened.statusCode).toBe(400);
    expect(opened.json().code).toBe("confidentialVisibility");
    const shared = await admin.client.post(`/api/v1/pages/${space.pageId}/access`, {
      changes: [{ action: "share", holderKind: "group", holderId: group.json().id, role: "reader" }],
    });
    expect(shared.statusCode).toBe(400);
  });

  it("let administrators neither give themselves access nor appoint a space admin of their choice", async () => {
    const admin = await person();
    const space = await confidentialSpace(admin);
    const attempts = [
      owner.post(`/api/v1/spaces/${space.id}/permissions`, {
        action: "grant",
        principalKind: "account",
        principalId: ownerId,
        role: "admin",
      }),
      owner.post(`/api/v1/organizations/${organizationId}/spaces/${space.id}/administrator`, {
        accountId: ownerId,
      }),
      owner.post(`/api/v1/pages/${space.pageId}/access`, {
        changes: [{ action: "share", holderKind: "account", holderId: ownerId, role: "reader" }],
      }),
      owner.post(`/api/v1/organizations/${organizationId}/confidential-spaces/${space.id}/administrator`, {
        accountId: ownerId,
      }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.statusCode, response.body).toBeGreaterThanOrEqual(400);
    }
    expect((await owner.get(`/api/v1/spaces/${space.id}`)).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("offer only the remaining members when the last space admin is deactivated", async () => {
    const admin = await person();
    const remaining = await person();
    const outsider = await person();
    const space = await confidentialSpace(admin, [{ person: remaining, role: "editor" }]);
    const deactivated = await owner.post(`/api/v1/accounts/${admin.id}/deactivate`);
    expect(deactivated.statusCode, deactivated.body).toBeLessThan(300);
    const list = await owner.get(`/api/v1/organizations/${organizationId}/confidential-spaces`);
    expect(list.statusCode).toBe(200);
    const entry = list.json().items.find((item: { id: string }) => item.id === space.id);
    expect(entry).toMatchObject({ key: space.key, members: 2, activeMembers: 1, needsAdministrator: true });
    expectHidden(list.body, space, "list");
    const notifications = await owner.get("/api/v1/notifications");
    expect(notifications.body).toContain("space.confidentialWithoutAdministrator");
    expectHidden(notifications.body, space, "notifications");
    const candidates = await owner.get(
      `/api/v1/organizations/${organizationId}/confidential-spaces/${space.id}/remaining-members`,
    );
    expect(candidates.json().map((candidate: { id: string }) => candidate.id)).toEqual([remaining.id]);
    const general = await owner.get(`/api/v1/organizations/${organizationId}/spaces-without-administrator`);
    expectHidden(general.body, space, "spaces without administrator");
    expect(general.body).not.toContain(space.id);
    const generalAppointment = await owner.post(
      `/api/v1/organizations/${organizationId}/spaces/${space.id}/administrator`,
      { accountId: outsider.id },
    );
    expect(generalAppointment.statusCode).toBe(404);
    const base = `/api/v1/organizations/${organizationId}/confidential-spaces/${space.id}/administrator`;
    expect((await owner.post(base, { accountId: ownerId })).statusCode).toBe(400);
    expect((await owner.post(base, { accountId: outsider.id })).json().code).toBe("invalidHolder");
    expect((await owner.post(base, { accountId: remaining.id })).statusCode).toBe(204);
    expect((await owner.post(base, { accountId: remaining.id })).json().code).toBe("spaceHasAdministrator");
    const permissions = await remaining.client.get(`/api/v1/spaces/${space.id}/permissions`);
    expect(permissions.statusCode).toBe(200);
    expect(permissions.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ principalId: remaining.id, role: "admin" })]),
    );
    expect((await owner.get(`/api/v1/spaces/${space.id}`)).statusCode).toBeGreaterThanOrEqual(400);
    const audit = await owner.get(`/api/v1/organizations/${organizationId}/audit-events?limit=200`);
    expect(audit.body).toContain("space.confidentialAdministratorAppointed");
    expectHidden(audit.body, space, "audit");
  });

  it("stay closed during break-glass access", async () => {
    const admin = await person();
    const space = await confidentialSpace(admin);
    const started = await instanceAdministrator.client.post(
      `/api/v1/organizations/${organizationId}/break-glass`,
      {
        reason: "Investigating a reported incident",
      },
    );
    expect(started.statusCode, started.body).toBe(201);
    for (const path of [
      `/api/v1/spaces/${space.id}`,
      `/api/v1/pages/${space.pageId}/content`,
      `/api/v1/spaces/${space.id}/permissions`,
      `/api/v1/organizations/${organizationId}/trash`,
      `/api/v1/organizations/${organizationId}/confidential-spaces`,
      `/api/v1/organizations/${organizationId}/spaces-without-administrator`,
    ]) {
      const response = await instanceAdministrator.client.get(path);
      if (path.includes(space.id)) expect(response.statusCode, path).toBeGreaterThanOrEqual(400);
      expectHidden(response.body, space, path);
    }
  });

  it("explain no access to administrators", async () => {
    const admin = await person();
    const space = await confidentialSpace(admin);
    for (const path of [
      `/api/v1/spaces/${space.id}/access/explain?accountId=${admin.id}`,
      `/api/v1/pages/${space.pageId}/access/explain?accountId=${admin.id}`,
      `/api/v1/pages/${space.pageId}/access`,
    ]) {
      const response = await owner.get(path);
      expect(response.statusCode, path).toBeGreaterThanOrEqual(400);
      expectHidden(response.body, space, path);
    }
  });

  it("appear only as a number in the permission overview per person and its export", async () => {
    const admin = await person();
    const space = await confidentialSpace(admin);
    const overview = await owner.get(`/api/v1/organizations/${organizationId}/people/${admin.id}/access`);
    expect(overview.statusCode, overview.body).toBe(200);
    expect(overview.json().entries).toEqual([]);
    expect(overview.json().confidentialSpaceCount).toBe(1);
    expectHidden(overview.body, space, "overview");
    expect(overview.body).not.toContain(space.key);
    const csv = await owner.get(
      `/api/v1/organizations/${organizationId}/access-overview?accountId=${admin.id}`,
    );
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain("confidentialSpaces");
    expectHidden(csv.body, space, "csv");
    expect(csv.body).not.toContain(space.key);
  });

  it("keep the second stage of the trash with their own space admins", async () => {
    const admin = await person();
    const space = await confidentialSpace(admin);
    expect((await admin.client.delete(`/api/v1/items/${space.pageId}`)).statusCode).toBeLessThan(300);
    expect((await admin.client.post(`/api/v1/spaces/${space.id}/trash/empty`)).statusCode).toBe(200);
    const organizationTrash = await owner.get(`/api/v1/organizations/${organizationId}/trash`);
    expectHidden(organizationTrash.body, space, "organization trash");
    const own = await admin.client.get(`/api/v1/spaces/${space.id}/trash`);
    const entry = own.json().find((item: { title: string }) => item.title === SECRET_TITLE);
    expect(entry).toMatchObject({ stage: 2 });
    const byOwner = await owner.post(`/api/v1/organizations/${organizationId}/trash/${entry.id}/restore`);
    expect(byOwner.statusCode).toBe(404);
    const erased = await owner.post(`/api/v1/organizations/${organizationId}/trash/${entry.id}/delete`, {
      reason: "Erasure request",
    });
    expect(erased.statusCode).toBe(404);
    const restored = await admin.client.post(`/api/v1/spaces/${space.id}/trash/${entry.id}/restore`);
    expect(restored.statusCode, restored.body).toBe(200);
  });

  it("keep titles and names out of the audit log", async () => {
    const admin = await person();
    const space = await confidentialSpace(admin);
    await admin.client.post(`/api/v1/pages/${space.pageId}/labels`, { label: "salary" });
    expect((await admin.client.post(`/api/v1/items/${space.pageId}/archive`)).statusCode).toBeLessThan(300);
    for (const client of [owner, instanceAdministrator.client]) {
      const path =
        client === owner
          ? `/api/v1/organizations/${organizationId}/audit-events?limit=200`
          : "/api/v1/instance/audit-events?limit=200";
      const audit = await client.get(path);
      expect(audit.statusCode, audit.body).toBe(200);
      expectHidden(audit.body, space, path);
    }
    const exported = await owner.get(`/api/v1/organizations/${organizationId}/audit-events/export`);
    expectHidden(exported.body, space, "export");
    expect(exported.body).toContain("space.created");
  });

  it("send administrators no notification about their content", async () => {
    const admin = await person();
    const space = await confidentialSpace(admin);
    const mentioned = await admin.client.put(`/api/v1/pages/${space.pageId}/content`, {
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "mention", attrs: { id: ownerId } },
              { type: "text", text: ` ${SECRET_TEXT}` },
            ],
          },
        ],
      },
    });
    expect(mentioned.statusCode, mentioned.body).toBe(200);
    expectHidden((await owner.get("/api/v1/notifications")).body, space, "notifications");
  });

  it("offer share links for specific people only", async () => {
    const admin = await person();
    const colleague = await person();
    const space = await confidentialSpace(admin);
    for (const scope of ["organization", "instance", "anyone"]) {
      const created = await admin.client.post(`/api/v1/pages/${space.pageId}/share-links`, {
        scope,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(created.statusCode, scope).toBe(400);
    }
    const listed = await admin.client.get(`/api/v1/pages/${space.pageId}/share-links`);
    expect(listed.json().options).toMatchObject({ peopleOnly: true, anyone: false });
    const forPeople = await admin.client.post(`/api/v1/pages/${space.pageId}/share-links`, {
      scope: "people",
      people: [{ kind: "account", id: colleague.id }],
    });
    expect(forPeople.statusCode, forPeople.body).toBe(201);
  });

  it("tell administrators following the live update channel nothing about them", async () => {
    const admin = await person();
    const space = await confidentialSpace(admin);
    const secondRuntime = await createServerRuntime({ role: "api", env: test.env });
    let second: NestFastifyApplication | undefined;
    const responses: IncomingMessage[] = [];
    try {
      second = await createTestApp(apiContextOf(secondRuntime));
      await second.listen(0, "127.0.0.1");
      const { port } = second.getHttpServer().address() as AddressInfo;
      const follow = async (client: TestClient) => {
        const received = { connected: false, spaces: [] as string[] };
        const response = await new Promise<IncomingMessage>((resolve, reject) => {
          get(
            `http://127.0.0.1:${port}/api/v1/notifications/stream`,
            { headers: { cookie: `${SESSION_COOKIE}=${client.cookies.get(SESSION_COOKIE)}` } },
            resolve,
          ).on("error", reject);
        });
        responses.push(response);
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (chunk.includes("event: notifications")) received.connected = true;
          for (const match of chunk.matchAll(/event: spaces\ndata: (\{.*\})\n\n/g))
            received.spaces.push(match[1] ?? "");
        });
        await expect.poll(() => received.connected, { timeout: 5000 }).toBe(true);
        return received;
      };
      const member = await follow(admin.client);
      const administrator = await follow(owner);
      await admin.client.put(`/api/v1/pages/${space.pageId}/content`, {
        document: { type: "doc", content: [paragraph("A new line")] },
      });
      await expect
        .poll(() => member.spaces.some((data) => data.includes(space.id)), { timeout: 5000 })
        .toBe(true);
      expect(administrator.spaces.some((data) => data.includes(space.id))).toBe(false);
    } finally {
      for (const response of responses) response.destroy();
      await second?.close();
      await secondRuntime.close();
    }
  });

  it("can be deleted by an organization administrator with a reason once no active member remains", async () => {
    const admin = await person();
    const space = await confidentialSpace(admin);
    const path = `/api/v1/organizations/${organizationId}/confidential-spaces/${space.id}/delete`;
    const early = await owner.post(path, { confirmation: space.key, reason: "Left the company" });
    expect(early.json().code).toBe("spaceHasMembers");
    await owner.post(`/api/v1/accounts/${admin.id}/deactivate`);
    expect((await owner.post(path, { confirmation: "WRONG", reason: "Left" })).json().code).toBe(
      "confirmationMismatch",
    );
    expect((await owner.post(path, { confirmation: space.key, reason: " " })).json().code).toBe(
      "reasonRequired",
    );
    const deleted = await owner.post(path, {
      confirmation: space.key.toLowerCase(),
      reason: "Left the company",
    });
    expect(deleted.statusCode, deleted.body).toBe(204);
    const list = await owner.get(`/api/v1/organizations/${organizationId}/confidential-spaces`);
    expect(list.body).not.toContain(space.id);
    const audit = await owner.get(`/api/v1/organizations/${organizationId}/audit-events?limit=200`);
    expect(audit.body).toContain("space.confidentialDeleted");
    expect(audit.body).toContain("Left the company");
    expectHidden(audit.body, space, "audit");
  });

  it("can be created by members only while the organization allows it, and always by its administrators", async () => {
    const memberPerson = await person();
    await test.runtime.settings.set(
      membersCreateConfidentialSpacesSetting,
      { organization: organizationId },
      "organization",
      false,
    );
    try {
      const refused = await memberPerson.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
        name: "Private council",
        key: `PC${counter}`,
        visibility: "private",
        confidential: true,
        grants: [],
      });
      expect(refused.statusCode).toBe(403);
      const allowed = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
        name: "Board",
        key: `BO${counter}`,
        visibility: "private",
        confidential: true,
        grants: [],
      });
      expect(allowed.statusCode, allowed.body).toBe(201);
    } finally {
      await test.runtime.settings.clear(
        membersCreateConfidentialSpacesSetting,
        { organization: organizationId },
        "organization",
      );
    }
  });

  it("say when moved content leaves the protection", async () => {
    const admin = await person();
    const space = await confidentialSpace(admin);
    const open = await admin.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: "Open team",
      key: `OT${counter}`,
      visibility: "private",
      grants: [],
    });
    const preview = await admin.client.post(`/api/v1/items/${space.pageId}/move/preview`, {
      spaceId: open.json().id,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().leavesConfidential).toBe(true);
  });

  describe("once deleted", () => {
    async function deleteSpace(admin: Person, space: { id: string; name: string }): Promise<string> {
      const deleted = await admin.client.post(`/api/v1/spaces/${space.id}/delete`, {
        confirmation: space.name,
      });
      expect(deleted.statusCode, deleted.body).toBe(200);
      return (deleted.json() as { id: string }).id;
    }

    async function ordinarySpace(admin: Person, reader: Person) {
      counter += 1;
      const created = await admin.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
        name: `Team room ${counter}`,
        key: `TR${counter}X`,
        visibility: "private",
        grants: [{ principalKind: "account", principalId: reader.id, role: "reader" }],
      });
      expect(created.statusCode, created.body).toBe(201);
      const space = created.json() as { id: string; key: string; name: string };
      const page = await admin.client.post(`/api/v1/spaces/${space.id}/items`, {
        kind: "page",
        title: SECRET_TITLE,
        parentId: null,
        mode: "live",
      });
      expect(page.statusCode, page.body).toBe(201);
      return { ...space, pageId: (page.json() as { id: string }).id };
    }

    it.each([
      { kind: "an ordinary", confidential: false },
      { kind: "a confidential", confidential: true },
    ])(
      "$kind space can be restored by its space admins at deletion with content and permissions",
      async ({ confidential }) => {
        const admin = await person();
        const reader = await person();
        const space = confidential
          ? await confidentialSpace(admin, [{ person: reader, role: "reader" }])
          : await ordinarySpace(admin, reader);
        const entryId = await deleteSpace(admin, space);
        expect((await reader.client.get(`/api/v1/items/${space.pageId}`)).statusCode).toBeGreaterThanOrEqual(
          400,
        );

        const listed = await admin.client.get("/api/v1/deleted-spaces");
        expect(listed.statusCode, listed.body).toBe(200);
        expect(listed.json()).toEqual([
          expect.objectContaining({
            id: entryId,
            kind: "space",
            spaceId: space.id,
            spaceName: space.name,
            stage: 2,
          }),
        ]);
        const restored = await admin.client.post(`/api/v1/deleted-spaces/${entryId}/restore`);
        expect(restored.statusCode, restored.body).toBe(200);

        expect((await admin.client.get("/api/v1/deleted-spaces")).json()).toEqual([]);
        const item = await reader.client.get(`/api/v1/items/${space.pageId}`);
        expect(item.statusCode, item.body).toBe(200);
        expect(item.json().title).toBe(SECRET_TITLE);
        const permissions = await admin.client.get(`/api/v1/spaces/${space.id}/permissions`);
        expect(permissions.statusCode, permissions.body).toBe(200);
        expect(permissions.json()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ principalId: admin.id, role: "admin" }),
            expect.objectContaining({ principalId: reader.id, role: "reader" }),
          ]),
        );
      },
    );

    it("is neither listed nor restorable for people who were not space admin at deletion", async () => {
      const admin = await person();
      const reader = await person();
      const stranger = await person();
      const space = await confidentialSpace(admin, [{ person: reader, role: "editor" }]);
      const entryId = await deleteSpace(admin, space);
      for (const client of [reader.client, stranger.client, owner, instanceAdministrator.client]) {
        const listed = await client.get("/api/v1/deleted-spaces");
        expect(listed.statusCode, listed.body).toBe(200);
        expect(listed.json()).toEqual([]);
        const restored = await client.post(`/api/v1/deleted-spaces/${entryId}/restore`);
        expect(restored.statusCode).toBe(404);
        expectHidden(restored.body, space, "restore");
      }
      expect((await admin.client.get("/api/v1/deleted-spaces")).json()).toHaveLength(1);
    });

    it("stays out of reach of organization administrators, who see only the number", async () => {
      const admin = await person();
      const space = await confidentialSpace(admin);
      const before = await owner.get(`/api/v1/organizations/${organizationId}/trash/confidential-spaces`);
      expect(before.statusCode, before.body).toBe(200);
      const entryId = await deleteSpace(admin, space);

      const counted = await owner.get(`/api/v1/organizations/${organizationId}/trash/confidential-spaces`);
      expect(counted.json()).toEqual({ deleted: before.json().deleted + 1 });
      const trash = await owner.get(`/api/v1/organizations/${organizationId}/trash`);
      expect(trash.statusCode, trash.body).toBe(200);
      expectHidden(trash.body, space, "organization trash");
      expect(trash.body).not.toContain(entryId);
      const restored = await owner.post(`/api/v1/organizations/${organizationId}/trash/${entryId}/restore`);
      expect(restored.statusCode).toBe(404);
      expectHidden(restored.body, space, "organization restore");
      const audit = await owner.get(`/api/v1/organizations/${organizationId}/audit-events?limit=100`);
      expectHidden(audit.body, space, "audit");
      expect((await admin.client.get("/api/v1/deleted-spaces")).json()).toHaveLength(1);
    });
  });
});
