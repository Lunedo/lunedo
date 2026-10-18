import type { Page } from "@playwright/test";
import { BASE_URL } from "../support/environment.js";
import { docx, PNG, pdf, photo, wav, xlsx } from "../support/files.js";
import { expect, test } from "../support/fixtures.js";
import { callApi, expectAccessible } from "../support/helpers.js";
import { forwardFrom, SIGNED_OUT } from "../support/people.js";
import { createPage, place } from "../support/places.js";

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
  organization,
}) => {
  const { pageId, pagePath } = await place(page, organization);
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
  await expect(page.getByRole("button", { name: "Done" })).toBeHidden();
  await expect(page).not.toHaveURL(/edit=true/);

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
});

test("previews every supported type without running scripts inside the files", async ({
  page,
  organization,
}) => {
  const { pagePath } = await place(page, organization);
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

test("restricts and shares a page, opens links and decides an access request", async ({
  page,
  organization,
}) => {
  const { spaceId, spaceKey, pagePath } = await place(page, organization);
  const colleague = await organization.invite("Sven");
  const { context, page: other } = await organization.signIn(colleague);
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
    await expect(other.getByText(`Shared with you by ${organization.admin.name}`)).toBeVisible();

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
  } finally {
    await context.close();
  }
});

test("opens a link for anyone with a password without an account", async ({
  page,
  browser,
  organization,
}) => {
  const { spaceId, spaceKey } = await place(page, organization, "Hidden plan");
  await callApi(page, "PUT", `/api/v1/organizations/${organization.id}/settings/sharing.anyoneLinks`, {
    value: true,
  });
  try {
    const open = await createPage(page, spaceId, spaceKey, "Status page");
    const made = (await callApi(page, "POST", `/api/v1/pages/${open.id}/share-links`, {
      scope: "anyone",
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      password: "harbour lantern",
    })) as { token: string };
    const anonymous = await forwardFrom(await browser.newContext({ storageState: SIGNED_OUT }));
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
      expect(visitor.url()).not.toContain("unlock");
    } finally {
      await anonymous.close();
    }
  } finally {
    await callApi(page, "PUT", `/api/v1/organizations/${organization.id}/settings/sharing.anyoneLinks`, {
      clear: true,
    });
  }
});

test("shows what a person can do and exports the overview", async ({ page, organization }) => {
  const { pageId } = await place(page, organization);
  const person = await organization.invite("Anna");
  await callApi(page, "POST", `/api/v1/pages/${pageId}/access`, {
    changes: [{ action: "share", holderKind: "account", holderId: person.id, role: "editor" }],
  });
  const choose = async () => {
    await page.goto(`/settings/organizations/${organization.id}/access`);
    await page.getByRole("combobox", { name: "Person" }).fill(person.name);
    await page.getByRole("option", { name: new RegExp(person.name) }).click();
  };
  await choose();
  const section = page.getByRole("region", { name: `What can ${person.name} do?` });
  await expect(section.getByRole("link", { name: "Network plan" })).toBeVisible();
  await section.getByRole("button", { name: "Why?" }).first().click();
  await expect(section.getByText("Can edit: the page is shared with them")).toBeVisible();
  await expectAccessible(page, "access overview");
  const csv = await page.request.get(
    `/api/v1/organizations/${organization.id}/access-overview?accountId=${person.id}`,
  );
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const lines = (await csv.text()).split("\r\n");
  expect(lines[0]).toBe("person,email,kind,space,page,role,pages,reason");
  expect(lines.some((line) => line.includes("Network plan"))).toBe(true);
});

test("shows a large photo as its display version and opens the original in full size", async ({
  page,
  organization,
}) => {
  const { pageId, pagePath } = await place(page, organization);
  await page.goto(pagePath);
  const original = photo(3200, 2400);
  const upload = await page.request.post(`/api/v1/pages/${pageId}/attachments?name=site-survey.png`, {
    data: original,
    headers: {
      "content-type": "application/octet-stream",
      "X-Pagehall-Request": "1",
      origin: new URL(page.url()).origin,
    },
  });
  expect(upload.status(), await upload.text()).toBe(201);
  const file = (await upload.json()) as { id: string };
  await callApi(page, "PUT", `/api/v1/pages/${pageId}/content`, {
    document: {
      type: "doc",
      content: [
        { type: "image", attrs: { attachmentId: file.id, alt: "Site survey", width: null, align: "center" } },
      ],
    },
  });
  await expect
    .poll(
      async () =>
        (await page.request.get(`/api/v1/attachments/${file.id}/content?size=display`)).headers()[
          "content-type"
        ],
      { timeout: 60_000 },
    )
    .toBe("image/webp");

  await page.goto(pagePath);
  const image = page.getByRole("img", { name: "Site survey" });
  await expect(image).toHaveAttribute("src", `/api/v1/attachments/${file.id}/content?size=display`);
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(2048);
  const full = page.getByRole("link", { name: "Site survey" });
  await expect(full).toHaveAttribute("title", "Open full size");
  const opened = page.waitForEvent("popup");
  await full.click();
  const tab = await opened;
  await tab.waitForLoadState();
  expect(new URL(tab.url()).pathname + new URL(tab.url()).search).toBe(
    `/api/v1/attachments/${file.id}/content`,
  );
  const shown = await page.request.get(tab.url());
  expect(shown.headers()["content-type"]).toBe("image/png");
  expect((await shown.body()).equals(original)).toBe(true);
  await tab.close();
  await expect(page).toHaveURL(new RegExp(`${pagePath}$`));
});
