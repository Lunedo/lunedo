import type { Page } from "@playwright/test";
import { itemOfNumber, itemPath, pagePath, sharedPath, slugify } from "../support/addresses.js";
import { paragraph } from "../support/collaboration.js";
import { expect, type Organization, test } from "../support/fixtures.js";
import { callApi, waitForMail } from "../support/helpers.js";
import { sendNotificationMailsNow } from "../support/jobs.js";
import { type Person, unique } from "../support/people.js";
import { createPortal, waitForIndex } from "../support/portal.js";

interface Created {
  id: string;
  number: number;
  title: string;
}

function at(path: string): RegExp {
  return new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

async function space(page: Page, organization: Organization, readers: Person[] = []) {
  const key = `NA${unique()}`;
  const created = (await callApi(page, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
    name: `Addresses ${key}`,
    key,
    visibility: "private",
    grants: readers.map((reader) => ({ principalKind: "account", principalId: reader.id, role: "reader" })),
  })) as { id: string };
  return { id: created.id, key };
}

async function publishedPage(
  page: Page,
  spaceId: string,
  title: string,
  content: unknown[],
): Promise<Created> {
  const created = (await callApi(page, "POST", `/api/v1/spaces/${spaceId}/items`, {
    kind: "page",
    title,
    parentId: null,
    mode: "publish",
  })) as Created;
  await callApi(page, "PUT", `/api/v1/pages/${created.id}/content`, { document: { type: "doc", content } });
  await callApi(page, "POST", `/api/v1/pages/${created.id}/publish`, {});
  return created;
}

test("opens a page by its number and keeps its address canonical after a rename and a move", async ({
  page,
  organization,
}) => {
  await page.goto("/spaces");
  const source = await space(page, organization);
  const target = await space(page, organization);
  const created = (await callApi(page, "POST", `/api/v1/spaces/${source.id}/items`, {
    kind: "page",
    title: "Übergabe Größe Café",
    parentId: null,
    mode: "live",
  })) as Created;
  expect(created.number).toBeGreaterThanOrEqual(1000);
  expect((await itemOfNumber(page, created.number)).id).toBe(created.id);
  const first = `/spaces/${source.key}/pages/${created.number}/uebergabe-groesse-cafe`;
  expect(pagePath(source.key, created)).toBe(first);
  const heading = page.getByRole("heading", { level: 1 });

  await page.goto(`/spaces/${source.key}/pages/${created.number}`);
  await expect(page).toHaveURL(at(first));
  await expect(heading).toHaveText("Übergabe Größe Café");

  await page.goto(`/spaces/${target.key}/whiteboards/${created.number}/outdated-title`);
  await expect(page).toHaveURL(at(first));
  await expect(heading).toHaveText("Übergabe Größe Café");

  await page.getByRole("button", { name: "Rename Übergabe Größe Café" }).click();
  await page.getByRole("textbox", { name: "Page title" }).fill("Übergabe Größe Café 2027");
  await page.keyboard.press("Enter");
  const renamed = `/spaces/${source.key}/pages/${created.number}/uebergabe-groesse-cafe-2027`;
  await expect(page).toHaveURL(at(renamed));
  await expect(heading).toHaveText("Übergabe Größe Café 2027");
  await page.goto(first);
  await expect(page).toHaveURL(at(renamed));
  await expect(heading).toHaveText("Übergabe Größe Café 2027");

  const preview = (await callApi(page, "POST", `/api/v1/items/${created.id}/move/preview`, {
    spaceId: target.id,
    parentId: null,
  })) as { confirmation: string | null };
  await callApi(page, "POST", `/api/v1/items/${created.id}/move`, {
    spaceId: target.id,
    parentId: null,
    ...(preview.confirmation ? { confirmation: preview.confirmation } : {}),
  });
  const moved = `/spaces/${target.key}/pages/${created.number}/uebergabe-groesse-cafe-2027`;
  await page.goto(renamed);
  await expect(page).toHaveURL(at(moved));
  await expect(heading).toHaveText("Übergabe Größe Café 2027");

  await page.goto(`/spaces/${target.key}/pages/${created.id}/uebergabe-groesse-cafe-2027`);
  await expect(page.getByText("Page not found").first()).toBeVisible();
});

