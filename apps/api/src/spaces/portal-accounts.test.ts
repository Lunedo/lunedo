import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@pagehall/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  firstOrganizationId,
  OWNER,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

function linkToken(text: string | undefined): string {
  const match = /#token=([\w-]{43})/.exec(text ?? "");
  if (!match?.[1]) throw new Error("The mail contains no link with a token");
  return match[1];
}

describe.skipIf(!databaseBaseUrl)("portal accounts", () => {
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

  const services = () => {
    const found = test.runtime.services;
    if (!found) throw new Error("services missing");
    return found;
  };

  async function mailTo(address: string) {
    await test.deliverMail();
    return test.mail.sent.filter((mail) => mail.to.toLowerCase() === address.toLowerCase()).at(-1);
  }

  async function knowledgeBase(audience: "portal" | "signedIn") {
    counter += 1;
    const created = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Kundenhilfe ${counter}`,
      key: `KH${counter}X`,
      type: "knowledgeBase",
      audience: "signedIn",
      grants: [],
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    if (audience === "portal") {
      const changed = await owner.put(`/api/v1/spaces/${id}/knowledge-base/audience`, {
        audience,
        groupIds: [],
        confirmWidening: true,
      });
      expect(changed.statusCode, changed.body).toBe(200);
    }
    const config = await services().portals.config(id);
    return { id, path: `/help/${config?.path ?? ""}` };
  }

  async function invite(spaceId: string, email: string, expiresAt: string | null = null) {
    const invited = await owner.post(`/api/v1/spaces/${spaceId}/portal-accounts`, { email, expiresAt });
    expect(invited.statusCode, invited.body).toBe(201);
    const mail = await mailTo(email);
    return { invitation: invited.json() as { id: string }, token: linkToken(mail?.text), mail };
  }

  async function accept(token: string, name: string, password = "a reader passphrase") {
    const accepted = await new TestClient(test.app).post("/api/v1/invitations/accept", {
      token,
      name,
      password,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    return accepted.json() as { accountId: string; portalUrl: string | null };
  }

  async function signIn(email: string, password = "a reader passphrase") {
    const client = new TestClient(test.app);
    const response = await client.post("/api/v1/auth/sign-in", { email, password });
    expect(response.statusCode, response.body).toBe(200);
    return client;
  }

  it("invites a reader who creates a portal account and reads only the portal", async () => {
    const kb = await knowledgeBase("portal");
    const article = await owner.post(`/api/v1/spaces/${kb.id}/articles`, {
      title: "Rechnung herunterladen",
      sections: [{ key: "steps", title: "Schritte", markdown: "Im Kundenbereich auf Rechnungen klicken." }],
      publish: true,
    });
    expect(article.statusCode, article.body).toBe(201);
    const { number } = article.json() as { number: number };
    await services().search.indexer.drain();
    const { invitation, token, mail } = await invite(kb.id, "kundin@example.org", "2099-01-01T00:00:00.000Z");
    expect(mail?.subject).toContain("Kundenhilfe");
    const audit = await test.runtime.pool.query<{ fields: Record<string, unknown> }>(
      "select fields from audit_events where name = 'portalAccount.invited' and target_id = $1",
      [invitation.id],
    );
    expect(audit.rows[0]?.fields).toMatchObject({ spaceId: kb.id });
    const preview = await new TestClient(test.app).post("/api/v1/invitations/preview", { token });
    expect(preview.json()).toMatchObject({
      state: "open",
      knowledgeBaseName: expect.stringContaining("Kundenhilfe"),
    });
    const accepted = await accept(token, "Klara Kundin");
    expect(accepted.portalUrl).toContain(kb.path);
    const type = await test.runtime.pool.query<{ type: string }>("select type from accounts where id = $1", [
      accepted.accountId,
    ]);
    expect(type.rows[0]?.type).toBe("portal");
    const reader = await signIn("kundin@example.org");
    expect((await reader.get("/api/v1/auth/session")).statusCode).toBe(200);
    const portals = await reader.get("/api/v1/account/portals");
    expect(portals.json()).toEqual([expect.objectContaining({ spaceId: kb.id })]);
    const app = await reader.get(`/api/v1/spaces/${kb.id}`);
    expect(app.statusCode).toBe(403);
    expect(app.json().code).toBe("portalAccountOnly");
    expect((await reader.get(`/api/v1/organizations`)).json().code).toBe("portalAccountOnly");
    const page = await reader.get(`${kb.path}/${number}-rechnung-herunterladen`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Im Kundenbereich auf Rechnungen klicken.");
    expect(page.body).not.toContain("Zum Wiki");
    const listed = await owner.get(`/api/v1/spaces/${kb.id}/portal-accounts`);
    expect(listed.json().accounts).toEqual([
      expect.objectContaining({
        id: accepted.accountId,
        state: "active",
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
    ]);
  });

  it("deactivates and removes portal accounts and ends their access when it expires", async () => {
    const kb = await knowledgeBase("portal");
    const first = await invite(kb.id, "eins@example.org");
    const one = await accept(first.token, "Erste Leserin");
    const second = await invite(kb.id, "zwei@example.org");
    const two = await accept(second.token, "Zweiter Leser");
    const third = await invite(kb.id, "drei@example.org");
    const three = await accept(third.token, "Dritte Leserin");
    const reader = await signIn("eins@example.org");
    const deactivated = await owner.post(
      `/api/v1/spaces/${kb.id}/portal-accounts/${one.accountId}/deactivate`,
      {},
    );
    expect(deactivated.statusCode, deactivated.body).toBe(204);
    expect((await reader.get("/api/v1/auth/session")).statusCode).toBe(401);
    const signInAgain = await new TestClient(test.app).post("/api/v1/auth/sign-in", {
      email: "eins@example.org",
      password: "a reader passphrase",
    });
    expect(signInAgain.statusCode).not.toBe(200);
    expect((await owner.delete(`/api/v1/spaces/${kb.id}/portal-accounts/${two.accountId}`)).statusCode).toBe(
      204,
    );
    const removed = await test.runtime.pool.query<{ reason: string }>(
      "select fields->>'reason' as reason from audit_events where name = 'membership.removed' and target_id = $1",
      [two.accountId],
    );
    expect(removed.rows.map((row) => row.reason)).toContain("removed");
    await test.runtime.pool.query(
      "update memberships set expires_at = now() - interval '1 minute' where account_id = $1",
      [three.accountId],
    );
    await services().lifecycle.processExpiry();
    const expired = await test.runtime.pool.query<{ reason: string }>(
      "select fields->>'reason' as reason from audit_events where name = 'membership.removed' and target_id = $1",
      [three.accountId],
    );
    expect(expired.rows.map((row) => row.reason)).toContain("expired");
    const later = await signIn("drei@example.org");
    expect((await later.get("/api/v1/account/portals")).json()).toEqual([]);
  });

  it("invites portal accounts only to knowledge bases for portal accounts and never takes over other accounts", async () => {
    const internal = await knowledgeBase("signedIn");
    const refused = await owner.post(`/api/v1/spaces/${internal.id}/portal-accounts`, {
      email: "x@example.org",
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe("portalAudienceRequired");
    const kb = await knowledgeBase("portal");
    const member = await createAccount(test, "kollege@pagehall.test");
    const { token } = await invite(kb.id, member.email);
    const taken = await new TestClient(test.app).post("/api/v1/invitations/accept", {
      token,
      name: "Kollege",
      password: "a reader passphrase",
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().code).toBe("portalInvitationAccountExists");
    const type = await test.runtime.pool.query<{ type: string }>("select type from accounts where id = $1", [
      member.id,
    ]);
    expect(type.rows[0]?.type).toBe("standard");
  });
});
