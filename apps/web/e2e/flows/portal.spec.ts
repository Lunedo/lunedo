import { expect, test } from "../support/fixtures.js";
import { callApi, expectAccessible } from "../support/helpers.js";
import { forwardFrom, SIGNED_OUT } from "../support/people.js";
import { createPortal, waitForIndex } from "../support/portal.js";

test("an anonymous reader finds an article in a public knowledge base and rates it", async ({
  page,
  browser,
  baseURL,
  organization,
}) => {
  await page.goto("/");
  const portal = await createPortal(page, { audience: "public", organizationId: organization.id });
  await waitForIndex(page, portal, "VPN");
  const context = await forwardFrom(await browser.newContext({ baseURL, storageState: SIGNED_OUT }));
  const reader = await context.newPage();
  await reader.goto(`${portal.path}/`);
  await expect(reader.getByRole("heading", { name: "How can we help?", level: 1 })).toBeVisible();
  await expectAccessible(reader, "portal start page");
  await reader.getByRole("searchbox", { name: "Search help" }).first().fill("VPN");
  await reader.getByRole("button", { name: "Search" }).click();
  await expect(reader.getByRole("heading", { name: /articles for “VPN”/, level: 1 })).toBeVisible();
  await reader.getByRole("link", { name: "Set up the VPN connection from home" }).click();
  await expect(
    reader.getByRole("heading", { name: "Set up the VPN connection from home", level: 1 }),
  ).toBeVisible();
  await expect(reader.getByRole("link", { name: "Write an e-mail" })).toHaveAttribute(
    "href",
    /^mailto:it-support@example\.org\?subject=Help%20article%3A%20Set%20up/,
  );
  await expectAccessible(reader, "portal article");
  await reader.getByRole("button", { name: "No" }).click();
  await reader.getByLabel("What was missing? (optional)").fill("Step 2 looks different for me.");
  await reader.getByRole("button", { name: "Send note" }).click();
  await expect(
    reader.getByText("Thank you. The team sees your rating and your note without your name."),
  ).toBeVisible();
  await reader.reload();
  await expect(reader.getByText("Thank you for your feedback.")).toBeVisible();
  await expect(reader.getByRole("button", { name: "Yes" })).toBeHidden();
  await context.close();
});

test("a signed-in reader reads a knowledge base for groups after signing in", async ({
  page,
  organization,
}) => {
  await page.goto("/");
  const reader = await organization.invite("Robin");
  const group = (await callApi(page, "POST", `/api/v1/organizations/${organization.id}/groups`, {
    name: `Readers ${Date.now()}`,
  })) as { id: string };
  await callApi(page, "POST", `/api/v1/groups/${group.id}/members`, { accountId: reader.id });
  const portal = await createPortal(page, {
    audience: "groups",
    groupIds: [group.id],
    organizationId: organization.id,
  });
  await waitForIndex(page, portal, "VPN");
  const article = portal.articles[0];
  if (!article) throw new Error("no article");
  const { page: robin } = await organization.signIn(reader);
  await robin.goto(`${portal.path}/${article.address}`);
  await expect(robin.getByRole("heading", { name: article.title, level: 1 })).toBeVisible();
  const account = robin.getByLabel(/^Account: Robin/);
  await expect(account).toBeVisible();
  await account.click();
  await expect(robin.getByRole("link", { name: "Go to the wiki" })).toBeVisible();
});

test("an editor follows Edit into the app and returns with View in portal", async ({
  page,
  organization,
}) => {
  await page.goto("/");
  const portal = await createPortal(page, { audience: "signedIn", organizationId: organization.id });
  await waitForIndex(page, portal, "VPN");
  const article = portal.articles[0];
  if (!article) throw new Error("no article");
  await page.goto(`${portal.path}/${article.address}`);
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(new RegExp(`/pages/${article.id}`));
  await expect(page.getByRole("textbox", { name: "Page content" })).toBeEditable();
  const back = page.locator(`a[href$="${portal.path}/${article.address}"]`, { hasText: "View in portal" });
  await expect(back).toBeVisible();
  await page.goto((await back.getAttribute("href")) ?? "/");
  await expect(page.getByRole("heading", { name: article.title, level: 1 })).toBeVisible();
});

