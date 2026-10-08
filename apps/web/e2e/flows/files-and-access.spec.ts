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

test.describe.configure({ mode: "serial" });
test.use({ storageState: OWNER_STORAGE });

const VARIANTS = [
  { colorMode: "light", language: "en" },
  { colorMode: "dark", language: "de" },
] as const;
const WIDTHS = [1440, 390] as const;

let spaceKey = "FA";
let spaceId = "";
let pageId = "";
let pagePath = "";
let colleague = { id: "", email: "", password: "" };
let colleagueContext: BrowserContext | null = null;

async function organizationId(page: Page): Promise<string> {
  const stored = readState().organizationId;
  if (stored) return stored;
  const response = await page.request.get("/api/v1/organizations?limit=10");
  return ((await response.json()) as { items: { id: string }[] }).items[0]?.id ?? "";
}

async function invite(page: Page, browser: Browser, name: string) {
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}.${Date.now()}@pagehall.test`;
  const password = `${name} passphrase for sharing`;
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
    return { id: accountId, email, password };
  } finally {
    await anonymous.close();
  }
}

async function colleaguePage(browser: Browser): Promise<Page> {
  if (!colleagueContext) {
    colleagueContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await colleagueContext.newPage();
    await page.goto("/sign-in");
    await signInWithPassword(page, colleague.email, colleague.password);
    await expect(page.getByRole("heading", { name: "For you", level: 1 })).toBeVisible();
    return page;
  }
  return colleagueContext.pages()[0] ?? colleagueContext.newPage();
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

test.afterAll(async () => {
  await colleagueContext?.close();
});

test("uploads files by picker, drop and paste, previews them in a sandbox and restores versions", async ({
  page,
  browser,
}) => {
  spaceKey = `FA${test.info().retry || ""}`;
  await page.goto("/spaces");
  colleague = await invite(page, browser, "Sven Sharing");
  const space = (await callApi(page, "POST", `/api/v1/organizations/${await organizationId(page)}/spaces`, {
    name: "Files and access",
    key: spaceKey,
    visibility: "private",
    grants: [],
  })) as { id: string };
  spaceId = space.id;
  const created = (await callApi(page, "POST", `/api/v1/spaces/${spaceId}/items`, {
    kind: "page",
    title: "Network plan",
    parentId: null,
    mode: "live",
  })) as { id: string };
  pageId = created.id;
  pagePath = `/spaces/${spaceKey}/pages/${pageId}/network-plan`;

  await page.goto(pagePath);
  const section = attachments(page);
  await expect(section.getByText("No files yet. Upload files or drop them on the page.")).toBeVisible();
  await section.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("First version of the notes"),
  });
  await expect(section.getByRole("button", { name: /^notes\.txt/ })).toBeVisible();

  await dropFile(page, "article", "routers.csv", "text/csv", "name,ip\ncore,10.0.0.1\n");
  await expect(section.getByRole("button", { name: /^routers\.csv/ })).toBeVisible();

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
  await expect(attachments(page).getByRole("button", { name: /^page\.html/ })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  await attachments(page)
    .locator('input[type="file"]')
    .setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Second version of the notes"),
    });
  await expect(attachments(page).getByRole("button", { name: /^notes\.txt/ })).toContainText("version 2");

  await attachments(page)
    .getByRole("button", { name: /^notes\.txt/ })
    .click();
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

  await attachments(page)
    .getByRole("button", { name: /^page\.html/ })
    .click();
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
  const html = await page.request.get(`/api/v1/attachments/${await attachmentId(page, "page.html")}/content`);
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
  const row = (name: string) =>
    attachments(page).getByRole("button", { name: new RegExp(`^${name.replace(/\./g, "\\.")}`) });
  for (const file of files) await expect(row(file.name)).toBeVisible();
  const open = async (name: string) => {
    await row(name).click();
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

async function attachmentId(page: Page, name: string): Promise<string> {
  const response = await page.request.get(`/api/v1/pages/${pageId}/attachments`);
  const list = (await response.json()) as { id: string; name: string }[];
  return list.find((entry) => entry.name === name)?.id ?? "";
}

test("restricts and shares a page, opens links and decides an access request", async ({ page, browser }) => {
  await page.goto(pagePath);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: 'Share "Network plan"' });
  await dialog.getByRole("combobox", { name: "Add people or groups" }).fill("Sven");
  await page.getByRole("option", { name: /Sven Sharing/ }).click();
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  const pending = dialog.getByRole("region", { name: "Share with Sven Sharing (Can read)?" });
  await expect(pending.getByText("1 person can then read this page")).toBeVisible();
  await expectAccessible(page, "share dialog with pending change");
  await pending.getByRole("button", { name: "Share page" }).click();
  await expect(
    dialog.getByRole("region", { name: "People and groups on the access list" }).getByText("Sven Sharing"),
  ).toBeVisible();

  await dialog.getByRole("combobox", { name: "Who can view this page" }).click();
  await page.getByRole("option", { name: "Only the people and groups on the list" }).click();
  await dialog
    .getByRole("region", { name: "Restrict viewing to the access list?" })
    .getByRole("button", {
      name: "Restrict",
    })
    .click();
  await expect(page.getByText(/^Page restricted/)).toBeVisible();

  await dialog.getByRole("tab", { name: "Share links" }).click();
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(dialog.getByText("Add at least one person or group.")).toBeVisible();
  await dialog.getByRole("combobox", { name: "People and groups" }).fill("Sven");
  await page.getByRole("option", { name: /Sven Sharing/ }).click();
  await dialog.getByRole("button", { name: "Create link" }).click();
  const address = await dialog.locator("code").innerText();
  expect(address).toMatch(new RegExp(`^${BASE_URL}/s/[A-Za-z0-9_-]{40,}$`));
  await expectAccessible(page, "share links");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();

  const other = await colleaguePage(browser);
  await other.goto(new URL(address).pathname);
  await expect(other.getByRole("heading", { name: "Network plan" })).toBeVisible();
  await expect(other.getByText("Shared with you by Olivia Owner")).toBeVisible();
  await expect(other.getByRole("navigation", { name: /Pages/ })).toHaveCount(0);

  const hidden = (await callApi(page, "POST", `/api/v1/spaces/${spaceId}/items`, {
    kind: "page",
    title: "Budget",
    parentId: null,
    mode: "live",
  })) as { id: string };
  await other.goto(`/spaces/${spaceKey}/pages/${hidden.id}/budget`);
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
  await page.getByRole("button", { name: 'Give Sven Sharing "Can read"' }).click();
  await expect(page.getByText("Approved")).toBeVisible();
  await other.goto(`/spaces/${spaceKey}/pages/${hidden.id}/budget`);
  await expect(other.getByRole("heading", { name: "Budget" })).toBeVisible();

  await capture(page, "space-access", async () => {
    await page.goto(`/spaces/${spaceKey}/settings/access`);
    await expect(page.getByRole("link", { name: "Network plan" }).first()).toBeVisible();
  });
  await capture(page, "share-dialog", async () => {
    await page.goto(pagePath);
    await page.getByRole("button", { name: /^(Share|Freigeben)$/ }).click();
    await expect(page.getByRole("dialog").getByText("Sven Sharing").first()).toBeVisible();
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
});

test("opens a link for anyone with a password without an account", async ({ page, browser }) => {
  const organization = await organizationId(page);
  await page.goto("/spaces");
  await callApi(page, "PUT", `/api/v1/organizations/${organization}/settings/sharing.anyoneLinks`, {
    value: true,
  });
  try {
    const open = (await callApi(page, "POST", `/api/v1/spaces/${spaceId}/items`, {
      kind: "page",
      title: "Status page",
      parentId: null,
      mode: "live",
    })) as { id: string };
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
      await expect(visitor.getByText("Network plan")).toHaveCount(0);
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

test("shows what a person can do and exports the overview", async ({ page }) => {
  const organization = await organizationId(page);
  await page.goto(`/settings/organizations/${organization}/access`);
  await page.getByRole("combobox", { name: "Person" }).fill("Sven");
  await page.getByRole("option", { name: /Sven Sharing/ }).click();
  const section = page.getByRole("region", { name: "What can Sven Sharing do?" });
  await expect(section.getByText("Network plan").first()).toBeVisible();
  await section.getByRole("button", { name: "Why?" }).first().click();
  await expect(section.getByText(/the page is shared with them|Opened a share link/).first()).toBeVisible();
  await expectAccessible(page, "access overview");
  await capture(page, "access-overview", async () => {
    await page.goto(`/settings/organizations/${organization}/access`);
    await page.getByRole("combobox", { name: "Person" }).fill("Sven");
    await page.getByRole("option", { name: /Sven Sharing/ }).click();
    await expect(page.getByRole("button", { name: /^(Why\?|Warum\?)$/ }).first()).toBeVisible();
  });
  const csv = await page.request.get(
    `/api/v1/organizations/${organization}/access-overview?accountId=${colleague.id}`,
  );
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect((await csv.text()).split("\r\n")[0]).toBe("person,email,kind,space,page,role,pages,reason");
});
