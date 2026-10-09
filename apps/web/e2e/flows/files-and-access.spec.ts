import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { BASE_URL, OWNER_STORAGE, readState } from "../support/environment.js";
import { docx, PNG, pdf, wav, xlsx } from "../support/files.js";
import {
  callApi,
  expectAccessible,
  linkFrom,
  setAppearance,
  signInWithPassword,
  waitForMail,
} from "../support/helpers.js";

test.use({ storageState: OWNER_STORAGE });

const VARIANTS = [
  { colorMode: "light", language: "en" },
  { colorMode: "dark", language: "de" },
] as const;
const WIDTHS = [1440, 390] as const;

interface Person {
  id: string;
  name: string;
  email: string;
  password: string;
}

interface Place {
  spaceId: string;
  spaceKey: string;
  pageId: string;
  pagePath: string;
}

function unique(): string {
  const random = Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, "0");
  return `${Date.now().toString(36).slice(-5)}${random}`.toUpperCase();
}

function slug(title: string): string {
  return title.toLowerCase().split(" ").join("-");
}

async function organizationId(page: Page): Promise<string> {
  const stored = readState().organizationId;
  if (stored) return stored;
  const response = await page.request.get("/api/v1/organizations?limit=10");
  return ((await response.json()) as { items: { id: string }[] }).items[0]?.id ?? "";
}

async function invite(page: Page, browser: Browser, first: string): Promise<Person> {
  const name = `${first} ${unique()}`;
  const email = `${name.toLowerCase().split(" ").join(".")}@pagehall.test`;
  const password = `${first} passphrase for sharing`;
  await callApi(page, "POST", `/api/v1/organizations/${await organizationId(page)}/invitations`, {
    email,
    kind: "member",
  });
  const token = /#token=([\w-]+)/.exec(linkFrom((await waitForMail(email, /invit/i)).text))?.[1] ?? "";
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const response = await anonymous.request.post(`${BASE_URL}/api/v1/invitations/accept`, {
      data: { token, name, password },
      headers: { "X-Pagehall-Request": "1", origin: BASE_URL },
    });
    expect(response.status(), await response.text()).toBeLessThan(300);
    const { accountId } = (await response.json()) as { accountId: string };
    return { id: accountId, name, email, password };
  } finally {
    await anonymous.close();
  }
}

async function signedIn(browser: Browser, person: Person): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signInWithPassword(page, person.email, person.password);
  await expect(page.getByRole("heading", { name: "For you", level: 1 })).toBeVisible();
  return { context, page };
}

async function createPage(page: Page, spaceId: string, spaceKey: string, title: string) {
  const created = (await callApi(page, "POST", `/api/v1/spaces/${spaceId}/items`, {
    kind: "page",
    title,
    parentId: null,
    mode: "live",
  })) as { id: string };
  return { id: created.id, path: `/spaces/${spaceKey}/pages/${created.id}/${slug(title)}` };
}

async function place(page: Page, title = "Network plan"): Promise<Place> {
  await page.goto("/spaces");
  const spaceKey = `F${unique()}`;
  const space = (await callApi(page, "POST", `/api/v1/organizations/${await organizationId(page)}/spaces`, {
    name: `Files and access ${spaceKey}`,
    key: spaceKey,
    visibility: "private",
    grants: [],
  })) as { id: string };
  const created = await createPage(page, space.id, spaceKey, title);
  return { spaceId: space.id, spaceKey, pageId: created.id, pagePath: created.path };
}

async function capture(page: Page, name: string, open: () => Promise<void>) {
  for (const variant of VARIANTS) {
    await setAppearance(page, variant);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await open();
      await page.evaluate(() => document.fonts.ready);
      await expectAccessible(page, `${name} (${variant.colorMode}, ${variant.language}, ${width})`);
      const file = `${name}-${variant.colorMode}-${variant.language}-${width}.png`;
      await page.screenshot({ fullPage: true, path: test.info().outputPath(file) });
      await test.info().attach(file, { path: test.info().outputPath(file), contentType: "image/png" });
    }
  }
  await setAppearance(page, { colorMode: "light", language: "en" });
  await page.setViewportSize({ width: 1280, height: 900 });
}

