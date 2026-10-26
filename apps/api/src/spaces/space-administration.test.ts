import { accountAttemptLimitSetting, clientAttemptLimitSetting, SYSTEM } from "@lunedo/server";
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

const SECRET_TITLE = "Plans nobody else reads";

interface Person {
  id: string;
  email: string;
  name: string;
  client: TestClient;
}

describe.skipIf(!databaseBaseUrl)("space administration by organization administrators", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let ownerId: string;
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
    ownerId = (await owner.get("/api/v1/auth/session")).json().account.id;
    const created = await owner.post("/api/v1/organizations", { name: "Takeover tests" });
    expect(created.statusCode, created.body).toBe(201);
    organizationId = created.json().id;
  });

  afterAll(async () => {
    await test?.close();
  });

  async function person(): Promise<Person> {
    counter += 1;
    const email = `takeover${counter}@lunedo.test`;
    const password = "a long enough passphrase";
    const account = await createAccount(test, email, password, organizationId);
    return {
      id: account.id,
      email,
      name: email.split("@")[0] ?? email,
      client: await signedInClient(test, email, password),
    };
  }

  async function space(admin: Person, options: { confidential?: boolean } = {}) {
    counter += 1;
    const created = await admin.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Team space ${counter}`,
      key: `TK${counter}X`,
      visibility: "private",
      confidential: options.confidential ?? false,
      grants: [],
    });
    expect(created.statusCode, created.body).toBe(201);
    const result = created.json() as { id: string; key: string; name: string };
    const page = await admin.client.post(`/api/v1/spaces/${result.id}/items`, {
      kind: "page",
      title: SECRET_TITLE,
      parentId: null,
      mode: "live",
    });
    expect(page.statusCode, page.body).toBe(201);
    return result;
  }

  const selfPath = (spaceId: string) =>
    `/api/v1/organizations/${organizationId}/spaces/${spaceId}/self-appointment`;
  const cleanup = () => `/api/v1/organizations/${organizationId}/space-cleanup`;

  async function ageOrphaned(spaceId: string, days: number) {
    await test.runtime.pool.query(
      "update spaces set orphaned_at = now() - make_interval(days => $1) where id = $2 and orphaned_at is not null",
      [days, spaceId],
    );
  }

  describe("becoming space admin of a normal space", () => {
    it("needs a reason, records it, notifies and mails the space admins and gives a removable role", async () => {
      const admin = await person();
      const target = await space(admin);
      expect((await owner.get(`/api/v1/spaces/${target.id}`)).statusCode).toBe(404);

      const missing = await owner.post(selfPath(target.id), { reason: "   " });
      expect(missing.json().code).toBe("reasonRequired");

      const sentBefore = test.mail.sent.length;
      const taken = await owner.post(selfPath(target.id), {
        reason: "The team asked for help with its pages",
      });
      expect(taken.statusCode, taken.body).toBe(204);
      expect((await owner.get(`/api/v1/spaces/${target.id}`)).statusCode).toBe(200);

      const permissions = await admin.client.get(`/api/v1/spaces/${target.id}/permissions`);
      const grant = (permissions.json() as { id: string; principalId: string; role: string }[]).find(
        (entry) => entry.principalId === ownerId,
      );
      expect(grant?.role).toBe("admin");

      const audit = await owner.get(`/api/v1/organizations/${organizationId}/audit-events?limit=200`);
      expect(audit.body).toContain("space.administratorTaken");
      expect(audit.body).toContain("The team asked for help with its pages");

      const notifications = await admin.client.get("/api/v1/notifications");
      const item = (notifications.json().items as { type: string; params: Record<string, unknown> }[]).find(
        (entry) => entry.type === "space.administratorTaken",
      );
      expect(item?.params).toMatchObject({
        spaceName: target.name,
        spaceKey: target.key,
        reason: "The team asked for help with its pages",
      });
      await test.deliverMail();
      const mail = test.mail.sent.slice(sentBefore).find((sent) => sent.to === admin.email);
      expect(mail?.subject).toContain(target.name);
      expect(mail?.text).toContain("The team asked for help with its pages");
      expect(test.mail.sent.slice(sentBefore).some((sent) => sent.to === OWNER.email)).toBe(false);

      expect((await owner.post(selfPath(target.id), { reason: "Again" })).json().code).toBe(
        "alreadyAdministrator",
      );

      const removed = await admin.client.delete(`/api/v1/spaces/${target.id}/permissions/${grant?.id}`);
      expect(removed.statusCode, removed.body).toBeLessThan(300);
      expect((await owner.get(`/api/v1/spaces/${target.id}`)).statusCode).toBe(404);
    });

    it("is refused for confidential and personal spaces as if they did not exist", async () => {
      const admin = await person();
      const confidential = await space(admin, { confidential: true });
      const refused = await owner.post(selfPath(confidential.id), { reason: "Curious" });
      expect(refused.statusCode).toBe(404);
      expect(refused.body).not.toContain(confidential.name);

      const personal = await admin.client.post("/api/v1/account/personal-space", { overviewTitle: "Mine" });
      expect(personal.statusCode, personal.body).toBe(200);
      expect((await owner.post(selfPath(personal.json().id), { reason: "Curious" })).statusCode).toBe(404);
    });

    it("is refused for members without the right to manage the spaces of the organization", async () => {
      const admin = await person();
      const member = await person();
      const target = await space(admin);
      const refused = await member.client.post(selfPath(target.id), { reason: "I want in" });
      expect(refused.statusCode).toBe(403);
      expect((await member.client.get(`/api/v1/spaces/${target.id}`)).statusCode).toBe(404);
    });
  });

  describe("appointing a space admin", () => {
    it("notifies the appointed member of a confidential space", async () => {
      const admin = await person();
      const remaining = await person();
      counter += 1;
      const created = await admin.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
        name: `Council ${counter}`,
        key: `CO${counter}X`,
        visibility: "private",
        confidential: true,
        grants: [{ principalKind: "account", principalId: remaining.id, role: "editor" }],
      });
      const council = created.json() as { id: string; name: string };
      await owner.post(`/api/v1/accounts/${admin.id}/deactivate`);
      const appointed = await owner.post(
        `/api/v1/organizations/${organizationId}/confidential-spaces/${council.id}/administrator`,
        { accountId: remaining.id },
      );
      expect(appointed.statusCode, appointed.body).toBe(204);
      const notifications = await remaining.client.get("/api/v1/notifications");
      expect(notifications.body).toContain("space.administratorAppointed");
      expect(notifications.body).toContain(council.name);
      expect((await owner.get("/api/v1/notifications")).body).not.toContain(council.name);
    });
  });

  describe("cleaning up protected spaces", () => {
    it("lists a confidential space only after the waiting period without any active member", async () => {
      const admin = await person();
      const target = await space(admin, { confidential: true });
      await owner.post(`/api/v1/accounts/${admin.id}/deactivate`);
      expect((await owner.get(cleanup())).body).not.toContain(target.id);

      await ageOrphaned(target.id, 29);
      expect((await owner.get(cleanup())).body).not.toContain(target.id);

      await ageOrphaned(target.id, 31);
      const listed = await owner.get(cleanup());
      expect(listed.statusCode).toBe(200);
      expect(listed.json().graceDays).toBe(30);
      const entry = listed.json().items.find((item: { id: string }) => item.id === target.id);
      expect(entry).toMatchObject({
        key: target.key,
        kind: "confidential",
        pages: 2,
        formerMembers: [{ id: admin.id, name: admin.name }],
      });
      expect(listed.body).not.toContain(target.name);
      expect(listed.body).not.toContain(SECRET_TITLE);
    });

    it("drops a space from the list when a member is active again", async () => {
      const admin = await person();
      const target = await space(admin, { confidential: true });
      await owner.post(`/api/v1/accounts/${admin.id}/deactivate`);
      await ageOrphaned(target.id, 40);
      expect((await owner.get(cleanup())).body).toContain(target.id);
      const reactivated = await owner.post(`/api/v1/accounts/${admin.id}/reactivate`);
      expect(reactivated.statusCode, reactivated.body).toBeLessThan(300);
      expect((await owner.get(cleanup())).body).not.toContain(target.id);
      const refused = await owner.post(`${cleanup()}/${target.id}/delete`, {
        confirmation: target.key,
        reason: "Left",
      });
      expect(refused.json().code).toBe("notInCleanup");

      await owner.post(`/api/v1/accounts/${admin.id}/deactivate`);
      expect((await owner.get(cleanup())).body).not.toContain(target.id);
    });

    it("counts a membership that ended like a deactivation", async () => {
      const admin = await person();
      counter += 1;
      const visitor = await createAccount(test, `visitor${counter}@lunedo.test`);
      await test.runtime.database.transaction((tx) =>
        test.runtime.services.memberships.add(tx, SYSTEM, {
          organizationId,
          accountId: visitor.id,
          kind: "guest",
        }),
      );
      counter += 1;
      const created = await admin.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
        name: `Visited ${counter}`,
        key: `VI${counter}X`,
        visibility: "private",
        confidential: true,
        grants: [{ principalKind: "account", principalId: visitor.id, role: "editor" }],
      });
      expect(created.statusCode, created.body).toBe(201);
      const target = created.json() as { id: string };
      await owner.post(`/api/v1/accounts/${admin.id}/deactivate`);
      await ageOrphaned(target.id, 31);
      expect((await owner.get(cleanup())).body).not.toContain(target.id);
      const removed = await owner.delete(`/api/v1/organizations/${organizationId}/members/${visitor.id}`);
      expect(removed.statusCode, removed.body).toBeLessThan(300);
      expect((await owner.get(cleanup())).body).not.toContain(target.id);
      await ageOrphaned(target.id, 31);
      const listed = await owner.get(cleanup());
      expect(listed.body).toContain(target.id);
    });

    it("lists one-on-ones and personal spaces of the organization's people with their kind", async () => {
      const admin = await person();
      const partner = await person();
      const created = await admin.client.post("/api/v1/one-on-ones", {
        otherId: partner.id,
        organizationId,
        rhythm: { frequency: "weekly", interval: 2, weekdays: ["TH"] },
        startsOn: "2030-10-17",
        startTime: "14:00",
        timeZone: "Europe/Vienna",
        durationMinutes: 30,
      });
      expect(created.statusCode, created.body).toBe(201);
      const oneOnOne = { id: (created.json() as { spaceId: string }).spaceId };
      const personal = await admin.client.post("/api/v1/account/personal-space", { overviewTitle: "Mine" });
      const personalId = personal.json().id as string;
      await owner.post(`/api/v1/accounts/${admin.id}/deactivate`);
      await owner.post(`/api/v1/accounts/${partner.id}/deactivate`);
      await ageOrphaned(oneOnOne.id, 31);
      await ageOrphaned(personalId, 31);
      const items = (await owner.get(cleanup())).json().items as { id: string; kind: string }[];
      expect(items.find((item) => item.id === oneOnOne.id)?.kind).toBe("oneOnOne");
      expect(items.find((item) => item.id === personalId)?.kind).toBe("personal");

      const other = await owner.post("/api/v1/organizations", { name: `Elsewhere ${counter}` });
      const otherId = other.json().id as string;
      const elsewhere = await owner.get(`/api/v1/organizations/${otherId}/space-cleanup`);
      expect(elsewhere.body).not.toContain(personalId);
      expect(elsewhere.body).not.toContain(oneOnOne.id);
    });

    it("deletes with the typed key and a reason into the trash and records it without the name", async () => {
      const admin = await person();
      const target = await space(admin, { confidential: true });
      await owner.post(`/api/v1/accounts/${admin.id}/deactivate`);
      await ageOrphaned(target.id, 31);
      const path = `${cleanup()}/${target.id}/delete`;
      expect((await owner.post(path, { confirmation: "WRONG", reason: "Left" })).json().code).toBe(
        "confirmationMismatch",
      );
      expect((await owner.post(path, { confirmation: target.key, reason: " " })).json().code).toBe(
        "reasonRequired",
      );
      const deleted = await owner.post(path, {
        confirmation: target.key.toLowerCase(),
        reason: "Everyone left the company",
      });
      expect(deleted.statusCode, deleted.body).toBe(204);
      expect((await owner.get(cleanup())).body).not.toContain(target.id);

      const stored = await test.runtime.pool.query(
        `
        select s.deleted_at is not null as deleted, e.stage from spaces s
        join trash_entries e on e.space_id = s.id and e.kind = 'space' where s.id = $1`,
        [target.id],
      );
      expect(stored.rows[0]).toEqual({ deleted: true, stage: 2 });

      const audit = await owner.get(`/api/v1/organizations/${organizationId}/audit-events?limit=200`);
      expect(audit.body).toContain("space.cleanupDeleted");
      expect(audit.body).toContain("Everyone left the company");
      expect(audit.body).not.toContain(target.name);
    });

    it("lets only people who manage the spaces of the organization delete, never with an API token", async () => {
      const admin = await person();
      const member = await person();
      const target = await space(admin, { confidential: true });
      await owner.post(`/api/v1/accounts/${admin.id}/deactivate`);
      await ageOrphaned(target.id, 31);
      const path = `${cleanup()}/${target.id}/delete`;
      const body = { confirmation: target.key, reason: "Left" };
      expect((await member.client.post(path, body)).statusCode).toBe(403);
      expect((await member.client.get(cleanup())).statusCode).toBe(403);
      const token = await owner.post("/api/v1/account/tokens", {
        name: `Cleanup ${counter}`,
        scopes: { organization: { spaces: "manage" } },
      });
      expect(token.statusCode, token.body).toBe(201);
      const headers = { authorization: `Bearer ${token.json().token}` };
      const anonymous = new TestClient(test.app);
      expect((await anonymous.post(path, body, headers)).statusCode).toBeGreaterThanOrEqual(400);
      expect(
        (await anonymous.post(selfPath(target.id), { reason: "Script" }, headers)).statusCode,
      ).toBeGreaterThanOrEqual(400);
      expect((await owner.get(cleanup())).body).toContain(target.id);
    });

    it("keeps the waiting period at seven days or more", async () => {
      const response = await owner.put(
        `/api/v1/organizations/${organizationId}/settings/spaces.cleanupGraceDays`,
        { value: 5 },
      );
      expect(response.statusCode).toBe(400);
      const accepted = await owner.put(
        `/api/v1/organizations/${organizationId}/settings/spaces.cleanupGraceDays`,
        { value: 7 },
      );
      expect(accepted.statusCode, accepted.body).toBeLessThan(300);
      expect((await owner.get(cleanup())).json().graceDays).toBe(7);
    });
  });
});
