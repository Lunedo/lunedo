import { accountAttemptLimitSetting, clientAttemptLimitSetting, SYSTEM } from "@pagehall/server";
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
import {
  type AuthTestApp,
  createAuthTestApp,
  databaseBaseUrl,
  TEST_ORIGIN,
  TestClient,
} from "../testing/auth-app.js";
import { messagesFor } from "./messages.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function comparable(body: string): string {
  return body.replace(/nonce="[^"]*"/g, "").replace(/value="[^"]*"/g, "");
}

describe.skipIf(!databaseBaseUrl)("knowledge base portal", () => {
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

  async function person(options: { portal?: boolean } = {}) {
    counter += 1;
    const account = await createAccount(test, `portal${counter}@pagehall.test`);
    if (options.portal) {
      await test.runtime.pool.query("update accounts set type = 'portal' where id = $1", [account.id]);
      await test.runtime.pool.query("update memberships set kind = 'guest' where account_id = $1", [
        account.id,
      ]);
    }
    return { id: account.id, client: await signedInClient(test, account.email, account.password) };
  }

  async function knowledgeBase(
    audience: "public" | "signedIn" | "groups" | "portal",
    groupIds: string[] = [],
  ) {
    counter += 1;
    const created = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Help ${counter}`,
      key: `PH${counter}X`,
      type: "knowledgeBase",
      audience: "signedIn",
      grants: [],
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    if (audience !== "signedIn") {
      const changed = await owner.put(`/api/v1/spaces/${id}/knowledge-base/audience`, {
        audience,
        groupIds,
        confirmWidening: true,
      });
      expect(changed.statusCode, changed.body).toBe(200);
    }
    const config = await services().portals.config(id);
    return { id, path: `/help/${config?.path ?? ""}` };
  }

  async function folder(spaceId: string, title: string, parentId: string | null = null) {
    const created = await owner.post(`/api/v1/spaces/${spaceId}/items`, { kind: "folder", title, parentId });
    expect(created.statusCode, created.body).toBe(201);
    return created.json().id as string;
  }

  async function article(
    spaceId: string,
    parentId: string | null,
    title: string,
    text: string,
    options: { type?: "howTo" | "troubleshooting"; publish?: boolean } = {},
  ) {
    const created = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
      kind: "page",
      title,
      parentId,
      ...(options.type ? { articleType: options.type } : {}),
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const content = await owner.put(`/api/v1/pages/${id}/content`, {
      document: {
        type: "doc",
        content: [
          {
            type: "section",
            attrs: { key: "summary", title: "About", icon: "eye" },
            content: [paragraph(text)],
          },
        ],
      },
    });
    expect(content.statusCode, content.body).toBe(200);
    if (options.publish !== false) {
      const published = await owner.post(`/api/v1/pages/${id}/publish`, {});
      expect(published.statusCode, published.body).toBe(200);
    }
    const number = await test.runtime.pool.query<{ number: number }>(
      "select number from article_numbers where item_id = $1 and space_id = $2",
      [id, spaceId],
    );
    return { id, number: Number(number.rows[0]?.number) };
  }

  async function index() {
    await services().search.indexer.drain();
  }

  const anonymous = () => new TestClient(test.app);

  it("serves a public knowledge base to anonymous readers with categories, articles and search", async () => {
    const kb = await knowledgeBase("public");
    const it = await folder(kb.id, "IT");
    const vpn = await article(kb.id, it, "VPN einrichten", "Mit dem VPN arbeitest du von zu Hause.", {
      type: "howTo",
    });
    await index();
    const reader = anonymous();
    const start = await reader.get(`${kb.path}/`);
    expect(start.statusCode).toBe(200);
    expect(start.headers["content-type"]).toContain("text/html");
    expect(start.body).toContain(">IT<");
    expect(start.headers["content-security-policy"]).toContain("script-src 'self'");
    const page = await reader.get(`${kb.path}/${vpn.number}-vpn-einrichten`);
    expect(page.statusCode, page.body).toBe(200);
    expect(page.body).toContain("Mit dem VPN arbeitest du von zu Hause.");
    expect(page.body).toContain('class="hb"');
    const found = await reader.get(`${kb.path}/search?q=VPN`);
    expect(found.statusCode).toBe(200);
    expect(found.body).toContain(`/${vpn.number}-vpn-einrichten`);
    const category = await reader.get(`${kb.path}/topics/${it}`);
    expect(category.statusCode).toBe(200);
    expect(category.body).toContain("VPN einrichten");
  });

  it("serves article images to readers who may read the article and to nobody else", async () => {
    const kb = await knowledgeBase("public");
    const entry = await article(kb.id, null, "Bild", "Mit Bild.");
    const uploaded = await owner.post(
      `/api/v1/pages/${entry.id}/attachments?name=${encodeURIComponent("bild.png")}`,
      PNG,
      { "content-type": "application/octet-stream" },
    );
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const imageId = uploaded.json().id as string;
    await owner.put(`/api/v1/pages/${entry.id}/content`, {
      document: {
        type: "doc",
        content: [paragraph("Mit Bild."), { type: "image", attrs: { attachmentId: imageId, alt: "Bild" } }],
      },
    });
    await owner.post(`/api/v1/pages/${entry.id}/publish`, {});
    await index();
    const visitor = anonymous();
    const page = await visitor.get(`${kb.path}/${entry.number}-bild`);
    expect(page.body).toContain(`src="${kb.path}/files/${imageId}?size=display"`);
    const image = await visitor.get(`${kb.path}/files/${imageId}`);
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toBe("image/png");
    const internal = await knowledgeBase("signedIn");
    const hidden = await article(internal.id, null, "Intern", "Intern.");
    const secret = await owner.post(
      `/api/v1/pages/${hidden.id}/attachments?name=${encodeURIComponent("geheim.png")}`,
      PNG,
      { "content-type": "application/octet-stream" },
    );
    const secretId = secret.json().id as string;
    expect((await visitor.get(`${kb.path}/files/${secretId}`)).statusCode).toBe(404);
  });

  it("saves a palette color, refuses an own color without contrast and saves the proposal on confirmation", async () => {
    const kb = await knowledgeBase("public");
    const palette = await owner.put(`/api/v1/spaces/${kb.id}/knowledge-base/portal/appearance`, {
      brand: { color: "red", light: null, dark: null },
      poweredBy: false,
      topBarThreshold: 6,
    });
    expect(palette.statusCode, palette.body).toBe(200);
    expect(palette.json()).toMatchObject({ brand: { color: "red" }, poweredBy: false, topBarThreshold: 6 });
    const brand = { color: "custom", light: "#FFB000", dark: "#8AA8E6" };
    const refused = await owner.put(`/api/v1/spaces/${kb.id}/knowledge-base/portal/appearance`, { brand });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      code: "brandContrast",
      light: { passes: false },
      dark: { passes: true },
    });
    const proposal = refused.json().light.proposal as string;
    const confirmed = await owner.put(`/api/v1/spaces/${kb.id}/knowledge-base/portal/appearance`, {
      brand,
      confirmProposal: true,
    });
    expect(confirmed.json().colors).toEqual({ light: proposal, dark: "#8AA8E6" });
    const page = await anonymous().get(`${kb.path}/`);
    expect(page.body).toContain(`--kb:${proposal}`);
    expect(page.body).not.toContain("Provided with Pagehall");
    const reader = await person();
    const denied = await reader.client.put(`/api/v1/spaces/${kb.id}/knowledge-base/portal/appearance`, {
      poweredBy: true,
    });
    expect([403, 404]).toContain(denied.statusCode);
  });

  it("lets only instance administrators allow domains and points the help icon to a readable knowledge base", async () => {
    const member = await person();
    const denied = await member.client.post("/api/v1/instance/portal-domains", {
      domain: "nope.example.org",
      organizationId,
    });
    expect([403, 404]).toContain(denied.statusCode);
    const groupsKb = await knowledgeBase("groups", [
      (await services().groups.create(SYSTEM, organizationId, { name: `Help group ${counter}` })).id,
    ]);
    const refused = await owner.put(`/api/v1/organizations/${organizationId}/help`, { spaceId: groupsKb.id });
    expect(refused.statusCode).toBe(400);
    const kb = await knowledgeBase("signedIn");
    const chosen = await owner.put(`/api/v1/organizations/${organizationId}/help`, { spaceId: kb.id });
    expect(chosen.statusCode, chosen.body).toBe(200);
    const seen = await member.client.get(`/api/v1/organizations/${organizationId}/help`);
    expect(seen.json().current).toMatchObject({ spaceId: kb.id, url: `${TEST_ORIGIN}${kb.path}/` });
    await owner.put(`/api/v1/organizations/${organizationId}/help`, { spaceId: null });
  });

  it("asks anonymous readers to sign in on every address of a knowledge base that is not public", async () => {
    const kb = await knowledgeBase("signedIn");
    const entry = await article(kb.id, null, "Drucker", "Drucken im Büro.");
    await index();
    const visitor = anonymous();
    for (const path of ["/", `/${entry.number}-drucker`, "/999-unknown", "/search?q=drucker"]) {
      const response = await visitor.get(`${kb.path}${path}`);
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("/sign-in?redirect=");
      expect(response.body).not.toContain("Drucken im Büro.");
    }
    const member = await person();
    const read = await member.client.get(`${kb.path}/${entry.number}-drucker`);
    expect(read.statusCode).toBe(200);
    expect(read.body).toContain("Drucken im Büro.");
  });

  it("lets only group members read a knowledge base for groups, and hides it like a missing page", async () => {
    const member = await person();
    const outsider = await person();
    const group = await services().groups.create(SYSTEM, organizationId, { name: `Readers ${counter}` });
    await services().groups.addMember(SYSTEM, group.id, member.id);
    const kb = await knowledgeBase("groups", [group.id]);
    const entry = await article(kb.id, null, "Gehalt", "Abrechnung im Portal.");
    await index();
    const allowed = await member.client.get(`${kb.path}/${entry.number}-gehalt`);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).toContain("Abrechnung im Portal.");
    const hidden = await outsider.client.get(`${kb.path}/${entry.number}-gehalt`);
    const missing = await outsider.client.get(`${kb.path}/9999-gehalt`);
    expect(hidden.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(comparable(hidden.body)).toBe(comparable(missing.body));
  });

  it("lets portal accounts read a knowledge base for portal accounts but never internal spaces", async () => {
    const reader = await person({ portal: true });
    const kb = await knowledgeBase("portal");
    const entry = await article(kb.id, null, "Kundenhilfe", "Für Kunden.");
    const internal = await knowledgeBase("signedIn");
    const secret = await article(internal.id, null, "Intern", "Nur intern.");
    await index();
    const read = await reader.client.get(`${kb.path}/${entry.number}-kundenhilfe`);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.body).toContain("Für Kunden.");
    expect(read.body).not.toContain(">Zum Wiki<");
    expect(read.body).not.toContain(">Go to the wiki<");
    const blocked = await reader.client.get(`${internal.path}/${secret.number}-intern`);
    expect(blocked.statusCode).toBe(404);
    const standard = await person();
    expect((await standard.client.get(`${kb.path}/${entry.number}-kundenhilfe`)).statusCode).toBe(404);
  });

  it("hides restricted categories and their articles and does not count them", async () => {
    const kb = await knowledgeBase("public");
    const open = await folder(kb.id, "Offen");
    const closed = await folder(kb.id, "Geschlossen");
    await article(kb.id, open, "Sichtbar", "Für alle.");
    const hiddenEntry = await article(kb.id, closed, "Versteckt", "Nur für wenige.");
    const restricted = await owner.post(`/api/v1/pages/${closed}/access`, {
      changes: [{ action: "restrict", kind: "view" }],
    });
    expect(restricted.statusCode, restricted.body).toBe(200);
    await index();
    const visitor = anonymous();
    const start = await visitor.get(`${kb.path}/`);
    expect(start.body).toContain(">Offen<");
    expect(start.body).not.toContain("Geschlossen");
    const hidden = await visitor.get(`${kb.path}/${hiddenEntry.number}-versteckt`);
    expect(hidden.statusCode).toBe(404);
    expect((await visitor.get(`${kb.path}/topics/${closed}`)).statusCode).toBe(404);
    const search = await visitor.get(`${kb.path}/search?q=wenige`);
    expect(search.body).not.toContain("Versteckt");
  });

  it("shows when an article was last reviewed while reviews apply, and otherwise when it changed", async () => {
    const kb = await knowledgeBase("public");
    const reviewed = await article(kb.id, null, "Drucker einrichten", "Drucker im dritten Stock.");
    const unreviewed = await article(kb.id, null, "Drucker tauschen", "Toner wechseln.");
    const settings = `/api/v1/spaces/${kb.id}/knowledge-base/reviews`;
    expect((await owner.put(settings, { intervalMonths: 6 })).statusCode).toBe(200);
    expect((await owner.post(`/api/v1/articles/${reviewed.id}/reviews`, {})).statusCode).toBe(201);
    await index();
    const t = messagesFor((await services().portals.config(kb.id))?.language ?? "en");
    const reviewedLabel = t.reviewedOnLong("").trim();
    const updatedLabel = t.updatedOnLong("").trim();
    const reader = anonymous();
    const page = await reader.get(`${kb.path}/${reviewed.number}-drucker-einrichten`);
    expect(page.body).toContain(reviewedLabel);
    expect(page.body).not.toContain(updatedLabel);
    const other = await reader.get(`${kb.path}/${unreviewed.number}-drucker-tauschen`);
    expect(other.body).toContain(updatedLabel);
    expect(other.body).not.toContain(reviewedLabel);
    const found = await reader.get(`${kb.path}/search?q=Drucker`);
    expect(found.body).toContain(reviewedLabel);
    expect(found.body).toContain(updatedLabel);
    expect((await owner.put(settings, { intervalMonths: null })).statusCode).toBe(200);
    const off = await reader.get(`${kb.path}/${reviewed.number}-drucker-einrichten`);
    expect(off.body).toContain(updatedLabel);
    expect(off.body).not.toContain(reviewedLabel);
  });

  it("serves only the published version", async () => {
    const kb = await knowledgeBase("public");
    const entry = await article(kb.id, null, "Version", "Veröffentlichter Text.");
    await owner.put(`/api/v1/pages/${entry.id}/content`, {
      document: { type: "doc", content: [paragraph("Entwurf, noch geheim.")] },
    });
    const unpublished = await article(kb.id, null, "Nie veröffentlicht", "Gar nicht.", { publish: false });
    await index();
    const page = await owner.get(`${kb.path}/${entry.number}-version`);
    expect(page.body).toContain("Veröffentlichter Text.");
    expect(page.body).not.toContain("Entwurf, noch geheim.");
    expect((await owner.get(`${kb.path}/${unpublished.number}-nie-veroeffentlicht`)).statusCode).toBe(404);
  });

  it("redirects old slugs, bare numbers and old paths permanently, and answers unknown addresses as not found", async () => {
    const kb = await knowledgeBase("public");
    const entry = await article(kb.id, null, "Alter Titel", "Text.");
    await owner.patch(`/api/v1/items/${entry.id}`, { title: "Neuer Titel" });
    await owner.post(`/api/v1/pages/${entry.id}/publish`, {});
    await index();
    const visitor = anonymous();
    const old = await visitor.get(`${kb.path}/${entry.number}-alter-titel`);
    expect(old.statusCode).toBe(301);
    expect(old.headers.location).toBe(`${kb.path}/${entry.number}-neuer-titel`);
    const bare = await visitor.get(`${kb.path}/${entry.number}`);
    expect(bare.statusCode).toBe(301);
    expect((await visitor.get(`${kb.path}/${entry.number}-erfunden`)).statusCode).toBe(404);
    const moved = await owner.put(`/api/v1/spaces/${kb.id}/knowledge-base/portal/address`, {
      path: `neu-${counter}`,
      domain: null,
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const redirected = await visitor.get(`${kb.path}/${entry.number}-neuer-titel`);
    expect(redirected.statusCode).toBe(301);
    expect(redirected.headers.location).toBe(`/help/neu-${counter}/${entry.number}-neuer-titel`);
    expect((await visitor.get("/help/does-not-exist/")).statusCode).toBe(404);
  });

  it("shows the edit link only to editors and links back to the app editor", async () => {
    const kb = await knowledgeBase("signedIn");
    const entry = await article(kb.id, null, "Bearbeitbar", "Text.");
    await index();
    const page = await owner.get(`${kb.path}/${entry.number}-bearbeitbar`);
    expect(page.body).toContain(`/pages/${entry.id}?edit=true`);
    const reader = await person();
    const readerPage = await reader.client.get(`${kb.path}/${entry.number}-bearbeitbar`);
    expect(readerPage.body).not.toContain("?edit=true");
  });

  it("composes the contact mail with the inherited address and offers the areas on searches without results", async () => {
    const kb = await knowledgeBase("public");
    await owner.put(`/api/v1/spaces/${kb.id}/knowledge-base/contact`, { contactEmail: "help@example.org" });
    const it = await folder(kb.id, "IT");
    await owner.put(`/api/v1/categories/${it}/contact`, { contactEmail: "it@example.org" });
    const network = await folder(kb.id, "Netzwerk", it);
    const people = await folder(kb.id, "Personal");
    await article(kb.id, people, "Urlaub", "Urlaub beantragen.");
    const entry = await article(kb.id, network, "WLAN", "WLAN verbinden.");
    await index();
    const page = await anonymous().get(`${kb.path}/${entry.number}-wlan`);
    const subject = encodeURIComponent("Help article: WLAN");
    expect(page.body).toContain(`mailto:it@example.org?subject=${subject}`);
    expect(page.body).toContain(encodeURIComponent(`${TEST_ORIGIN}${kb.path}/${entry.number}-wlan`));
    const none = await anonymous().get(`${kb.path}/search?q=parkausweis`);
    expect(none.body).toContain("mailto:it@example.org?subject=");
    expect(none.body).toContain("mailto:help@example.org?subject=");
    expect(none.body).toContain(encodeURIComponent("Question from the help search: parkausweis"));
  });

  it("records searches, views and ratings without any personal reference", async () => {
    const kb = await knowledgeBase("public");
    const entry = await article(kb.id, null, "Statistik", "Zählbar.");
    await index();
    const reader = await person();
    await reader.client.get(`${kb.path}/search?q=  Zählbar `);
    await reader.client.get(`${kb.path}/search?q=gibtesnicht`);
    await reader.client.get(`${kb.path}/${entry.number}-statistik`);
    const rated = await reader.client.post(`${kb.path}/feedback`, { itemId: entry.id, helpful: false });
    expect(rated.statusCode, rated.body).toBe(204);
    const noted = await reader.client.post(`${kb.path}/feedback`, {
      itemId: entry.id,
      text: "Schritt fehlt",
    });
    expect(noted.statusCode).toBe(204);
    const searches = await test.runtime.pool.query<Record<string, unknown>>(
      "select * from portal_searches where space_id = $1 order by term",
      [kb.id],
    );
    expect(searches.rows.map((row) => [row.term, row.results, row.zero_results])).toEqual([
      ["gibtesnicht", 0, true],
      ["zählbar", 1, false],
    ]);
    const tables = ["portal_searches", "portal_article_views", "portal_ratings", "portal_feedback"];
    for (const table of tables) {
      const columns = await test.runtime.pool.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_name = $1",
        [table],
      );
      expect(columns.rows.map((row) => row.column_name).sort()).not.toEqual(
        expect.arrayContaining(["account_id"]),
      );
      const rows = await test.runtime.pool.query<Record<string, unknown>>(
        `select * from ${table} where space_id = $1`,
        [kb.id],
      );
      const text = JSON.stringify(rows.rows);
      expect(text).not.toContain(reader.id);
      expect(text).not.toContain("198.51.100.10");
    }
    const feedback = await services().portalStatistics.feedback(kb.id);
    expect(feedback.map((entry) => entry.text)).toEqual(["Schritt fehlt"]);
  });

  it("shows a frequent search only to readers who find something with it", async () => {
    const kb = await knowledgeBase("public");
    await article(kb.id, null, "Offen", "Allgemeiner Text.");
    const secret = await article(kb.id, null, "Vertraulich", "Kündigungsfrist im Vertrag.");
    const restricted = await owner.post(`/api/v1/pages/${secret.id}/access`, {
      changes: [{ action: "restrict", kind: "view" }],
    });
    expect(restricted.statusCode, restricted.body).toBe(200);
    await index();
    for (let index = 0; index < 3; index += 1) await owner.get(`${kb.path}/search?q=K%C3%BCndigungsfrist`);
    const visitorStart = await anonymous().get(`${kb.path}/`);
    expect(visitorStart.body).not.toContain("kündigungsfrist");
    const ownerStart = await owner.get(`${kb.path}/`);
    expect(ownerStart.body).toContain("kündigungsfrist");
  });

  it("refuses portal posts from another origin", async () => {
    const kb = await knowledgeBase("public");
    const entry = await article(kb.id, null, "Fremd", "Text.");
    const foreign = new TestClient(test.app, { origin: "https://evil.example" });
    const response = await foreign.post(`${kb.path}/feedback`, { itemId: entry.id, helpful: true });
    expect(response.statusCode).toBe(403);
  });

  it("hands the session over to an own domain, scopes its cookie and signs out everywhere", async () => {
    const kb = await knowledgeBase("signedIn");
    const domain = `help${counter}.example.org`;
    const allowed = await owner.post("/api/v1/instance/portal-domains", { domain, organizationId });
    expect(allowed.statusCode, allowed.body).toBe(201);
    const set = await owner.put(`/api/v1/spaces/${kb.id}/knowledge-base/portal/address`, {
      path: kb.path.slice("/help/".length),
      domain,
    });
    expect(set.statusCode, set.body).toBe(200);
    const entry = await article(kb.id, null, "Domain", "Auf der eigenen Domain.");
    await index();
    const member = await person();
    const browser = new TestClient(test.app, { origin: `https://${domain}` });
    const onDomain = (url: string) => browser.get(url, { host: domain });
    const first = await onDomain(`/${entry.number}-domain`);
    expect(first.statusCode).toBe(303);
    expect(first.headers.location).toBe(`/sign-in?return=${encodeURIComponent(`/${entry.number}-domain`)}`);
    const start = await onDomain(first.headers.location as string);
    expect(start.statusCode).toBe(303);
    const flowCookie = String(start.headers["set-cookie"]);
    expect(flowCookie).toContain("__Host-pagehall-portal-flow=");
    expect(flowCookie).not.toMatch(/Domain=/i);
    const authorize = new URL(start.headers.location as string);
    expect(authorize.origin).toBe(TEST_ORIGIN);
    for (const [name, value] of member.client.cookies) browser.cookies.set(name, value);
    const handed = await browser.get(`${authorize.pathname}${authorize.search}`);
    expect(handed.statusCode, handed.body).toBe(303);
    const callback = new URL(handed.headers.location as string);
    expect(callback.host).toBe(domain);
    const finished = await onDomain(`${callback.pathname}${callback.search}`);
    expect(finished.statusCode).toBe(303);
    const portalCookie = String(finished.headers["set-cookie"]);
    expect(portalCookie).toContain("__Host-pagehall-portal=");
    expect(portalCookie).toContain("Secure");
    expect(portalCookie).toContain("SameSite=Lax");
    expect(portalCookie).not.toMatch(/Domain=/i);
    const replay = await onDomain(`${callback.pathname}${callback.search}`);
    expect(replay.statusCode).toBe(200);
    expect(replay.body).not.toContain("Auf der eigenen Domain.");
    const read = await onDomain(`/${entry.number}-domain`);
    expect(read.statusCode).toBe(200);
    expect(read.body).toContain("Auf der eigenen Domain.");
    const api = await test.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { host: domain },
    });
    expect(api.statusCode).not.toBe(200);
    expect(String(api.headers["content-type"] ?? "")).not.toContain("json");
    const foreign = await browser.post("/sign-out", undefined, { host: domain, origin: TEST_ORIGIN });
    expect(foreign.statusCode).toBe(403);
    const signedOut = await browser.post("/sign-out", undefined, { host: domain });
    expect(signedOut.statusCode).toBe(303);
    expect((await member.client.get("/api/v1/auth/session")).statusCode).toBe(401);
  });
});