function attachments(page: Page) {
  return page.getByRole("region", { name: /^Attachments/ });
}

function row(page: Page, name: string) {
  return attachments(page).getByRole("button", { name: new RegExp(`^${name.split(".").join("\\.")}`) });
}

async function dropFile(page: Page, target: string, name: string, type: string, text: string) {
  const transfer = await page.evaluateHandle(
    ({ name, type, text }) => {
      const data = new DataTransfer();
      data.items.add(new File([text], name, { type }));
      return data;
    },
    { name, type, text },
  );
  await page.dispatchEvent(target, "dragenter", { dataTransfer: transfer });
  await page.dispatchEvent(target, "dragover", { dataTransfer: transfer });
  await page.dispatchEvent(target, "drop", { dataTransfer: transfer });
}

async function attachmentId(page: Page, pageId: string, name: string): Promise<string> {
  const response = await page.request.get(`/api/v1/pages/${pageId}/attachments`);
  const list = (await response.json()) as { id: string; name: string }[];
  return list.find((entry) => entry.name === name)?.id ?? "";
}

test("uploads files by picker, drop and paste, previews them in a sandbox and restores versions", async ({
  page,
}) => {
  const { pageId, pagePath } = await place(page);
  await page.goto(pagePath);
  const section = attachments(page);
  await expect(section.getByText("No files yet. Upload files or drop them on the page.")).toBeVisible();
  await section.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("First version of the notes"),
  });
  await expect(row(page, "notes.txt")).toBeVisible();

  await dropFile(page, "article", "routers.csv", "text/csv", "name,ip\ncore,10.0.0.1\n");
  await expect(row(page, "routers.csv")).toBeVisible();

  await page.goto(`${pagePath}?edit=true`);
  const editor = page.getByRole("textbox", { name: "Page content" });
  await editor.click();
  const pasted = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(["<script>alert(1)</script>"], "page.html", { type: "text/html" }));
    return data;
  });
  await editor.evaluate((element, data) => {
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, pasted);
  await expect(row(page, "page.html")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  await attachments(page)
    .locator('input[type="file"]')
    .setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Second version of the notes"),
    });
  await expect(row(page, "notes.txt")).toContainText("version 2");

  await row(page, "notes.txt").click();
  const drawer = page.getByRole("dialog", { name: "notes.txt" });
  const frame = page.frameLocator('iframe[title="Preview of notes.txt"]');
  await expect(frame.getByText("Second version of the notes")).toBeVisible();
  const handle = await page.locator('iframe[title="Preview of notes.txt"]').elementHandle();
  const preview = await handle?.contentFrame();
  const reach = await preview?.evaluate(() => {
    const attempt = (read: () => unknown) => {
      try {
        read();
        return "readable";
      } catch {
        return "blocked";
      }
    };
    return {
      cookie: attempt(() => document.cookie),
      storage: attempt(() => window.localStorage.getItem("x")),
      parent: attempt(() => window.parent.document.title),
    };
  });
  expect(reach).toEqual({ cookie: "blocked", storage: "blocked", parent: "blocked" });
  await expectAccessible(page, "file preview");
  await drawer.getByRole("button", { name: "Versions (2)" }).click();
  await drawer.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Version 1 is current again", { exact: true })).toBeVisible();
  await expect(frame.getByText("First version of the notes")).toBeVisible();
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toBeHidden();

  await row(page, "page.html").click();
  const htmlDrawer = page.getByRole("dialog", { name: "page.html" });
  let alerted = false;
  page.on("dialog", (shown) => {
    alerted = true;
    void shown.dismiss();
  });
  await expect(
    page.frameLocator('iframe[title="Preview of page.html"]').getByText("<script>alert(1)</script>"),
  ).toBeVisible();
  expect(alerted).toBe(false);
  const html = await page.request.get(
    `/api/v1/attachments/${await attachmentId(page, pageId, "page.html")}/content`,
  );
  expect(html.headers()["content-disposition"]).toMatch(/^attachment/);
  expect(html.headers()["content-type"]).not.toContain("text/html");
  expect(html.headers()["x-content-type-options"]).toBe("nosniff");
  await htmlDrawer.getByRole("button", { name: "Close" }).click();

  await capture(page, "attachments", async () => {
    await page.goto(pagePath);
    await expect(page.getByRole("button", { name: /^notes.txt/ })).toBeVisible();
  });
});