test("the portal works at phone width", async ({ page, browser, baseURL, organization }) => {
  await page.goto("/");
  const portal = await createPortal(page, { audience: "public", organizationId: organization.id });
  await waitForIndex(page, portal, "VPN");
  const context = await forwardFrom(
    await browser.newContext({ baseURL, storageState: SIGNED_OUT, viewport: { width: 390, height: 844 } }),
  );
  const reader = await context.newPage();
  await reader.goto(`${portal.path}/`);
  await reader.getByRole("button", { name: "Menu" }).click();
  await reader.getByRole("navigation", { name: "Areas" }).getByRole("link", { name: /IT/ }).click();
  await expect(reader.getByRole("heading", { name: "IT", level: 1 })).toBeVisible();
  await reader.getByRole("button", { name: "Topics", exact: true }).click();
  await expect(
    reader.getByRole("navigation", { name: "Topics in IT" }).getByRole("link", { name: /Remote access/ }),
  ).toBeVisible();
  await reader.getByRole("link", { name: "Printer shows job held" }).click();
  await reader.locator("summary", { hasText: "On this page" }).click();
  await expect(reader.getByRole("link", { name: "Solution" }).first()).toBeVisible();
  const overflow = await reader.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expectAccessible(reader, "portal article at phone width");
  await context.close();
});

test("a reader browses areas and topics and searches in the search window", async ({
  page,
  browser,
  baseURL,
  organization,
}) => {
  await page.goto("/");
  const portal = await createPortal(page, { audience: "public", organizationId: organization.id });
  await waitForIndex(page, portal, "VPN");
  const context = await forwardFrom(await browser.newContext({ baseURL, storageState: SIGNED_OUT }));
  const reader = await context.newPage();
  await reader.goto(`${portal.path}/`);
  await reader.locator("summary", { hasText: "Areas" }).click();
  await reader.getByRole("navigation", { name: "Areas" }).getByRole("link", { name: /IT/ }).click();
  await expect(reader.getByRole("heading", { name: "IT", level: 1 })).toBeVisible();
  await expect(reader.getByRole("link", { name: /VPN disconnects after a few minutes/ })).toHaveCount(0);
  await reader.getByRole("button", { name: "Include subtopics" }).click();
  await expect(reader.getByRole("link", { name: /VPN disconnects after a few minutes/ })).toBeVisible();
  const tree = reader.getByRole("navigation", { name: "Topics in IT" });
  await tree.getByRole("link", { name: /Remote access/ }).click();
  await expect(reader.getByRole("heading", { name: "Remote access", level: 1 })).toBeVisible();
  await expect(
    reader.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "IT", exact: true }),
  ).toBeVisible();
  await expectAccessible(reader, "portal topic");
  await reader.keyboard.press("Control+k");
  const dialog = reader.getByRole("dialog", { name: "Search" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", { name: "Search help" }).fill("VPN");
  await expect(dialog.getByRole("option", { name: /Set up the VPN connection from home/ })).toBeVisible();
  await expectAccessible(reader, "portal search window");
  await reader.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await reader.getByRole("link", { name: "Search", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Search help" }).fill("Remote");
  await expect(dialog.getByRole("option", { name: /^Remote access/ })).toBeVisible();
  await reader.keyboard.press("Enter");
  await expect(reader.getByRole("heading", { name: "Remote access", level: 1 })).toBeVisible();
  await reader.locator('summary[aria-label="Appearance"]').click();
  await reader.getByRole("button", { name: "Dark" }).click();
  await expect(reader.locator("html")).toHaveAttribute("data-theme", "dark");
  await reader.reload();
  await expect(reader.locator("html")).toHaveAttribute("data-theme", "dark");
  await context.close();
});