test("a person the page is shared with opens it at its shared address", async ({ page, organization }) => {
  const colleague = await organization.invite("Sami");
  await page.goto("/spaces");
  const { id } = await space(page, organization);
  const created = await publishedPage(page, id, "Zugang für Gäste", [
    paragraph("Guests use the lobby Wi-Fi."),
  ]);
  await callApi(page, "POST", `/api/v1/pages/${created.id}/access`, {
    changes: [{ action: "share", holderKind: "account", holderId: colleague.id, role: "reader" }],
  });
  const address = sharedPath(created);
  expect(address).toBe(`/shared/${created.number}/zugang-fuer-gaeste`);

  const { page: other } = await organization.signIn(colleague);
  await other.goto(address);
  await expect(other.getByRole("heading", { name: "Zugang für Gäste", level: 1 })).toBeVisible();
  await expect(other.getByText("Guests use the lobby Wi-Fi.")).toBeVisible();
  await expect(other).toHaveURL(at(address));

  await other.goto(`/shared/${created.number}/old-title`);
  await expect(other).toHaveURL(at(address));
  await other.goto(`/shared/${created.number}`);
  await expect(other).toHaveURL(at(address));
  await expect(other.getByText("Guests use the lobby Wi-Fi.")).toBeVisible();
});

test("searching a number opens the item for people who can read it and searches for everyone else", async ({
  page,
  organization,
}) => {
  const outsider = await organization.invite("Nina");
  await page.goto("/spaces");
  const { id, key } = await space(page, organization);
  const created = await publishedPage(page, id, "Patch window", [paragraph("Servers restart on Sunday.")]);
  const address = pagePath(key, created);
  const typed = String(created.number);

  await page.goto("/search");
  await page.getByRole("searchbox", { name: "Search" }).fill(typed);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(at(address));
  await expect(page.getByRole("heading", { name: "Patch window", level: 1 })).toBeVisible();

  await page.goto("/home");
  await page
    .getByRole("banner")
    .getByRole("button", { name: /^Search Ctrl K$/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Search" });
  await dialog.getByRole("combobox").fill(typed);
  const jump = dialog
    .getByRole("group", { name: "Open by number" })
    .getByRole("option", { name: /Patch window/ });
  await expect(jump).toBeVisible();
  await expect(dialog.getByRole("option").first()).toHaveText(/Patch window/);
  await expect(jump).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(at(address));
  await expect(page.getByRole("heading", { name: "Patch window", level: 1 })).toBeVisible();

  const { page: other } = await organization.signIn(outsider);
  await other.goto("/search");
  const refused = other.waitForResponse(
    (response) => new URL(response.url()).pathname === `/api/v1/items/by-number/${typed}`,
  );
  await other.getByRole("searchbox", { name: "Search" }).fill(typed);
  await other.keyboard.press("Enter");
  expect((await refused).status()).toBe(404);
  await expect(other.getByRole("searchbox", { name: "Search" })).toHaveValue(typed);
  expect(new URL(other.url()).pathname).toBe("/search");
  await expect(other.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();
  await expect(other.getByRole("link", { name: "Patch window" })).toHaveCount(0);

  await other
    .getByRole("banner")
    .getByRole("button", { name: /^Search Ctrl K$/ })
    .click();
  const otherDialog = other.getByRole("dialog", { name: "Search" });
  const lookup = other.waitForResponse(
    (response) => new URL(response.url()).pathname === `/api/v1/items/by-number/${typed}`,
  );
  await otherDialog.getByRole("combobox").fill(typed);
  expect((await lookup).status()).toBe(404);
  await expect(otherDialog.getByRole("link", { name: `All results for “${typed}”` })).toBeVisible();
  await expect(otherDialog.getByRole("group", { name: "Open by number" })).toHaveCount(0);
});

test("opens a folder from the page tree at its number address", async ({ page, organization }) => {
  await page.goto("/spaces");
  const { id, key } = await space(page, organization);
  const folder = (await callApi(page, "POST", `/api/v1/spaces/${id}/items`, {
    kind: "folder",
    title: "Läufe & Pläne",
    parentId: null,
  })) as Created;
  const address = itemPath(key, "folders", folder);
  expect(address).toBe(`/spaces/${key}/folders/${folder.number}/laeufe-plaene`);

  await page.goto(`/spaces/${key}`);
  const tree = page.getByRole("tree", { name: "Page tree" });
  const entry = tree.getByRole("treeitem", { name: "Läufe & Pläne" });
  await expect(entry.getByRole("link")).toHaveAttribute("href", address);
  await entry.getByRole("link").click();
  await expect(page).toHaveURL(at(address));
  await expect(page.getByRole("heading", { name: "Läufe & Pläne", level: 1 })).toBeVisible();
});

test("portal articles and categories use the instance number and repair a missing or outdated slug", async ({
  page,
  organization,
}) => {
  await page.goto("/");
  const portal = await createPortal(page, { audience: "signedIn", organizationId: organization.id });
  await waitForIndex(page, portal, "VPN");
  const article = portal.articles[0];
  if (!article) throw new Error("The portal has no article");
  expect((await itemOfNumber(page, article.number)).id).toBe(article.id);
  expect(article.address).toBe(`${article.number}-${slugify(article.title)}`);
  const articleAddress = `${portal.path}/${article.address}`;
  const heading = page.getByRole("heading", { level: 1 });

  await page.goto(articleAddress);
  await expect(heading).toHaveText(article.title);
  await page.goto(`${portal.path}/${article.number}`);
  await expect(page).toHaveURL(at(articleAddress));
  await expect(heading).toHaveText(article.title);

  const renamedTitle = `${article.title} on a laptop`;
  await callApi(page, "PATCH", `/api/v1/items/${article.id}`, { title: renamedTitle });
  await callApi(page, "POST", `/api/v1/pages/${article.id}/publish`, {});
  const renamedAddress = `${portal.path}/${article.number}-${slugify(renamedTitle)}`;
  await expect
    .poll(async () => (await page.request.get(articleAddress)).url(), { timeout: 30_000 })
    .toMatch(at(renamedAddress));
  await page.goto(articleAddress);
  await expect(page).toHaveURL(at(renamedAddress));
  await expect(heading).toHaveText(renamedTitle);

  const remote = portal.topics["Remote access"];
  const remoteId = portal.categories["Remote access"];
  if (!remote || !remoteId) throw new Error("The portal has no category Remote access");
  const category = await itemOfNumber(page, Number(/^topics\/(\d+)-/.exec(remote)?.[1]));
  expect(category.id).toBe(remoteId);
  expect(remote).toBe(`topics/${category.number}-remote-access`);
  const categoryAddress = `${portal.path}/${remote}`;
  await page.goto(categoryAddress);
  await expect(heading).toHaveText("Remote access");
  await page.goto(`${portal.path}/topics/${category.number}`);
  await expect(page).toHaveURL(at(categoryAddress));
  await expect(heading).toHaveText("Remote access");
  await page.goto(`${portal.path}/topics/${category.number}-vpn`);
  await expect(page).toHaveURL(at(categoryAddress));
});

test("a notification in the list and its e-mail link lead to the number address", async ({
  page,
  organization,
}) => {
  const colleague = await organization.invite("Mira");
  await page.goto("/spaces");
  const { id, key } = await space(page, organization, [colleague]);
  const title = `Rollout plan ${unique()}`;
  const created = await publishedPage(page, id, title, [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Ask " },
        { type: "mention", attrs: { id: colleague.id } },
        { type: "text", text: " about the rollout." },
      ],
    },
  ]);
  const address = pagePath(key, created);
  const mentioned = new RegExp(`mentioned you in ${title}`);

  await expect.poll(() => sendNotificationMailsNow(colleague.id), { timeout: 30_000 }).toBeGreaterThan(0);
  const mail = await waitForMail(colleague.email, mentioned, 60_000);
  const link = /https?:\/\/\S+?(\/notifications\/[0-9a-f-]{36})/.exec(mail.text)?.[1];
  if (!link) throw new Error(`The mail has no notification link: ${mail.text}`);

  const { page: other } = await organization.signIn(colleague);
  await other.goto(link);
  await expect(other).toHaveURL(at(address));
  await expect(other.getByRole("heading", { name: title, level: 1 })).toBeVisible();

  await other.goto("/notifications");
  await other.getByRole("button", { name: mentioned }).click();
  await expect(other).toHaveURL(at(address));
  await expect(other.getByRole("heading", { name: title, level: 1 })).toBeVisible();
});