test("previews every supported type without running scripts inside the files", async ({ page }) => {
  const { pagePath } = await place(page);
  let alerted = false;
  page.on("dialog", (shown) => {
    alerted = true;
    void shown.dismiss();
  });
  await page.goto(pagePath);
  const files = [
    { name: "pixel.png", mimeType: "image/png", buffer: PNG },
    { name: "report.pdf", mimeType: "application/pdf", buffer: pdf("Quarterly numbers") },
    {
      name: "runbook.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(["# Restart the router", "", "Press **reset** and wait.", ""].join("\n")),
    },
    {
      name: "logo.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" onload="alert(1)"><script>alert(2)</script><rect width="20" height="20" fill="teal"/></svg>',
      ),
    },
    { name: "minutes.docx", mimeType: "application/octet-stream", buffer: docx("Minutes of the review") },
    { name: "budget.xlsx", mimeType: "application/octet-stream", buffer: xlsx("Budget total") },
    { name: "chime.wav", mimeType: "audio/wav", buffer: wav() },
  ];
  await attachments(page).locator('input[type="file"]').setInputFiles(files);
  for (const file of files) await expect(row(page, file.name)).toBeVisible();
  const open = async (name: string) => {
    await row(page, name).click();
    return page.getByRole("dialog", { name });
  };
  const close = async (drawer: ReturnType<Page["getByRole"]>) => {
    await drawer.getByRole("button", { name: "Close" }).click();
    await expect(drawer).toBeHidden();
  };
  const frame = (name: string) => page.frameLocator(`iframe[title="Preview of ${name}"]`);

  let drawer = await open("pixel.png");
  await expect(drawer.getByRole("img", { name: "pixel.png" })).toBeVisible();
  await close(drawer);
  drawer = await open("report.pdf");
  await expect(frame("report.pdf").getByRole("img", { name: "Page 1" })).toBeVisible();
  await close(drawer);
  drawer = await open("runbook.md");
  await expect(frame("runbook.md").getByRole("heading", { name: "Restart the router" })).toBeVisible();
  await close(drawer);
  drawer = await open("logo.svg");
  await expect(frame("logo.svg").getByRole("img", { name: "logo.svg" })).toBeVisible();
  await close(drawer);
  drawer = await open("minutes.docx");
  await expect(frame("minutes.docx").getByText("Minutes of the review")).toBeVisible();
  await close(drawer);
  drawer = await open("budget.xlsx");
  await expect(frame("budget.xlsx").getByText("Budget total")).toBeVisible();
  await close(drawer);
  drawer = await open("chime.wav");
  await expect(drawer.locator("audio")).toBeVisible();
  await close(drawer);
  expect(alerted).toBe(false);
});

