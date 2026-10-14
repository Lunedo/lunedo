import { expect, test } from "../support/fixtures.js";
import { meetingAndFileHits, searchWorld } from "../support/search.js";

test("searches from a space, opens a result, filters and saves the search", async ({
  page,
  organization,
}) => {
  const world = await searchWorld(page, organization);
  await page.goto(`/spaces/${world.operations.key}`);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Search" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog.getByRole("button", { name: "IT Operations first" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await dialog.getByRole("combobox").pressSequentially(world.word);
  const typed = Date.now();
  await expect(dialog.getByRole("option", { name: /Restart the VPN gateway/ })).toBeVisible();
  test.info().annotations.push({ type: "quick search", description: `${Date.now() - typed} ms` });
  await expect(
    dialog.getByRole("group", { name: "In IT Operations" }).getByRole("option", { name: /Network overview/ }),
  ).toBeVisible();
  await expect(
    dialog
      .getByRole("group", { name: "Other spaces" })
      .getByRole("option", { name: /VPN access for contractors/ }),
  ).toBeVisible();

  const options = dialog.getByRole("option");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  const names = await options.allTextContents();
  const target = names.findIndex((name) => name.startsWith("Restart the VPN gateway"));
  for (let step = 0; step < target; step += 1) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Restart the VPN gateway", level: 1 })).toBeVisible();
  expect(new URL(page.url()).pathname).toContain(world.gatewayPath);

  await page.keyboard.press("/");
  await expect(dialog.getByRole("option", { name: world.word })).toBeVisible();
  await dialog.getByRole("combobox").fill(world.word);
  await dialog.getByRole("option", { name: `Search all results for “${world.word}”` }).click();
  await expect(page.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();
  await expect(page.getByText("3 results")).toBeVisible();

  const filters = page.getByRole("complementary", { name: "Filters" });
  await filters.getByRole("checkbox", { name: /IT Operations/ }).click();
  await expect(page.getByText("2 results")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("spaces")).toBe(world.operations.id);
  await page.reload();
  await expect(page.getByText("2 results")).toBeVisible();
  await expect(filters.getByRole("checkbox", { name: /IT Operations/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(filters.getByRole("checkbox", { name: /Security/ })).toHaveAttribute("aria-checked", "false");

  await page.getByRole("button", { name: "Save search" }).click();
  const save = page.getByRole("dialog", { name: "Save this search" });
  await save.getByLabel("Name").fill("Gateway in operations");
  await save.getByRole("button", { name: "Save search" }).click();
  await expect(
    page.getByText("Search saved. You find it under Saved searches.", { exact: true }),
  ).toBeVisible();
  await expect(filters.getByRole("link", { name: "Gateway in operations" })).toBeVisible();

  const colleague = await organization.invite("Kim");
  const { page: other } = await organization.signIn(colleague);
  await other.goto(`/search?q=${world.word}`);
  await expect(other.getByText("3 results")).toBeVisible();
  await expect(other.getByText("Save a search to run it again later.", { exact: false })).toBeVisible();
  await expect(other.getByRole("link", { name: "Gateway in operations" })).toHaveCount(0);
});

test("offers ways out when nothing is found and keeps the filters in the address", async ({
  page,
  organization,
}) => {
  const world = await searchWorld(page, organization);
  await page.goto(`/search?q=${world.word}+-contractors&spaces=${world.security.id}`);
  await expect(page.getByText(`No results for “${world.word} -contractors” in Security`)).toBeVisible();
  const results = page.getByRole("region", { name: "Results" });
  await expect(results.getByRole("button", { name: "Include archived content" })).toBeVisible();
  await expect(results.getByRole("button", { name: "Clear 1 filter" })).toBeVisible();
  await results.getByRole("button", { name: "Search all spaces" }).click();
  await expect(page.getByText("2 results")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("spaces")).toBeNull();
  await page.goBack();
  await expect(page.getByText(`No results for “${world.word} -contractors” in Security`)).toBeVisible();
});

test("finds attachments, running topics and decisions and opens each where it lives", async ({
  page,
  organization,
}) => {
  const world = await searchWorld(page, organization);
  const hits = await meetingAndFileHits(page, organization, world);
  await page.goto(`/search?q=${hits.word}`);
  const results = page.getByRole("region", { name: "Results" });
  const fileLink = results.getByRole("link", { name: `${hits.fileName} on “Restart the VPN gateway”` });
  const topicLink = results.getByRole("link", { name: hits.topicTitle });
  const decisionLink = results.getByRole("link", { name: /^Decision in “Network jour fixe/ });
  await expect(fileLink).toBeVisible();
  await expect(topicLink).toBeVisible();
  await expect(decisionLink).toBeVisible();

  const filters = page.getByRole("complementary", { name: "Filters" });
  await filters.getByRole("checkbox", { name: /Running topic/ }).click();
  await expect(topicLink).toBeVisible();
  await expect(fileLink).toHaveCount(0);
  await page.getByRole("button", { name: "Save search" }).click();
  const save = page.getByRole("dialog", { name: "Save this search" });
  await save.getByLabel("Name").fill("Gateway topics");
  await save.getByRole("button", { name: "Save search" }).click();
  await page.goto("/search");
  await filters.getByRole("link", { name: "Gateway topics" }).click();
  await expect(filters.getByRole("checkbox", { name: /Running topic/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(topicLink).toBeVisible();
  await topicLink.click();
  await expect(page.getByRole("heading", { name: hits.topicTitle, level: 1 })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(hits.topicPath);

  await page.goto(`/search?q=${hits.word}`);
  await decisionLink.click();
  await expect(page.getByRole("heading", { name: hits.topicTitle, level: 1 })).toBeVisible();

  await page.goto(`/search?q=${hits.word}`);
  await fileLink.click();
  await expect(page.getByRole("heading", { name: "Restart the VPN gateway", level: 1 })).toBeVisible();
  const drawer = page.getByRole("dialog", { name: hits.fileName });
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("attachment")).toBeNull();
});

test("the command palette matches letters in order and remembers recent commands", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "For you", level: 1 })).toBeVisible();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("opsrch");
  await expect(palette.getByRole("option", { name: "Open the search page" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(
    palette
      .getByRole("group", { name: "Recent commands" })
      .getByRole("option", { name: "Open the search page" }),
  ).toBeVisible();
});
