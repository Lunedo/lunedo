import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@pagehall/server";
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

  async function knowledgeBase(audience: "portal" | "signedIn", creator: TestClient = owner) {
    counter += 1;
    const created = await creator.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Kundenhilfe ${counter}`,
      key: `KH${counter}X`,
      type: "knowledgeBase",
      audience: "signedIn",
      grants: [],
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    if (audience === "portal") {
      const changed = await creator.put(`/api/v1/spaces/${id}/knowledge-base/audience`, {
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

  it("lets only member managers invite and manage portal accounts, even in a knowledge base a member created", async () => {
    const partner = await knowledgeBase("portal");
    const { token } = await invite(partner.id, "partnerin@example.org");
    const partnerReader = await accept(token, "Paula Partnerin");
    const pending = await owner.post(`/api/v1/organizations/${organizationId}/invitations`, {
      email: "neu-im-team@example.org",
      kind: "member",
    });
    expect(pending.statusCode, pending.body).toBe(201);
    const member = await createAccount(test, "max-kb@pagehall.test");
    const max = await signedInClient(test, member.email, member.password);
    const own = await knowledgeBase("portal", max);
    const attempts = [
      await max.get(`/api/v1/spaces/${own.id}/portal-accounts`),
      await max.post(`/api/v1/spaces/${own.id}/portal-accounts`, { email: "neu-im-team@example.org" }),
      await max.post(`/api/v1/spaces/${own.id}/portal-accounts/${partnerReader.accountId}/deactivate`, {}),
      await max.delete(`/api/v1/spaces/${own.id}/portal-accounts/${partnerReader.accountId}`),
      await max.delete(`/api/v1/spaces/${own.id}/portal-invitations/${pending.json().id as string}`),
    ];
    expect(attempts.map((attempt) => attempt.statusCode)).toEqual([403, 403, 403, 403, 403]);
    const states = await test.runtime.pool.query<{ revoked_at: Date | null; state: string }>(
      `select i.revoked_at, a.state from invitations i, accounts a where i.id = $1 and a.id = $2`,
      [pending.json().id, partnerReader.accountId],
    );
    expect(states.rows[0]).toEqual({ revoked_at: null, state: "active" });
  });

  it("lets a portal account read only the knowledge bases it was invited to", async () => {
    const first = await knowledgeBase("portal");
    const second = await knowledgeBase("portal");
    for (const kb of [first, second]) {
      const article = await owner.post(`/api/v1/spaces/${kb.id}/articles`, {
        title: "Lieferzeiten",
        sections: [{ key: "steps", title: "Schritte", markdown: `Lieferzeiten für ${kb.id}` }],
        publish: true,
      });
      expect(article.statusCode, article.body).toBe(201);
    }
    await services().search.indexer.drain();
    const firstInvite = await invite(first.id, "nur-eins@example.org");
    const onlyFirst = await accept(firstInvite.token, "Nur Eins");
    const secondInvite = await invite(second.id, "nur-zwei@example.org");
    const onlySecond = await accept(secondInvite.token, "Nur Zwei");
    const reader = await signIn("nur-eins@example.org");
    expect((await reader.get("/api/v1/account/portals")).json()).toEqual([
      expect.objectContaining({ spaceId: first.id }),
    ]);
    expect((await reader.get(`${first.path}/1-lieferzeiten`)).statusCode).toBe(200);
    const hidden = await reader.get(`${second.path}/1-lieferzeiten`);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).not.toContain(second.id);
    const search = await reader.get(`${second.path}/search?q=Lieferzeiten`);
    expect(search.body).not.toContain(second.id);
    const ownSearch = await reader.get(`${first.path}/search?q=Lieferzeiten`);
    expect(ownSearch.body).toContain(first.id);
    const listedFirst = (await owner.get(`/api/v1/spaces/${first.id}/portal-accounts`)).json().accounts as {
      id: string;
    }[];
    expect(listedFirst.map((account) => account.id)).toEqual([onlyFirst.accountId]);
    const foreign = await owner.post(`/api/v1/spaces/${first.id}/portal-accounts/${onlySecond.accountId}/deactivate`, {});
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().code).toBe("portalAccountNotFound");
    expect((await owner.delete(`/api/v1/spaces/${first.id}/portal-accounts/${onlySecond.accountId}`)).statusCode).toBe(404);
    const again = await invite(second.id, "nur-eins@example.org");
    await accept(again.token, "Nur Eins");
    expect((await reader.get(`${second.path}/1-lieferzeiten`)).statusCode).toBe(200);
    expect((await owner.delete(`/api/v1/spaces/${second.id}/portal-accounts/${onlyFirst.accountId}`)).statusCode).toBe(204);
    const back = await invite(second.id, "nur-eins@example.org");
    const rejoined = await new TestClient(test.app).post("/api/v1/invitations/accept", { token: back.token });
    expect(rejoined.statusCode, rejoined.body).toBe(200);
    expect((await reader.get(`${first.path}/1-lieferzeiten`)).statusCode).toBe(404);
  });

  it("keeps an open member invitation when the same address gets a portal invitation", async () => {
    const kb = await knowledgeBase("portal");
    const member = await owner.post(`/api/v1/organizations/${organizationId}/invitations`, {
      email: "beides@example.org",
      kind: "member",
    });
    expect(member.statusCode, member.body).toBe(201);
    await invite(kb.id, "beides@example.org");
    const other = await knowledgeBase("portal");
    await invite(other.id, "beides@example.org");
    const open = await test.runtime.pool.query<{ id: string }>(
      "select id from invitations where lower(email) = 'beides@example.org' and revoked_at is null order by id",
    );
    expect(open.rows).toHaveLength(3);
    expect(open.rows.map((row) => row.id)).toContain(member.json().id);
  });
});
