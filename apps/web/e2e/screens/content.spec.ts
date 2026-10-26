import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { itemPath, pagePath, slugify } from "../support/addresses.js";
import { BASE_URL, MAILPIT_URL, OWNER_STORAGE } from "../support/environment.js";
import { callApi, linkFrom, waitForMail } from "../support/helpers.js";
import { makeArticleDue } from "../support/jobs.js";
import { type Person, post, SIGNED_OUT, sessionOf } from "../support/people.js";
import {
  doc,
  FIREWALL_DOCUMENT,
  firstVersion,
  h,
  howTo,
  howToEnglish,
  KNOWLEDGE_BASE,
  MERMAID_SOURCE,
  NETWORK_DRAWIO,
  NETWORK_SVG,
  p,
  panel,
  RACK_SVG,
  richDocument,
  TREE,
  table,
  troubleshooting,
} from "../support/screen-documents.js";
import {
  PEOPLE,
  type PersonKey,
  personState,
  type ScreenWorld,
  writeWorld,
} from "../support/screen-world.js";

test.use({ storageState: OWNER_STORAGE });
test.setTimeout(600_000);

const HEADERS = { "X-Lunedo-Request": "1" };

async function invite(owner: Page, browser: Browser, organizationId: string, name: string): Promise<Person> {
  const email = `${name.toLowerCase().split(" ").join(".")}@nordwind.test`;
  await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`, {
    method: "DELETE",
  });
  await callApi(owner, "POST", `/api/v1/organizations/${organizationId}/invitations`, {
    email,
    kind: "member",
  });
  const token =
    /#token=([\w-]+)/.exec(linkFrom((await waitForMail(email, /invit|eingeladen/i)).text))?.[1] ?? "";
  const anonymous = await browser.newContext({ storageState: SIGNED_OUT });
  try {
    const password = `${name} passphrase for screens`;
    const { accountId } = (await post(anonymous, "/api/v1/invitations/accept", {
      token,
      name,
      password,
    })) as {
      accountId: string;
    };
    return { id: accountId, name, email, password };
  } finally {
    await anonymous.close();
  }
}

async function upload(page: Page, path: string, data: Buffer | string, method: "POST" | "PUT" = "POST") {
  const response = await page.request.fetch(path, {
    method,
    data,
    headers: { ...HEADERS, "content-type": "application/octet-stream", origin: new URL(page.url()).origin },
  });
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBeLessThan(300);
  return (await response.json()) as Record<string, unknown>;
}

async function illustration(browser: Browser, svg: string, width: number, height: number): Promise<Buffer> {
  const context = await browser.newContext({ viewport: { width, height } });
  try {
    const page = await context.newPage();
    await page.setContent(`<body style="margin:0">${svg}</body>`);
    return await page.screenshot({ type: "png" });
  } finally {
    await context.close();
  }
}

async function createItem(
  page: Page,
  spaceId: string,
  body: {
    title: string;
    kind?: string;
    parentId?: string | null;
    mode?: "live" | "publish";
    description?: string;
  },
) {
  return (await callApi(page, "POST", `/api/v1/spaces/${spaceId}/items`, {
    kind: "page",
    parentId: null,
    ...body,
  })) as { id: string; number: number; title: string };
}

async function writePage(page: Page, id: string, document: unknown, publish = false) {
  await callApi(page, "PUT", `/api/v1/pages/${id}/content`, { document });
  if (publish) await callApi(page, "POST", `/api/v1/pages/${id}/publish`, {});
}

async function createSpace(page: Page, organizationId: string, body: Record<string, unknown>) {
  const created = (await callApi(page, "POST", `/api/v1/organizations/${organizationId}/spaces`, {
    visibility: "organization",
    grants: [{ principalKind: "organizationMembers", principalId: null, role: "editor" }],
    ...body,
  })) as { id: string; key: string };
  const space = (await (await page.request.get(`/api/v1/spaces/${created.id}`)).json()) as {
    overviewItemId: string | null;
  };
  return { id: created.id, key: body.key as string, overviewItemId: space.overviewItemId ?? "" };
}

async function pasteWhiteboard(page: Page): Promise<void> {
  const base = {
    angle: 0,
    strokeColor: "#1e1e1e",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    isDeleted: false,
    boundElements: null,
    link: null,
    locked: false,
  };
  let seed = 1;
  const box = (x: number, y: number, width: number, height: number, backgroundColor: string) => ({
    ...base,
    id: `box-${seed}`,
    type: "rectangle",
    x,
    y,
    width,
    height,
    backgroundColor,
    seed: seed++,
    version: 1,
    versionNonce: seed,
  });
  const label = (x: number, y: number, value: string, fontSize = 20) => ({
    ...base,
    id: `text-${seed}`,
    type: "text",
    x,
    y,
    width: Math.max(...value.split("\n").map((line) => line.length)) * fontSize * 0.55,
    height: value.split("\n").length * fontSize * 1.25,
    backgroundColor: "transparent",
    roundness: null,
    seed: seed++,
    version: 1,
    versionNonce: seed,
    text: value,
    originalText: value,
    fontSize,
    fontFamily: 5,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
  });
  const arrow = (x: number, y: number, dx: number, dy: number) => ({
    ...base,
    id: `arrow-${seed}`,
    type: "arrow",
    x,
    y,
    width: Math.abs(dx),
    height: Math.abs(dy),
    backgroundColor: "transparent",
    roundness: { type: 2 },
    seed: seed++,
    version: 1,
    versionNonce: seed,
    points: [
      [0, 0],
      [dx, dy],
    ],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  });
  const elements = [
    label(40, 0, "Umzug 3. Stock · Planung", 32),
    box(40, 80, 260, 180, "#a5d8ff"),
    label(60, 100, "Team IT-Betrieb\n8 Plätze, Fensterseite"),
    box(360, 80, 260, 180, "#b2f2bb"),
    label(380, 100, "Personalabteilung\n6 Plätze, ruhige Zone"),
    box(680, 80, 260, 180, "#ffec99"),
    label(700, 100, "Besprechung\n„Donau“, 10 Personen"),
    box(40, 320, 580, 120, "#e9ecef"),
    label(60, 340, "Flur, Drucker und Teeküche"),
    arrow(300, 170, 60, 0),
    arrow(620, 170, 60, 0),
    label(680, 320, "Offen: Netzwerkdosen prüfen (Mateo)\nUmzugstermin: 14. November", 18),
  ];
  const canvas = page.locator("canvas.excalidraw__canvas.interactive");
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await canvas.click({ position: { x: 120, y: 120 } });
  await page.evaluate(
    (json) => {
      const transfer = new DataTransfer();
      transfer.setData("text/plain", json);
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true }));
    },
    JSON.stringify({ type: "excalidraw/clipboard", elements, files: {} }),
  );
  await expect(page.getByRole("status").getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function asPerson(browser: Browser, key: PersonKey): Promise<BrowserContext> {
  return browser.newContext({ baseURL: BASE_URL, storageState: personState(key) });
}

async function put(context: BrowserContext, path: string, data: unknown): Promise<void> {
  const response = await context.request.put(new URL(path, BASE_URL).toString(), {
    data,
    headers: { ...HEADERS, origin: BASE_URL },
  });
  expect(response.status(), `PUT ${path}: ${await response.text()}`).toBeLessThan(300);
}

test("seeds the content of the screenshots", async ({ page, browser }) => {
  await page.goto("/spaces");
  const organizations = (await (await page.request.get("/api/v1/organizations")).json()) as
    | { id: string }[]
    | { organizations?: { id: string }[]; items?: { id: string }[] };
  const list = Array.isArray(organizations)
    ? organizations
    : (organizations.organizations ?? organizations.items ?? []);
  const organizationId = list[0]?.id ?? "";
  expect(organizationId).not.toBe("");
  await callApi(page, "PATCH", `/api/v1/organizations/${organizationId}`, {
    name: "Nordwind Logistik",
    language: "de",
    timeZone: "Europe/Vienna",
  });
  await callApi(page, "PUT", "/api/v1/instance/settings/instance.name", { value: "Nordwind Wiki" });
  await callApi(page, "PUT", "/api/v1/account/preferences/appearance.colorMode", { value: "system" });
  await callApi(page, "PUT", "/api/v1/account/preferences/locale.language", { value: "en" });

  const people = {} as Record<PersonKey, Person>;
  for (const [key, name] of Object.entries(PEOPLE) as [PersonKey, string][]) {
    people[key] = await invite(page, browser, organizationId, name);
    const state = await sessionOf(browser, people[key]);
    writeFileSync(personState(key), JSON.stringify(state));
    const context = await asPerson(browser, key);
    await put(context, "/api/v1/account/preferences/appearance.colorMode", { value: "system" });
    await context.close();
  }

  const groups: Record<string, PersonKey[]> = {
    "IT-Betrieb": ["lena", "jonas", "mateo"],
    Personalabteilung: ["aylin", "sophie"],
    Projektleitung: ["lena", "sophie"],
  };
  const groupIds: Record<string, string> = {};
  for (const [name, members] of Object.entries(groups)) {
    const group = (await callApi(page, "POST", `/api/v1/organizations/${organizationId}/groups`, {
      name,
    })) as {
      id: string;
    };
    groupIds[name] = group.id;
    for (const member of members) {
      await callApi(page, "POST", `/api/v1/groups/${group.id}/members`, { accountId: people[member].id });
    }
  }
  const role = (await callApi(page, "POST", `/api/v1/organizations/${organizationId}/roles`, {
    name: "Redaktion",
    areas: { spaces: "manage", membersAndGroups: "view" },
  })) as { id: string };
  await callApi(page, "POST", `/api/v1/organizations/${organizationId}/role-assignments`, {
    role: { customRoleId: role.id },
    principal: { kind: "group", id: groupIds.Personalabteilung },
  });

  const it = await createSpace(page, organizationId, { name: "IT-Betrieb", key: "IT" });
  await writePage(
    page,
    it.overviewItemId,
    doc(
      p(
        "Willkommen im Space des IT-Betriebs. Hier findest du Anleitungen, Regeln und den Stand unserer Projekte.",
      ),
      panel("info", "Dringende Störungen bitte telefonisch an die Bereitschaft: +43 1 555 0100."),
      h(2, "Schnellzugriff"),
      table(
        ["Thema", "Ansprechperson", "Stand"],
        ["Netzwerk", "Lena Hofer", "Aktuell"],
        ["Arbeitsplätze", "Jonas Berger", "Überarbeitung bis Ende November"],
        ["Sicherheit", "Mateo Rossi", "Aktuell"],
      ),
    ),
    true,
  );
  const titles: Record<string, { id: string; number: number; title: string }> = {};
  const createTree = async (nodes: typeof TREE, parentId: string | null) => {
    for (const node of nodes) {
      const created = await createItem(page, it.id, { title: node.title, parentId, mode: "live" });
      titles[node.title] = created;
      await writePage(page, created.id, doc(p(node.text)));
      if (node.children) await createTree(node.children, created.id);
    }
  };
  await createTree(TREE, null);

  const richTitle = "Netzwerkplan Standort Wien";
  const rich = await createItem(page, it.id, {
    title: richTitle,
    parentId: titles.Netzwerk?.id ?? null,
    mode: "publish",
  });
  const richPath = pagePath("IT", rich);
  const firewall = await createItem(page, it.id, {
    title: "Firewall-Regeln",
    parentId: rich.id,
    mode: "live",
  });
  await writePage(page, firewall.id, FIREWALL_DOCUMENT);
  await writePage(page, rich.id, firstVersion());
  await callApi(page, "POST", `/api/v1/pages/${rich.id}/publish`, { note: "Erste Fassung" });

  const image = await upload(
    page,
    `/api/v1/pages/${rich.id}/attachments?name=serverraum.png`,
    await illustration(browser, RACK_SVG, 1200, 675),
  );
  const blockId = randomUUID();
  const source = await upload(
    page,
    `/api/v1/pages/${rich.id}/diagrams/${blockId}/drawio`,
    NETWORK_DRAWIO,
    "PUT",
  );
  const preview = await upload(
    page,
    `/api/v1/pages/${rich.id}/diagrams/${blockId}/image?type=drawio`,
    NETWORK_SVG,
    "PUT",
  );
  await writePage(
    page,
    rich.id,
    richDocument({
      lena: people.lena.id,
      jonas: people.jonas.id,
      mateo: people.mateo.id,
      includePageId: firewall.id,
      dueSoon: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
      imageId: String(image.id),
      drawio: { id: blockId, sourceFormat: "drawio", ...source, ...preview },
    }),
  );
  await page.goto(`${richPath}?edit=true`);
  const content = page.getByRole("textbox", { name: "Page content" });
  await expect(content).toBeEditable({ timeout: 30_000 });
  await content.click();
  await content.press("Control+End");
  await content.press("Enter");
  await content.pressSequentially("/mermaid");
  await expect(page.getByRole("option", { name: /^Mermaid diagram/ })).toBeVisible();
  await page.keyboard.press("Enter");
  const mermaid = page.locator('[data-diagram="mermaid"]');
  await mermaid.getByLabel("Source of the Mermaid diagram").fill(MERMAID_SOURCE);
  await expect(mermaid.getByRole("img", { name: "Mermaid diagram" })).toBeVisible({ timeout: 30_000 });
  await mermaid.getByRole("button", { name: "Save diagram" }).click();
  await expect(mermaid.getByLabel("Source of the Mermaid diagram")).toBeHidden({ timeout: 20_000 });
  await expect(page.getByRole("status").getByText(/^Saved/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Close", exact: true }).click();

  const lena = await asPerson(browser, "lena");
  const jonas = await asPerson(browser, "jonas");
  await put(lena, `/api/v1/items/${rich.id}/watch`, { state: "watching" });
  const inline = (await post(lena, `/api/v1/pages/${rich.id}/comments`, {
    body: doc(p("Sollen wir die Regeln nicht vor dem Merge noch von einer zweiten Person prüfen lassen?")),
    anchor: {
      exact: "Die Regeln werden als Code gepflegt und bei jedem Merge automatisch ausgerollt:",
      prefix: "",
      suffix: "",
    },
  })) as { id: string };
  await post(jonas, `/api/v1/comments/${inline.id}/replies`, {
    body: doc(p("Ja, das Vier-Augen-Prinzip ist im Repository schon eingestellt.")),
  });
  await callApi(page, "POST", `/api/v1/pages/${rich.id}/publish`, {
    note: "Diagramme, Firewall-Regeln und offene Aufgaben ergänzt",
  });
  const pageComment = (await post(jonas, `/api/v1/pages/${rich.id}/comments`, {
    body: doc(p("Danke für die Übersicht! Kannst du noch den Adressbereich für VLAN 50 (Kameras) ergänzen?")),
  })) as { id: string };
  await callApi(page, "POST", `/api/v1/comments/${pageComment.id}/replies`, {
    body: doc(p("Mache ich, sobald die Kameras geliefert sind.")),
  });

  for (const title of ["Telefonliste 2019", "Alte Druckeranleitung"]) {
    const old = await createItem(page, it.id, { title, mode: "live" });
    await writePage(page, old.id, doc(p("Veraltet.")));
    await callApi(page, "DELETE", `/api/v1/items/${old.id}`);
  }

  const board = await createItem(page, it.id, { title: "Umzugsplanung 3. Stock", kind: "whiteboard" });
  const boardPath = itemPath("IT", "whiteboards", board);
  await page.goto(boardPath);
  await pasteWhiteboard(page);

  const templateName = "Störungsbericht";
  await callApi(page, "POST", `/api/v1/spaces/${it.id}/templates`, {
    name: templateName,
    description: "Für Störungen mit Auswirkung auf mehr als ein Team.",
    category: "operations",
    title: "Störung vom",
    fields: [],
    document: doc(
      h(2, "Was ist passiert?"),
      p("Kurze Beschreibung der Störung und ihrer Auswirkung."),
      h(2, "Zeitlicher Ablauf"),
      table(["Uhrzeit", "Ereignis"], ["", ""]),
      h(2, "Ursache"),
      p(""),
      h(2, "Maßnahmen"),
      panel("tip", "Jede Maßnahme bekommt eine verantwortliche Person und ein Datum."),
    ),
  });

  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const series = (await callApi(page, "POST", `/api/v1/spaces/${it.id}/meeting-series`, {
    name: "Jour fixe IT-Betrieb",
    members: [people.lena.id, people.jonas.id, people.mateo.id],
    rhythm: { frequency: "weekly", interval: 1, weekdays: ["MO"] },
    startsOn: monday.toISOString().slice(0, 10),
    templateId: "builtin:team-meeting",
    startTime: "09:30",
    timeZone: "Europe/Vienna",
    durationMinutes: 45,
  })) as { id: string; number: number; title: string; upcoming: { id: string } };
  for (const title of [
    "Umstellung auf die neue Firewall",
    "Urlaubsvertretung im Dezember",
    "Ersatz der Drucker im 2. Stock",
  ]) {
    const topic = (await callApi(page, "POST", `/api/v1/meeting-series/${series.id}/topics`, {
      title,
      ownerId: people.lena.id,
    })) as { id: string };
    if (title.startsWith("Ersatz")) {
      await callApi(page, "POST", `/api/v1/topics/${topic.id}/decision`, {
        statement: "Wir mieten Multifunktionsgeräte statt sie zu kaufen.",
      });
    }
  }
  for (const member of [people.lena, people.jonas]) {
    await callApi(page, "POST", `/api/v1/meetings/${series.upcoming.id}/attendees`, { accountId: member.id });
  }
  await callApi(page, "POST", `/api/v1/meetings/${series.upcoming.id}/close`, {});

  const general = await createSpace(page, organizationId, { name: "Nordwind intern", key: "INTERN" });
  await writePage(
    page,
    general.overviewItemId,
    doc(
      p(
        "Willkommen bei Nordwind Logistik. Hier findest du Neuigkeiten, Ansprechpersonen und die wichtigsten Links.",
      ),
      h(2, "Aktuelles"),
      p("Der Umzug in den 3. Stock startet am 14. November. Bitte packt eure Schreibtische bis zum Vortag."),
      h(2, "Ansprechpersonen"),
      table(
        ["Bereich", "Person", "Durchwahl"],
        ["IT-Service-Desk", "Lena Hofer", "-100"],
        ["Personal", "Aylin Demir", "-200"],
        ["Empfang", "Sophie Wagner", "-300"],
      ),
    ),
    true,
  );
  await callApi(page, "PUT", `/api/v1/organizations/${organizationId}/home-page`, {
    itemId: general.overviewItemId,
  });

  const empty = await createSpace(page, organizationId, { name: "Marketing", key: "MKT" });

  const personal = await createSpace(page, organizationId, {
    name: "Personalplanung",
    key: "HR",
    visibility: "private",
    grants: [{ principalKind: "account", principalId: people.aylin.id, role: "editor" }],
  });
  const salary = await createItem(page, personal.id, { title: "Gehaltsbänder 2027", mode: "live" });
  await writePage(
    page,
    salary.id,
    doc(p("Entwurf der Gehaltsbänder für 2027, abgestimmt mit der Geschäftsleitung.")),
  );
  await callApi(page, "POST", `/api/v1/pages/${salary.id}/access`, {
    changes: [
      { action: "restrict", kind: "view" },
      { action: "share", holderKind: "account", holderId: people.aylin.id, role: "editor" },
      { action: "share", holderKind: "account", holderId: people.lena.id, role: "reader" },
      { action: "share", holderKind: "group", holderId: groupIds.Projektleitung, role: "commenter" },
    ],
  });

  const knowledgeBase = (await callApi(page, "POST", `/api/v1/organizations/${organizationId}/spaces`, {
    name: "Hilfe-Center",
    key: "HILFE",
    type: "knowledgeBase",
    audience: "signedIn",
    grants: [],
  })) as { id: string };
  await callApi(page, "PUT", `/api/v1/spaces/${knowledgeBase.id}/knowledge-base/audience`, {
    audience: "public",
    groupIds: [],
    confirmWidening: true,
  });
  await callApi(page, "PUT", `/api/v1/spaces/${knowledgeBase.id}/knowledge-base/contact`, {
    contactEmail: "service-desk@nordwind.test",
  });
  await callApi(page, "PUT", `/api/v1/spaces/${knowledgeBase.id}/knowledge-base/languages`, {
    defaultLanguage: "de",
    languages: ["de", "en"],
  });
  await callApi(page, "PUT", `/api/v1/spaces/${knowledgeBase.id}/knowledge-base/required-sections`, {
    templateId: "builtin:article-how-to",
    sectionKey: "steps",
    required: true,
  });
  await callApi(page, "PUT", `/api/v1/spaces/${knowledgeBase.id}/knowledge-base/reviews`, {
    intervalMonths: 3,
  });
  const articles: { id: string; number: number; title: string }[] = [];
  let firstCategory = "";
  let englishAddress = "";
  for (const category of KNOWLEDGE_BASE) {
    const folder = await createItem(page, knowledgeBase.id, {
      title: category.category,
      kind: "folder",
      description: category.description,
    });
    firstCategory ||= `topics/${folder.number}-${slugify(folder.title)}`;
    await callApi(page, "PUT", `/api/v1/categories/${folder.id}`, { icon: category.icon });
    for (const article of category.articles) {
      const item = (await callApi(page, "POST", `/api/v1/spaces/${knowledgeBase.id}/items`, {
        kind: "page",
        title: article.title,
        parentId: folder.id,
        articleType: article.type,
      })) as { id: string; number: number; title: string };
      await writePage(
        page,
        item.id,
        article.type === "howTo" ? howTo(article.lead) : troubleshooting(article.lead),
        true,
      );
      articles.push(item);
      if (article.english) {
        const translation = (await callApi(page, "POST", `/api/v1/articles/${item.id}/translations`, {
          language: "en",
        })) as { id: string };
        await callApi(page, "PATCH", `/api/v1/items/${translation.id}`, { title: article.english });
        await writePage(page, translation.id, howToEnglish(article.lead), true);
        if (!englishAddress) {
          const english = (await (await page.request.get(`/api/v1/articles/${translation.id}`)).json()) as {
            number: number;
            slug: string;
          };
          englishAddress = `${english.number}-${english.slug}`;
        }
      }
    }
  }
  for (const article of articles.slice(4, 7)) await makeArticleDue(article.id);
  const portal = (await (
    await page.request.get(`/api/v1/spaces/${knowledgeBase.id}/knowledge-base/portal`)
  ).json()) as {
    path: string;
  };
  const vpn = articles[0];
  if (!vpn) throw new Error("The knowledge base has no article");
  const vpnArticle = (await (await page.request.get(`/api/v1/articles/${vpn.id}`)).json()) as {
    number: number;
    slug: string;
  };

  const lenaPage = await lena.newPage();
  const vpnAccess = titles["VPN-Zugang"];
  if (!vpnAccess) throw new Error("The page tree has no page VPN-Zugang");
  for (const target of [richPath, pagePath("IT", vpnAccess), `/spaces/INTERN`]) {
    await lenaPage.goto(target);
    await expect(lenaPage.locator("#main h1").first()).toBeVisible();
  }
  await lena.close();
  await jonas.close();

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/v1/organizations/${organizationId}/search?q=VPN`);
        return ((await response.json()) as { total: number }).total;
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThanOrEqual(4);

  const world: ScreenWorld = {
    organizationId,
    people,
    it: { id: it.id, key: "IT", overviewPath: "/spaces/IT" },
    rich: { id: rich.id, number: rich.number, path: richPath },
    whiteboard: { id: board.id, number: board.number, path: boardPath },
    templateName,
    seriesPath: itemPath("IT", "meetings", series),
    general: { key: "INTERN", homePath: "/spaces/INTERN" },
    empty: { key: empty.key },
    personal: {
      key: "HR",
      salary: { id: salary.id, number: salary.number, path: pagePath("HR", salary) },
    },
    knowledgeBase: {
      id: knowledgeBase.id,
      key: "HILFE",
      portal: `/help/${portal.path}`,
      categoryAddress: firstCategory,
      article: {
        id: vpn.id,
        number: vpn.number,
        path: pagePath("HILFE", vpn),
        address: `${vpnArticle.number}-${vpnArticle.slug}`,
      },
      englishAddress,
    },
  };
  writeWorld(world);
});