test("restricts and shares a page, opens links and decides an access request", async ({ page, browser }) => {
  const { spaceId, spaceKey, pagePath } = await place(page);
  const colleague = await invite(page, browser, "Sven");
  const { context, page: other } = await signedIn(browser, colleague);
  try {
    await page.goto(pagePath);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: 'Share "Network plan"' });
    await dialog.getByRole("combobox", { name: "Add people or groups" }).fill(colleague.name);
    await page.getByRole("option", { name: new RegExp(colleague.name) }).click();
    await dialog.getByRole("button", { name: "Share", exact: true }).click();
    const pending = dialog.getByRole("region", { name: `Share with ${colleague.name} (Can read)?` });
    await expect(pending.getByText("1 person can then read this page")).toBeVisible();
    await expectAccessible(page, "share dialog with pending change");
    await pending.getByRole("button", { name: "Share page" }).click();
    await expect(
      dialog.getByRole("region", { name: "People and groups on the access list" }).getByText(colleague.name),
    ).toBeVisible();

    await dialog.getByRole("combobox", { name: "Who can view this page" }).click();
    await page.getByRole("option", { name: "Only the people and groups on the list" }).click();
    await dialog
      .getByRole("region", { name: "Restrict viewing to the access list?" })
      .getByRole("button", { name: "Restrict" })
      .click();
    await expect(page.getByText(/^Page restricted/)).toBeVisible();

    await dialog.getByRole("tab", { name: "Share links" }).click();
    await dialog.getByRole("button", { name: "Create link" }).click();
    await expect(dialog.getByText("Add at least one person or group.")).toBeVisible();
    await dialog.getByRole("combobox", { name: "People and groups" }).fill(colleague.name);
    await page.getByRole("option", { name: new RegExp(colleague.name) }).click();
    await dialog.getByRole("button", { name: "Create link" }).click();
    const address = await dialog.locator("code").innerText();
    expect(address).toMatch(new RegExp(`^${BASE_URL}/s/[A-Za-z0-9_-]{40,}$`));
    await expectAccessible(page, "share links");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();

    await other.goto(new URL(address).pathname);
    await expect(other.getByRole("heading", { name: "Network plan" })).toBeVisible();
    await expect(other.getByText("Shared with you by Olivia Owner")).toBeVisible();

    const hidden = await createPage(page, spaceId, spaceKey, "Budget");
    await other.goto(hidden.path);
    await expect(other.getByText("This page does not exist or you have no access")).toBeVisible();
    await other.getByRole("textbox", { name: /Message/ }).fill("I prepare the budget review.");
    await other.getByRole("button", { name: "Request access" }).click();
    await expect(other.getByText("Request sent")).toBeVisible();

    const requests = (await (await page.request.get(`/api/v1/spaces/${spaceId}/access-requests`)).json()) as {
      id: string;
    }[];
    await page.goto(`/access-requests/${requests[0]?.id ?? ""}`);
    await expect(page.getByText("I prepare the budget review.")).toBeVisible();
    await expectAccessible(page, "access request");
    await page.getByRole("button", { name: `Give ${colleague.name} "Can read"` }).click();
    await expect(page.getByText("Approved")).toBeVisible();
    await other.goto(hidden.path);
    await expect(other.getByRole("heading", { name: "Budget" })).toBeVisible();

    await capture(page, "space-access", async () => {
      await page.goto(`/spaces/${spaceKey}/settings/access`);
      await expect(page.getByRole("link", { name: "Network plan" }).first()).toBeVisible();
    });
    await capture(page, "share-dialog", async () => {
      await page.goto(pagePath);
      await page.getByRole("button", { name: /^(Share|Freigeben)$/ }).click();
      await expect(page.getByRole("dialog").getByText(colleague.name).first()).toBeVisible();
    });
    await capture(page, "share-links", async () => {
      await page.goto(pagePath);
      await page.getByRole("button", { name: /^(Share|Freigeben)$/ }).click();
      await page.getByRole("tab", { name: /^(Share links|Freigabelinks)$/ }).click();
      await expect(
        page.getByRole("dialog").getByRole("button", { name: /^(Copy link|Link kopieren)$/ }),
      ).toBeVisible();
    });
    await capture(page, "give-access", async () => {
      await page.goto(`/spaces/${spaceKey}/settings/access`);
      await page
        .getByRole("button", {
          name: /^(Give access|Zugriff geben|Continue giving access|Zugriff geben fortsetzen)$/,
        })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
    });
    await capture(other, "shared-page", async () => {
      await other.goto(new URL(address).pathname);
      await expect(other.getByRole("heading", { name: "Network plan" })).toBeVisible();
    });
  } finally {
    await context.close();
  }
});

