import {
  accountAttemptLimitSetting,
  clientAttemptLimitSetting,
  messagesFor,
  PORTAL_ASSETS,
  SYSTEM,
} from "@lunedo/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    const account = await createAccount(test, `portal${counter}@lunedo.test`);
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

  async function restrictCategory(spaceId: string, itemId: string) {
    const group = await owner.post(`/api/v1/organizations/${organizationId}/groups`, {
      name: `Readers ${itemId.slice(-8)}`,
    });
    const groupId = (group.json() as { id: string }).id;
    const session = (await owner.get("/api/v1/auth/session")).json() as { account: { id: string } };
    await owner.post(`/api/v1/groups/${groupId}/members`, { accountId: session.account.id });
    const restricted = await owner.put(
      `/api/v1/spaces/${spaceId}/knowledge-base/categories/${itemId}/access`,
      {
        responsibleGroupIds: [],
        visibleGroupIds: [groupId],
      },
    );
    expect(restricted.statusCode, restricted.body).toBe(200);
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
    return { id, number: await numberOf(id) };
  }

  async function numberOf(itemId: string): Promise<number> {
    const found = await test.runtime.pool.query<{ number: string }>(
      "select number from tree_items where id = $1",
      [itemId],
    );
    return Number(found.rows[0]?.number);
  }

  async function topic(itemId: string, slug: string): Promise<string> {
    return `/topics/${await numberOf(itemId)}-${slug}`;
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
    const category = await reader.get(`${kb.path}${await topic(it, "it")}`);
    expect(category.statusCode).toBe(200);
    expect(category.body).toContain("VPN einrichten");
  });

  it("gives every folder of any depth its own page with breadcrumb, introduction, contact and counts", async () => {
    const kb = await knowledgeBase("public");
    await owner.put(`/api/v1/spaces/${kb.id}/knowledge-base/contact`, { contactEmail: "help@example.org" });
    const it = await folder(kb.id, "IT");
    const microsoft = await folder(kb.id, "Microsoft", it);
    const outlook = await folder(kb.id, "Outlook", microsoft);
    const web = await folder(kb.id, "Web App", outlook);
    await owner.put(`/api/v1/categories/${microsoft}/contact`, { contactEmail: "m365@example.org" });
    const icon = await owner.put(`/api/v1/categories/${web}`, { icon: "globe" });
    expect(icon.statusCode, icon.body).toBe(204);
    const intro = await owner.patch(`/api/v1/items/${web}`, {
      description:
        "Outlook **im Browser**, siehe [Anleitung](https://example.org/owa).\n\n> Nie <script> speichern",
    });
    expect(intro.statusCode, intro.body).toBe(200);
    const signIn = await article(kb.id, web, "Wie melde ich mich an", "Im Browser anmelden.");
    await article(kb.id, outlook, "Welche Version habe ich", "Version ansehen.");
    await index();
    const reader = anonymous();
    const page = await reader.get(`${kb.path}${await topic(web, "web-app")}`);
    expect(page.statusCode, page.body).toBe(200);
    for (const [id, slug] of [
      [it, "it"],
      [microsoft, "microsoft"],
      [outlook, "outlook"],
    ] as const) {
      expect(page.body).toContain(`${kb.path}${await topic(id, slug)}"`);
    }
    expect(page.body).toContain("Outlook <strong>im Browser</strong>, siehe ");
    expect(page.body).toContain('<a href="https://example.org/owa">Anleitung</a>');
    expect(page.body).toContain('<div class="callout">Nie &lt;script&gt; speichern</div>');
    expect(page.body).toContain("m365@example.org");
    expect(page.body).toContain("Wie melde ich mich an");
    const entry = await reader.get(`${kb.path}/${signIn.number}-wie-melde-ich-mich-an`);
    expect(entry.body).toContain("mailto:m365@example.org?subject=");
    expect(entry.body).toContain(`${kb.path}${await topic(web, "web-app")}"`);
    const categories = await owner.get(`/api/v1/spaces/${kb.id}/categories`);
    expect(
      (
        categories.json() as {
          title: string;
          level: number;
          articles: number;
          effectiveContactEmail: string;
        }[]
      ).map((entry) => [entry.title, entry.level, entry.articles, entry.effectiveContactEmail]),
    ).toEqual([
      ["IT", 1, 2, "help@example.org"],
      ["Microsoft", 2, 2, "m365@example.org"],
      ["Outlook", 3, 2, "m365@example.org"],
      ["Web App", 4, 1, "m365@example.org"],
    ]);
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
    expect(page.body).not.toContain("Provided with Lunedo");
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
      expect(response.body).toContain('class="dlg" role="dialog" aria-modal="true"');
      expect(response.body).toContain('<header class="ph">');
      expect(response.body).not.toContain("Drucken im Büro.");
      expect(response.body).not.toContain('class="dd areas"');
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
    const startPage = await outsider.client.get(`${kb.path}/`);
    const unknownPortal = await outsider.client.get(`/help/unknown-${counter}x/`);
    expect(startPage.statusCode).toBe(404);
    expect(startPage.body).toBe(unknownPortal.body);
    expect((await member.client.get(`${kb.path}/`)).statusCode).toBe(200);
  });

  it("lists only free domains and the own domain to a knowledge base", async () => {
    const first = await knowledgeBase("signedIn");
    const second = await knowledgeBase("signedIn");
    const used = `used${counter}.example.org`;
    const free = `free${counter}.example.org`;
    for (const domain of [used, free]) {
      expect(
        (await owner.post("/api/v1/instance/portal-domains", { domain, organizationId })).statusCode,
      ).toBe(201);
    }
    const set = await owner.put(`/api/v1/spaces/${first.id}/knowledge-base/portal/address`, {
      path: first.path.slice("/help/".length),
      domain: used,
    });
    expect(set.statusCode, set.body).toBe(200);
    const listed = (await owner.get(`/api/v1/spaces/${second.id}/knowledge-base/portal/domains`)).json() as {
      domain: string;
      spaceName: string | null;
    }[];
    expect(listed.map((entry) => entry.domain)).toContain(free);
    expect(listed.map((entry) => entry.domain)).not.toContain(used);
    const own = (await owner.get(`/api/v1/spaces/${first.id}/knowledge-base/portal/domains`)).json() as {
      domain: string;
    }[];
    expect(own.map((entry) => entry.domain)).toContain(used);
  });

  it("lets portal accounts read a knowledge base for portal accounts but never internal spaces", async () => {
    const reader = await person({ portal: true });
    const kb = await knowledgeBase("portal");
    await test.runtime.pool.query("insert into portal_readers (space_id, account_id) values ($1, $2)", [
      kb.id,
      reader.id,
    ]);
    const entry = await article(kb.id, null, "Kundenhilfe", "Für Kunden.");
    const internal = await knowledgeBase("signedIn");
    const secret = await article(internal.id, null, "Intern", "Nur intern.");
    await index();
    const read = await reader.client.get(`${kb.path}/${entry.number}-kundenhilfe`);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.body).toContain("Für Kunden.");
    expect(read.body).not.toContain(">Zum Wiki<");
    expect(read.body).not.toContain(">Go to the wiki<");
    expect(read.body).toMatch(
      new RegExp(`<a href="${TEST_ORIGIN}/"><svg[^>]*>.*?</svg>Account settings</a>`),
    );
    const blocked = await reader.client.get(`${internal.path}/${secret.number}-intern`);
    expect(blocked.statusCode).toBe(404);
    const standard = await person();
    expect((await standard.client.get(`${kb.path}/${entry.number}-kundenhilfe`)).statusCode).toBe(404);
    const other = await knowledgeBase("public");
    const empty = await reader.client.get(`${other.path}/`);
    expect(empty.statusCode).toBe(200);
    const t = messagesFor((await services().portals.config(other.id))?.defaultLanguage ?? "en");
    expect(empty.body).toContain(t.emptyTextSignedIn);
    expect(empty.body).not.toContain(t.emptyText);
  });

  it("hides restricted categories and their articles and does not count them", async () => {
    const kb = await knowledgeBase("public");
    const open = await folder(kb.id, "Offen");
    const closed = await folder(kb.id, "Geschlossen");
    await article(kb.id, open, "Sichtbar", "Für alle.");
    const hiddenEntry = await article(kb.id, closed, "Versteckt", "Nur für wenige.");
    await restrictCategory(kb.id, closed);
    await index();
    const visitor = anonymous();
    const start = await visitor.get(`${kb.path}/`);
    expect(start.body).toContain(">Offen<");
    expect(start.body).not.toContain("Geschlossen");
    const hidden = await visitor.get(`${kb.path}/${hiddenEntry.number}-versteckt`);
    expect(hidden.statusCode).toBe(404);
    const closedNumber = String(await numberOf(closed));
    const unknown = await visitor.get(`${kb.path}/topics/999999999999-geschlossen`);
    const restrictedPage = await visitor.get(`${kb.path}/topics/${closedNumber}-geschlossen`);
    expect(restrictedPage.statusCode).toBe(404);
    expect(restrictedPage.body).toContain(messagesFor("en").signInRestrictedHeading);
    expect(restrictedPage.body).not.toContain("Geschlossen");
    expect(comparable(restrictedPage.body).replaceAll(closedNumber, "ID")).toBe(
      comparable(unknown.body).replaceAll("999999999999", "ID"),
    );
    const search = await visitor.get(`${kb.path}/search?q=wenige`);
    expect(search.body).not.toContain("Versteckt");
    const quick = await visitor.get(`${kb.path}/search/quick?q=Geschlossen`);
    expect(quick.json()).toMatchObject({ topics: [], articles: [] });
    const editor = await owner.get(`${kb.path}${await topic(open, "offen")}`);
    expect(editor.body).not.toContain('class="lock"');
    const locked = await owner.get(`${kb.path}${await topic(closed, "geschlossen")}`);
    expect(locked.statusCode).toBe(200);
    expect(locked.body).toMatch(/aria-current="page"><span class="cicon s32"[\s\S]*?Geschlossen/);
    const signedIn = await (await person()).client.get(`${kb.path}${await topic(closed, "geschlossen")}`);
    expect(signedIn.statusCode).toBe(404);
    expect(signedIn.body).toContain("find this page");
    expect(signedIn.body).not.toContain(messagesFor("en").signInRestrictedHeading);
  });

  it("lists the articles of a folder, with those of its subtopics on request, and searches in a window", async () => {
    const kb = await knowledgeBase("public");
    const it = await folder(kb.id, "IT");
    const microsoft = await folder(kb.id, "Microsoft", it);
    const outlook = await folder(kb.id, "Outlook", microsoft);
    const web = await folder(kb.id, "Web App", outlook);
    const restricted = await folder(kb.id, "Outlook intern", microsoft);
    await article(kb.id, web, "Outlook im Browser anmelden", "Mit dem Browser anmelden.", { type: "howTo" });
    await article(kb.id, outlook, "Outlook startet nicht", "Neu starten hilft.", { type: "troubleshooting" });
    await article(kb.id, restricted, "Outlook Geheimnis", "Nur intern.");
    await restrictCategory(kb.id, restricted);
    await index();
    const reader = anonymous();
    const t = messagesFor("en");
    const direct = await reader.get(`${kb.path}${await topic(microsoft, "microsoft")}`);
    expect(direct.statusCode).toBe(200);
    expect(direct.body).toContain(t.noDirectArticles);
    expect(direct.body).toContain(t.topicsIn("Microsoft"));
    expect(direct.body).toContain('aria-pressed="false" role="button"');
    expect(direct.body).not.toContain("Outlook intern");
    const deep = await reader.get(`${kb.path}${await topic(microsoft, "microsoft")}?deep=1`);
    expect(deep.body).toContain("Outlook im Browser anmelden");
    expect(deep.body).toContain("Outlook startet nicht");
    expect(deep.body).toContain('<span class="path">Outlook › Web App</span>');
    expect(deep.body).not.toContain("Outlook Geheimnis");
    const outlookPage = await reader.get(`${kb.path}${await topic(outlook, "outlook")}`);
    expect(outlookPage.body).toContain("Outlook startet nicht");
    expect(outlookPage.body).not.toContain("Outlook im Browser anmelden");
    expect(outlookPage.body).toMatch(/<nav class="ptree" id="ptree" aria-label="Topics in IT">/);
    const quick = await reader.get(`${kb.path}/search/quick?q=Outlook`);
    expect(quick.statusCode).toBe(200);
    expect(quick.headers["content-type"]).toContain("application/json");
    const found = quick.json() as {
      topics: { title: string; path: string; count: number; href: string }[];
      articles: { title: string; path: string; href: string }[];
      total: number;
      all: string;
    };
    expect(found.topics).toEqual([
      {
        title: "Outlook",
        path: "IT › Microsoft",
        count: 2,
        href: `${kb.path}${await topic(outlook, "outlook")}`,
      },
    ]);
    expect(found.articles.map((entry) => [entry.title, entry.path]).sort()).toEqual([
      ["Outlook im Browser anmelden", "IT › … › Outlook › Web App"],
      ["Outlook startet nicht", "IT › Microsoft › Outlook"],
    ]);
    expect(found.all).toBe(`${kb.path}/search?q=Outlook`);
    const nothing = await reader.get(`${kb.path}/search/quick?q=`);
    expect(nothing.json()).toMatchObject({ topics: [], articles: [], total: 0 });
    const theme = await reader.get(`/help/_assets/${PORTAL_ASSETS.theme}`);
    expect(theme.statusCode).toBe(200);
    expect(theme.body).toContain("lunedo.portal.theme");
    const home = await reader.get(kb.path);
    expect(home.body).toContain(
      '<link rel="icon" href="/help/_assets/favicon.ico" sizes="48x48"><link rel="icon" href="/help/_assets/favicon.svg" type="image/svg+xml">',
    );
    const icon = await reader.get("/help/_assets/favicon.svg");
    expect(icon.statusCode).toBe(200);
    expect(icon.headers["content-type"]).toContain("image/svg+xml");
    expect(icon.body).toContain("prefers-color-scheme:dark");
    const fallback = await reader.get("/help/_assets/favicon.ico");
    expect(fallback.statusCode).toBe(200);
    expect(fallback.headers["content-type"]).toContain("image/x-icon");
    expect(fallback.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
  });

  it("shows when an article was last reviewed while reviews apply, and otherwise when it changed", async () => {
    const kb = await knowledgeBase("public");
    const reviewed = await article(kb.id, null, "Drucker einrichten", "Drucker im dritten Stock.");
    const unreviewed = await article(kb.id, null, "Drucker tauschen", "Toner wechseln.");
    const settings = `/api/v1/spaces/${kb.id}/knowledge-base/reviews`;
    expect((await owner.put(settings, { intervalMonths: 6 })).statusCode).toBe(200);
    expect((await owner.post(`/api/v1/articles/${reviewed.id}/reviews`, {})).statusCode).toBe(201);
    await index();
    const t = messagesFor((await services().portals.config(kb.id))?.defaultLanguage ?? "en");
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
    const invented = await visitor.get(`${kb.path}/${entry.number}-erfunden`);
    expect(invented.statusCode).toBe(301);
    expect(invented.headers.location).toBe(`${kb.path}/${entry.number}-neuer-titel`);
    expect((await visitor.get(`${kb.path}/${entry.number + 100_000}-erfunden`)).statusCode).toBe(404);
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

  it("redirects a category address with an outdated or missing slug to the current one", async () => {
    const kb = await knowledgeBase("public");
    const it = await folder(kb.id, "IT");
    await article(kb.id, it, "Drucker", "Text.");
    await index();
    const visitor = anonymous();
    const number = await numberOf(it);
    expect((await visitor.get(`${kb.path}/topics/${number}-it`)).statusCode).toBe(200);
    for (const path of [`/topics/${number}`, `/topics/${number}-informatik`]) {
      const moved = await visitor.get(`${kb.path}${path}?deep=1`);
      expect(moved.statusCode, path).toBe(301);
      expect(moved.headers.location).toBe(`${kb.path}/topics/${number}-it?deep=1`);
    }
    expect((await owner.patch(`/api/v1/items/${it}`, { title: "IT und Geräte" })).statusCode).toBe(200);
    const renamed = await visitor.get(`${kb.path}/topics/${number}-it`);
    expect(renamed.statusCode).toBe(301);
    expect(renamed.headers.location).toBe(`${kb.path}/topics/${number}-it-und-geraete`);
    expect((await visitor.get(`${kb.path}/topics/${number}-it-und-geraete`)).statusCode).toBe(200);
  });

  it("answers unknown numbers, internal items and hidden articles with the same not-found page", async () => {
    const kb = await knowledgeBase("public");
    const category = await folder(kb.id, "Intern");
    const restricted = await article(kb.id, null, "Geheim", "Text.");
    const access = await owner.post(`/api/v1/pages/${restricted.id}/access`, {
      changes: [{ action: "restrict", kind: "view" }],
    });
    expect(access.statusCode, access.body).toBe(200);
    const unpublished = await article(kb.id, null, "Entwurf", "Text.", { publish: false });
    const other = await knowledgeBase("signedIn");
    const foreign = await article(other.id, null, "Fremd", "Text.");
    counter += 1;
    const internal = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Internal ${counter}`,
      key: `IN${counter}X`,
      visibility: "private",
      grants: [],
    });
    expect(internal.statusCode, internal.body).toBe(201);
    const page = await owner.post(`/api/v1/spaces/${internal.json().id as string}/items`, {
      kind: "page",
      title: "Gehaltsliste",
      parentId: null,
    });
    expect(page.statusCode, page.body).toBe(201);
    await index();
    const visitor = anonymous();
    const answer = async (client: TestClient, number: number, slug: string) => {
      const response = await client.get(`${kb.path}/${number}-${slug}`);
      expect(response.statusCode, `${number}-${slug}`).toBe(404);
      return comparable(response.body).replaceAll(String(number), "N");
    };
    const unknown = 999_999_999_999;
    for (const [number, slug] of [
      [await numberOf(category), "intern"],
      [restricted.number, "geheim"],
      [unpublished.number, "entwurf"],
      [foreign.number, "fremd"],
      [await numberOf(page.json().id as string), "gehaltsliste"],
    ] as const) {
      expect(await answer(visitor, number, slug), slug).toBe(await answer(visitor, unknown, slug));
    }
    expect(await answer(owner, await numberOf(page.json().id as string), "gehaltsliste")).toBe(
      await answer(owner, unknown, "gehaltsliste"),
    );
    const elsewhere = await owner.get(`${kb.path}/${foreign.number}-fremd`);
    expect(elsewhere.statusCode).toBe(301);
    expect(elsewhere.headers.location).toBe(`${TEST_ORIGIN}${other.path}/${foreign.number}-fremd`);
    const wrongElsewhere = await owner.get(`${kb.path}/${foreign.number}-erfunden`);
    expect(wrongElsewhere.statusCode).toBe(301);
    expect(wrongElsewhere.headers.location).toBe(`${TEST_ORIGIN}${other.path}/${foreign.number}-fremd`);
  });

  it("shows the edit link only to editors and links back to the app editor", async () => {
    const kb = await knowledgeBase("signedIn");
    const entry = await article(kb.id, null, "Bearbeitbar", "Text.");
    await index();
    const page = await owner.get(`${kb.path}/${entry.number}-bearbeitbar`);
    const key = (
      await test.runtime.pool.query<{ key: string }>("select key from spaces where id = $1", [kb.id])
    ).rows[0]?.key;
    expect(page.body).toContain(
      `href="${TEST_ORIGIN}/spaces/${key}/pages/${entry.number}/bearbeitbar?edit=true"`,
    );
    expect(page.body).not.toContain("Account settings");
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
    const t = messagesFor("en");
    const contact = await anonymous().get(`${kb.path}/contact`);
    expect(contact.body).toContain(`<h2 id="area-heading">${t.contactAreaHeading}</h2>`);
    expect(contact.body).not.toContain(t.areaHeading);
    expect(contact.body).not.toContain(t.areaText);
    const asked = await anonymous().get(`${kb.path}/contact?q=parkausweis`);
    expect(asked.body).toContain(`<h2 id="area-heading">${t.areaHeading}</h2>`);
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

  it("writes dates in the format of the organization and lays out the start page without gaps", async () => {
    const kb = await knowledgeBase("public");
    const area = await folder(kb.id, "Ein Bereich mit einem sehr langen Namen, der umbrechen darf");
    await article(kb.id, area, "Drucker einrichten", "Drucker im dritten Stock.", { type: "howTo" });
    await index();
    await owner.put(`/api/v1/organizations/${organizationId}/settings/locale.dateFormat`, {
      value: "YYYY-MM-DD",
    });
    const start = (await anonymous().get(`${kb.path}/`)).body;
    const today = new Date().toISOString().slice(0, 10);
    expect(start).toContain(today);
    expect(start).not.toContain(`class="sec cols2"`);
    expect(start).toContain(`<b class="clamp2"`);
    expect(start).toContain(`<span class="m"><span class="mi"><span>`);
    expect(start).not.toContain(`<span class="dot"></span>`);
    await owner.put(`/api/v1/organizations/${organizationId}/settings/locale.dateFormat`, { clear: true });
  });

  it("counts a search from the quick window when the reader opens a result, so that it can become frequent", async () => {
    const kb = await knowledgeBase("public");
    await article(kb.id, null, "Drucker", "Toner im Drucker wechseln.");
    await index();
    const reader = anonymous();
    for (let index = 0; index < 3; index += 1) {
      await reader.get(`${kb.path}/search/quick?q=toner`);
      const counted = await reader.post(`${kb.path}/search/quick/count`, { q: " Toner " });
      expect(counted.statusCode, counted.body).toBe(204);
    }
    const searches = await test.runtime.pool.query<{ term: string; results: number }>(
      "select term, results from portal_searches where space_id = $1",
      [kb.id],
    );
    expect(searches.rows).toEqual([
      { term: "toner", results: 1 },
      { term: "toner", results: 1 },
      { term: "toner", results: 1 },
    ]);
    expect((await reader.get(`${kb.path}/`)).body).toContain(">toner</a>");
    expect((await reader.post(`${kb.path}/search/quick/count`, { q: "  " })).statusCode).toBe(400);
    const foreign = new TestClient(test.app, { origin: "https://evil.example" });
    expect((await foreign.post(`${kb.path}/search/quick/count`, { q: "toner" })).statusCode).toBe(403);
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

  it("answers health checks on any host without asking for portal domains", async () => {
    const lookup = vi
      .spyOn(services().portals, "isPortalDomain")
      .mockRejectedValue(new Error("database down"));
    try {
      const probe = new TestClient(test.app);
      const live = await probe.get("/health/live", { host: "10.0.0.7" });
      expect(live.statusCode).toBe(200);
      expect(lookup).not.toHaveBeenCalled();
      const foreign = await probe.get("/help/", { host: "unknown.example.org" });
      expect(foreign.statusCode).toBe(503);
      expect(foreign.headers["retry-after"]).toBe("30");
      expect(foreign.body).toContain("Try again in a minute");
    } finally {
      lookup.mockRestore();
    }
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
    expect(flowCookie).toContain("__Host-lunedo-portal-flow=");
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
    expect(portalCookie).toContain("__Host-lunedo-portal=");
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
  it("asks people of other organizations once before handing their session to an own domain", async () => {
    const kb = await knowledgeBase("signedIn");
    const domain = `consent${counter}.example.org`;
    expect((await owner.post("/api/v1/instance/portal-domains", { domain, organizationId })).statusCode).toBe(
      201,
    );
    const set = await owner.put(`/api/v1/spaces/${kb.id}/knowledge-base/portal/address`, {
      path: kb.path.slice("/help/".length),
      domain,
    });
    expect(set.statusCode, set.body).toBe(200);
    const elsewhere = await services().organizations.createAsActor(SYSTEM, {
      name: `Elsewhere ${counter}`,
      ownerAccountId: (await createAccount(test, `elsewhere-owner${counter}@lunedo.test`)).id,
    });
    const visitorAccount = await createAccount(
      test,
      `elsewhere${counter}@lunedo.test`,
      "a long enough passphrase",
      elsewhere.id,
    );
    const visitor = await signedInClient(test, visitorAccount.email, visitorAccount.password);
    const handoff = async () => {
      const browser = new TestClient(test.app, { origin: `https://${domain}` });
      const started = await browser.get("/sign-in?return=%2F", { host: domain });
      expect(started.statusCode).toBe(303);
      const authorize = new URL(started.headers.location as string);
      for (const [name, value] of visitor.cookies) browser.cookies.set(name, value);
      return { browser, authorize, response: await browser.get(`${authorize.pathname}${authorize.search}`) };
    };
    const first = await handoff();
    expect(first.response.statusCode).toBe(200);
    expect(first.response.body).toContain(`Sign in to ${domain} with your account?`);
    expect(first.response.body).not.toContain("_portal/callback");
    const form = new URLSearchParams({
      domain,
      state: first.authorize.searchParams.get("state") ?? "",
      return: "/",
    }).toString();
    const formHeaders = { "content-type": "application/x-www-form-urlencoded" };
    const crossSite = await first.browser.post(`${first.authorize.pathname}`, form, {
      ...formHeaders,
      origin: `https://${domain}`,
    });
    expect(crossSite.statusCode).toBe(403);
    const confirmed = await first.browser.post(`${first.authorize.pathname}`, form, {
      ...formHeaders,
      origin: TEST_ORIGIN,
    });
    expect(confirmed.statusCode).toBe(303);
    expect(new URL(confirmed.headers.location as string).host).toBe(domain);
    const audit = await test.runtime.pool.query<{ fields: Record<string, unknown> }>(
      "select fields from audit_events where name = 'portalHandoff.consented' and target_id = $1",
      [visitorAccount.id],
    );
    expect(audit.rows.map((row) => row.fields)).toEqual([
      expect.objectContaining({ domain, spaceId: kb.id }),
    ]);
    const second = await handoff();
    expect(second.response.statusCode).toBe(303);
    const member = await person();
    const browser = new TestClient(test.app, { origin: `https://${domain}` });
    const started = await browser.get("/sign-in?return=%2F", { host: domain });
    const authorize = new URL(started.headers.location as string);
    for (const [name, value] of member.client.cookies) browser.cookies.set(name, value);
    expect((await browser.get(`${authorize.pathname}${authorize.search}`)).statusCode).toBe(303);
  });

  it("shows nothing about languages while only one language is enabled", async () => {
    const kb = await knowledgeBase("public");
    const single = await article(kb.id, null, "Drucker", "Drucker im Flur.");
    await index();
    const page = await anonymous().get(`${kb.path}/${single.number}-drucker`);
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain('class="dd lang"');
    expect(page.body).not.toContain("hreflang");
    expect((await anonymous().get(`${kb.path}/en/`)).statusCode).toBe(404);
  });

  it("serves translations under the language prefix, with a switch, hreflang links and a fallback note", async () => {
    const kb = await knowledgeBase("public");
    const languages = await owner.put(`/api/v1/spaces/${kb.id}/knowledge-base/languages`, {
      defaultLanguage: "de",
      languages: ["de", "en"],
    });
    expect(languages.statusCode, languages.body).toBe(200);
    const original = await article(kb.id, null, "Passwort ändern", "Wähle ein neues Passwort.");
    const created = await owner.post(`/api/v1/articles/${original.id}/translations`, { language: "en" });
    expect(created.statusCode, created.body).toBe(201);
    const translationId = created.json().id as string;
    expect(
      (await owner.patch(`/api/v1/items/${translationId}`, { title: "Change the password" })).statusCode,
    ).toBe(200);
    const content = await owner.put(`/api/v1/pages/${translationId}/content`, {
      document: { type: "doc", content: [paragraph("Choose a new password.")] },
    });
    expect(content.statusCode, content.body).toBe(200);
    expect((await owner.post(`/api/v1/pages/${translationId}/publish`, {})).statusCode).toBe(200);
    const untranslated = await article(kb.id, null, "Drucker", "Drucker im Flur.");
    await index();
    const reader = anonymous();
    const english = await reader.get(`${kb.path}/en/${original.number}-change-the-password`);
    expect(english.statusCode, english.body).toBe(200);
    expect(english.body).not.toContain("?edit=true");
    const edited = await owner.get(`${kb.path}/en/${original.number}-change-the-password`);
    expect(edited.body).toContain(`/pages/${await numberOf(translationId)}/change-the-password?edit=true"`);
    expect(
      (await reader.get(`${kb.path}/en/${await numberOf(translationId)}-change-the-password`)).statusCode,
    ).toBe(404);
    expect(english.body).toContain('<html lang="en"');
    expect(english.body).toContain("Choose a new password.");
    expect(english.body).toContain(messagesFor("en").onThisPage);
    expect(english.body).toContain('class="dd lang"');
    expect(english.body).toMatch(
      /hreflang="en" lang="en" aria-current="true"><span class="cur"><svg[\s\S]*?<\/svg><\/span><span class="trunc" title="English">English<\/span><span class="n" lang="en">1 of 2 translated<\/span>/,
    );
    expect(english.body).toMatch(
      /hreflang="de" lang="de"><span class="cur"><\/span><span class="trunc" title="Deutsch">Deutsch<\/span><span class="n" lang="en">all 2<\/span><\/a>/,
    );
    expect(english.body).toContain("Also in German");
    expect(english.body).toContain(
      `<link rel="alternate" hreflang="de" href="${TEST_ORIGIN}${kb.path}/${original.number}-passwort-aendern">`,
    );
    expect(english.body).toContain(
      `<link rel="alternate" hreflang="en" href="${TEST_ORIGIN}${kb.path}/en/${original.number}-change-the-password">`,
    );
    expect(english.body).toContain('hreflang="x-default"');
    const german = await reader.get(`${kb.path}/${original.number}-passwort-aendern`);
    expect(german.body).toContain('<html lang="de"');
    expect(german.body).toContain(messagesFor("de").onThisPage);
    const wrongSlug = await reader.get(`${kb.path}/en/${original.number}-passwort-aendern`);
    expect(wrongSlug.statusCode).toBe(301);
    expect(wrongSlug.headers.location).toBe(`${kb.path}/en/${original.number}-change-the-password`);
    const invented = await reader.get(`${kb.path}/en/${original.number}-erfunden`);
    expect(invented.statusCode).toBe(301);
    expect(invented.headers.location).toBe(`${kb.path}/en/${original.number}-change-the-password`);
    const inventedGerman = await reader.get(`${kb.path}/${original.number}-erfunden`);
    expect(inventedGerman.statusCode).toBe(301);
    expect(inventedGerman.headers.location).toBe(`${kb.path}/${original.number}-passwort-aendern`);
    const fallback = await reader.get(`${kb.path}/en/${untranslated.number}-drucker`);
    expect(fallback.statusCode, fallback.body).toBe(200);
    expect(fallback.body).toContain('<html lang="en"');
    expect(fallback.body).toContain('<div class="body" lang="de">');
    expect(fallback.body).toContain("Drucker im Flur.");
    expect(fallback.body).toContain('class="langnote" role="note" lang="en"');
    expect(fallback.body).toContain(messagesFor("en").onThisPage);
    expect(fallback.body).not.toContain("Also in");
    const prefixed = await reader.get(`${kb.path}/de/${original.number}-passwort-aendern`);
    expect(prefixed.statusCode).toBe(301);
    expect(prefixed.headers.location).toBe(`${kb.path}/${original.number}-passwort-aendern`);
    const doubled = await reader.get(`${kb.path}/de//evil.example/x`);
    expect(doubled.statusCode).toBe(301);
    expect(doubled.headers.location).toBe(`${kb.path}/evil.example/x`);
    const start = await reader.get(`${kb.path}/en/`);
    expect(start.statusCode).toBe(200);
    expect(start.body).toContain('<html lang="en"');
    expect(start.body).toContain("Change the password");
    expect(start.body).toContain(`href="${kb.path}/en/${original.number}-change-the-password"`);
    expect(start.body).toContain('<span class="ltag" lang="en">only German</span>');
    const search = await reader.get(`${kb.path}/en/search?q=Drucker`);
    expect(search.statusCode).toBe(200);
    expect(search.body).not.toContain('class="langnote"');
    expect(search.body).toContain(`<li lang="de"><span class="path" lang="en">`);
    expect(search.body).toContain('<span class="ltag">');
    expect(search.body).toContain(`/${untranslated.number}-drucker`);
  });

  it("leaves out hreflang links for knowledge bases that are not public", async () => {
    const kb = await knowledgeBase("signedIn");
    await owner.put(`/api/v1/spaces/${kb.id}/knowledge-base/languages`, { languages: ["de", "en"] });
    const original = await article(kb.id, null, "Zugang", "Zugang beantragen.");
    await index();
    const page = await owner.get(`${kb.path}/${original.number}-zugang`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('class="dd lang"');
    expect(page.body).not.toContain('hreflang="x-default"');
  });

  it("shows the maintenance banner and takes no feedback during maintenance", async () => {
    const kb = await knowledgeBase("public");
    const entry = await article(kb.id, null, "Wartung", "Lesbar.");
    const reader = await person();
    await services().maintenance.set(SYSTEM, { enabled: true, message: "Bis 18 Uhr" });
    try {
      const shown = await anonymous().get(`${kb.path}/${entry.number}-wartung`);
      expect(shown.statusCode).toBe(200);
      expect(shown.body).toContain('class="maintnote"');
      expect(shown.body).toContain("<strong>Bis 18 Uhr</strong>");
      const refused = await reader.client.post(`${kb.path}/feedback`, { itemId: entry.id, helpful: true });
      expect(refused.statusCode).toBe(503);
      expect(refused.body).toContain("during maintenance");
    } finally {
      await services().maintenance.set(SYSTEM, { enabled: false });
    }
    const after = await anonymous().get(`${kb.path}/${entry.number}-wartung`);
    expect(after.body).not.toContain('class="maintnote"');
    expect(
      (await reader.client.post(`${kb.path}/feedback`, { itemId: entry.id, helpful: true })).statusCode,
    ).toBe(204);
  });
});
