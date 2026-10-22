import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@lunedo/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  firstOrganizationId,
  OWNER,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

interface ArticleBody {
  id: string;
  number: number | null;
  language: string;
  title: string;
  draft: boolean;
  sections: { key: string; html: string; text: string }[];
  images: { attachmentId: string; name: string; alt: string; url: string }[];
  portalUrl: string | null;
}

describe.skipIf(!databaseBaseUrl)("knowledge base articles for programs", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let organizationId: string;
  let counter = 0;
  const bot = () => new TestClient(test.app);

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

  async function knowledgeBase() {
    counter += 1;
    const created = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Articles ${counter}`,
      key: `AR${counter}X`,
      type: "knowledgeBase",
      audience: "signedIn",
      grants: [],
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const languages = await owner.put(`/api/v1/spaces/${id}/knowledge-base/languages`, {
      defaultLanguage: "de",
      languages: ["de"],
    });
    expect(languages.statusCode, languages.body).toBe(200);
    return id;
  }

  async function serviceAccount(name: string) {
    const created = await owner.post(`/api/v1/organizations/${organizationId}/service-accounts`, { name });
    expect(created.statusCode, created.body).toBe(201);
    return created.json().id as string;
  }

  async function grant(spaceId: string, accountId: string, role: "reader" | "editor") {
    const granted = await owner.post(`/api/v1/spaces/${spaceId}/permissions`, {
      action: "grant",
      principalKind: "account",
      principalId: accountId,
      role,
    });
    expect(granted.statusCode, granted.body).toBe(200);
  }

  async function token(
    accountId: string,
    contentLevel: "read" | "draft" | "publish",
    knowledgeBaseIds: string[] | null = null,
  ) {
    const created = await owner.post(`/api/v1/service-accounts/${accountId}/tokens`, {
      name: `Help ${contentLevel}`,
      scopes: { organization: { spaces: contentLevel === "read" ? "view" : "manage" } },
      contentLevel,
      ...(knowledgeBaseIds ? { knowledgeBaseIds } : {}),
    });
    expect(created.statusCode, created.body).toBe(201);
    const body = created.json() as { token: string; apiToken: { id: string; contentLevel: string } };
    expect(body.apiToken.contentLevel).toBe(contentLevel);
    return body;
  }

  async function published(spaceId: string, title: string, text: string) {
    const created = await owner.post(`/api/v1/spaces/${spaceId}/articles`, {
      title,
      sections: [{ key: "summary", title: "About", markdown: text }],
      publish: true,
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json() as ArticleBody;
  }

  async function auditFields(name: string, targetId: string) {
    const result = await test.runtime.pool.query<{ fields: Record<string, unknown> }>(
      "select fields from audit_events where name = $1 and target_id = $2 order by sequence",
      [name, targetId],
    );
    return result.rows.map((row) => row.fields);
  }

  it("writes drafts with a draft token and never publishes with it", async () => {
    const kb = await knowledgeBase();
    const account = await serviceAccount("Help assistant");
    await grant(kb, account, "editor");
    const drafts = await token(account, "draft", [kb]);
    const client = bot();
    const refused = await client.post(
      `/api/v1/spaces/${kb}/articles`,
      { title: "VPN", sections: [], publish: true },
      bearer(drafts.token),
    );
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe("publishNotAllowed");
    const created = await client.post(
      `/api/v1/spaces/${kb}/articles`,
      {
        title: "VPN einrichten",
        type: "howTo",
        sections: [{ key: "steps", title: "Schritte", markdown: "1. Client öffnen" }],
        versionNote: "Geprüft von Anna Huber im KB-Assistenten",
      },
      bearer(drafts.token),
    );
    expect(created.statusCode, created.body).toBe(201);
    const article = created.json() as ArticleBody;
    expect(article).toMatchObject({ draft: true, portalUrl: null, language: "de" });
    const image = await client.post(`/api/v1/articles/${article.id}/images?name=client.png`, PNG, {
      ...bearer(drafts.token),
      "content-type": "application/octet-stream",
    });
    expect(image.statusCode, image.body).toBe(201);
    const saved = await client.put(
      `/api/v1/articles/${article.id}/draft`,
      {
        sections: [
          { key: "steps", title: "Schritte", markdown: "1. Client öffnen\n\n![Anmeldefenster](client.png)" },
        ],
        versionNote: "Geprüft von Anna Huber im KB-Assistenten",
      },
      bearer(drafts.token),
    );
    expect(saved.statusCode, saved.body).toBe(200);
    const draft = saved.json() as ArticleBody;
    expect(draft.images).toEqual([
      expect.objectContaining({
        name: "client.png",
        alt: "Anmeldefenster",
        url: expect.stringContaining("?size=display"),
      }),
    ]);
    expect(draft.sections[0]?.html).toContain("<img");
    expect(draft.sections[0]?.text).toContain("Client öffnen");
    expect(
      (await client.post(`/api/v1/articles/${article.id}/publish`, {}, bearer(drafts.token))).statusCode,
    ).toBe(403);
    expect(
      (
        await client.put(
          `/api/v1/pages/${article.id}/content`,
          { document: { type: "doc", content: [] } },
          bearer(drafts.token),
        )
      ).statusCode,
    ).toBe(403);
    const changes = await client.get(`/api/v1/spaces/${kb}/article-changes`, bearer(drafts.token));
    expect(changes.json().items).toEqual([]);
    const draftChanges = await client.get(
      `/api/v1/spaces/${kb}/article-changes?draft=true`,
      bearer(drafts.token),
    );
    expect(draftChanges.json().items.map((entry: ArticleBody) => entry.id)).toEqual([article.id]);
    const publish = await owner.post(`/api/v1/pages/${article.id}/publish`, {});
    expect(publish.statusCode, publish.body).toBe(200);
    const history = await owner.get(`/api/v1/pages/${article.id}/versions`);
    expect(history.json()[0]).toMatchObject({ note: "Geprüft von Anna Huber im KB-Assistenten" });
  });

  it("keeps a token to the knowledge bases it is limited to and to what its account may do", async () => {
    const allowed = await knowledgeBase();
    const other = await knowledgeBase();
    const account = await serviceAccount("Limited bot");
    await grant(allowed, account, "editor");
    await grant(other, account, "reader");
    await published(other, "Drucker", "Drucker im Flur");
    const limited = await token(account, "publish", [allowed]);
    const unlimited = await token(account, "publish");
    const client = bot();
    expect(
      (await client.get(`/api/v1/spaces/${other}/article-changes`, bearer(limited.token))).statusCode,
    ).toBe(404);
    const readable = await client.get(`/api/v1/spaces/${other}/article-changes`, bearer(unlimited.token));
    expect(readable.statusCode).toBe(200);
    expect(readable.json().items).toHaveLength(1);
    const beyondAccount = await client.post(
      `/api/v1/spaces/${other}/articles`,
      { title: "Neu", sections: [], publish: true },
      bearer(unlimited.token),
    );
    expect(beyondAccount.statusCode).toBe(403);
    const reads = await token(account, "read");
    const created = await client.post(
      `/api/v1/spaces/${allowed}/articles`,
      { title: "Neu" },
      bearer(reads.token),
    );
    expect(created.statusCode).toBe(403);
    const search = await client.get(
      `/api/v1/organizations/${organizationId}/search?q=Drucker`,
      bearer(limited.token),
    );
    expect(search.statusCode).toBe(200);
    expect(JSON.stringify(search.json())).not.toContain("Drucker");
  });

  it("publishes with a publishing token, audits it and lists changes with tombstones", async () => {
    const kb = await knowledgeBase();
    const account = await serviceAccount("Sync bot");
    await grant(kb, account, "editor");
    const publishing = await token(account, "publish", [kb]);
    const client = bot();
    const start = new Date(Date.now() - 60_000).toISOString();
    const created = await client.post(
      `/api/v1/spaces/${kb}/articles`,
      {
        title: "Passwort ändern",
        sections: [{ key: "steps", title: "Schritte", markdown: "Neues Passwort wählen." }],
        versionNote: "Vom Assistenten übernommen",
        publish: true,
      },
      bearer(publishing.token),
    );
    expect(created.statusCode, created.body).toBe(201);
    const article = created.json() as ArticleBody;
    expect(article.portalUrl).toMatch(new RegExp(`/${article.number}-passwort-aendern$`));
    const audit = await auditFields("page.publishedWithToken", article.id);
    expect(audit).toEqual([
      expect.objectContaining({ credentialId: publishing.apiToken.id, note: "Vom Assistenten übernommen" }),
    ]);
    const hidden = await published(kb, "Intern", "Nur für IT");
    const restricted = await owner.post(`/api/v1/pages/${hidden.id}/access`, {
      changes: [{ action: "restrict", kind: "view" }],
    });
    expect(restricted.statusCode, restricted.body).toBe(200);
    const removed = await published(kb, "Alt", "Veraltet");
    expect((await owner.delete(`/api/v1/items/${removed.id}`)).statusCode).toBeLessThan(300);
    const confidential = await published(kb, "Sozialplan", "Nur für HR");
    const closed = await owner.post(`/api/v1/pages/${confidential.id}/access`, {
      changes: [{ action: "restrict", kind: "view" }],
    });
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await owner.delete(`/api/v1/items/${confidential.id}`)).statusCode).toBeLessThan(300);
    const changes = await client.get(
      `/api/v1/spaces/${kb}/article-changes?changedSince=${encodeURIComponent(start)}&limit=1`,
      bearer(publishing.token),
    );
    expect(changes.statusCode, changes.body).toBe(200);
    const all: ArticleBody[] = [];
    const tombstones: { itemId: string; number: number; reason: string }[] = [];
    let page = changes.json();
    for (;;) {
      all.push(...page.items);
      tombstones.push(...page.removed);
      if (!page.nextCursor) break;
      page = (
        await client.get(
          `/api/v1/spaces/${kb}/article-changes?changedSince=${encodeURIComponent(start)}&limit=1&cursor=${page.nextCursor}`,
          bearer(publishing.token),
        )
      ).json();
    }
    expect(all.map((entry) => entry.id)).toContain(article.id);
    expect(all.map((entry) => entry.id)).not.toContain(hidden.id);
    expect(tombstones).toEqual([
      expect.objectContaining({ itemId: removed.id, number: removed.number, reason: "deleted" }),
    ]);
    const tooOld = await client.get(
      `/api/v1/spaces/${kb}/article-changes?changedSince=${encodeURIComponent(new Date(Date.now() - 100 * 86_400_000).toISOString())}`,
      bearer(publishing.token),
    );
    expect(tooOld.statusCode).toBe(400);
    expect(tooOld.json().code).toBe("changedSinceTooOld");
  });

  it("audits the creation of tokens and every change of their write level", async () => {
    const kb = await knowledgeBase();
    const account = await serviceAccount("Audited bot");
    const created = await token(account, "read", [kb]);
    expect(await auditFields("apiToken.created", created.apiToken.id)).toEqual([
      expect.objectContaining({ contentLevel: "read", knowledgeBaseIds: [kb] }),
    ]);
    const refused = await owner.put(
      `/api/v1/service-accounts/${account}/tokens/${created.apiToken.id}/content-access`,
      {
        contentLevel: "publish",
        knowledgeBaseIds: null,
      },
    );
    expect(refused.statusCode).toBe(400);
    expect(refused.json().code).toBe("invalidScopes");
    const manage = await owner.post(`/api/v1/service-accounts/${account}/tokens`, {
      name: "Writer",
      scopes: { organization: { spaces: "manage" } },
    });
    const writer = manage.json() as { apiToken: { id: string; contentLevel: string } };
    expect(writer.apiToken.contentLevel).toBe("publish");
    const changed = await owner.put(
      `/api/v1/service-accounts/${account}/tokens/${writer.apiToken.id}/content-access`,
      {
        contentLevel: "draft",
        knowledgeBaseIds: [kb],
      },
    );
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toMatchObject({ contentLevel: "draft", knowledgeBaseIds: [kb] });
    expect(await auditFields("apiToken.levelChanged", writer.apiToken.id)).toEqual([
      expect.objectContaining({
        contentLevel: "draft",
        previousContentLevel: "publish",
        knowledgeBaseIds: [kb],
      }),
    ]);
    const notKnowledgeBase = await owner.put(
      `/api/v1/service-accounts/${account}/tokens/${writer.apiToken.id}/content-access`,
      { contentLevel: "draft", knowledgeBaseIds: [organizationId] },
    );
    expect(notKnowledgeBase.statusCode).toBe(400);
    expect(notKnowledgeBase.json().code).toBe("invalidKnowledgeBases");
  });
});