test("opens a link for anyone with a password without an account", async ({ page, browser }) => {
  const { spaceId, spaceKey } = await place(page, "Hidden plan");
  const organization = await organizationId(page);
  await callApi(page, "PUT", `/api/v1/organizations/${organization}/settings/sharing.anyoneLinks`, {
    value: true,
  });
  try {
    const open = await createPage(page, spaceId, spaceKey, "Status page");
    const made = (await callApi(page, "POST", `/api/v1/pages/${open.id}/share-links`, {
      scope: "anyone",
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      password: "harbour lantern",
    })) as { token: string };
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const visitor = await anonymous.newPage();
      await visitor.goto(`/s/${made.token}`);
      await expect(visitor.getByText("This link is protected")).toBeVisible();
      await expectAccessible(visitor, "link password");
      await visitor.getByLabel("Password", { exact: true }).fill("wrong guess");
      await visitor.getByRole("button", { name: "Open page" }).click();
      await expect(visitor.getByText(/The password is not correct/)).toBeVisible();
      await visitor.getByLabel("Password", { exact: true }).fill("harbour lantern");
      await visitor.getByRole("button", { name: "Open page" }).click();
      await expect(visitor.getByRole("heading", { name: "Status page" })).toBeVisible();
      await expect(visitor.getByText("Hidden plan")).toHaveCount(0);
      await expectAccessible(visitor, "page opened through a link");
      for (const colorScheme of ["light", "dark"] as const) {
        await visitor.emulateMedia({ colorScheme });
        for (const width of WIDTHS) {
          await visitor.setViewportSize({ width, height: 900 });
          await expectAccessible(visitor, `link page (${colorScheme}, ${width})`);
          const file = `link-page-${colorScheme}-${width}.png`;
          await visitor.screenshot({ fullPage: true, path: test.info().outputPath(file) });
        }
      }
      expect(visitor.url()).not.toContain("unlock");
    } finally {
      await anonymous.close();
    }
  } finally {
    await callApi(page, "PUT", `/api/v1/organizations/${organization}/settings/sharing.anyoneLinks`, {
      clear: true,
    });
  }
});

test("shows what a person can do and exports the overview", async ({ page, browser }) => {
  const { pageId } = await place(page);
  const person = await invite(page, browser, "Anna");
  await callApi(page, "POST", `/api/v1/pages/${pageId}/access`, {
    changes: [{ action: "share", holderKind: "account", holderId: person.id, role: "editor" }],
  });
  const organization = await organizationId(page);
  const choose = async () => {
    await page.goto(`/settings/organizations/${organization}/access`);
    await page.getByRole("combobox", { name: "Person" }).fill(person.name);
    await page.getByRole("option", { name: new RegExp(person.name) }).click();
  };
  await choose();
  const section = page.getByRole("region", { name: `What can ${person.name} do?` });
  await expect(section.getByRole("link", { name: "Network plan" })).toBeVisible();
  await section.getByRole("button", { name: "Why?" }).first().click();
  await expect(section.getByText("Can edit: the page is shared with them")).toBeVisible();
  await expectAccessible(page, "access overview");
  await capture(page, "access-overview", async () => {
    await choose();
    await expect(page.getByRole("button", { name: /^(Why\?|Warum\?)$/ }).first()).toBeVisible();
  });
  const csv = await page.request.get(
    `/api/v1/organizations/${organization}/access-overview?accountId=${person.id}`,
  );
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const lines = (await csv.text()).split("\r\n");
  expect(lines[0]).toBe("person,email,kind,space,page,role,pages,reason");
  expect(lines.some((line) => line.includes("Network plan"))).toBe(true);
});
