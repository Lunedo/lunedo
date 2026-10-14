import { expect, test } from "../support/fixtures.js";
import { callApi } from "../support/helpers.js";
import { meetingAndFileHits, searchWorld } from "../support/search.js";
import { sweepAppearances } from "../support/sweeps.js";

test("search screens pass the accessibility check in English and German, light and dark, wide and narrow", async ({
  page,
  organization,
}) => {
  test.slow();
  const world = await searchWorld(page, organization);
  await callApi(page, "POST", `/api/v1/organizations/${organization.id}/search/recent`, {
    query: world.word,
    filters: {},
  });
  await callApi(page, "POST", `/api/v1/organizations/${organization.id}/search/saved`, {
    name: "Runbooks to verify",
    query: "label:runbook",
    filters: { sort: "newest" },
  });
  const openQuickSearch = async () => {
    await page.goto(`/spaces/${world.operations.key}`);
    await page.getByRole("main").waitFor();
    await page.keyboard.press("/");
    await expect(page.getByRole("dialog")).toBeVisible();
  };
  await sweepAppearances(page, "quick-search-empty", async () => {
    await openQuickSearch();
    await expect(page.getByRole("option", { name: world.word })).toBeVisible();
  });
  await sweepAppearances(page, "quick-search", async () => {
    await openQuickSearch();
    await page.getByRole("dialog").getByRole("combobox").fill(world.word);
    await expect(page.getByRole("option", { name: /Restart the VPN gateway/ })).toBeVisible();
  });
  await sweepAppearances(page, "search-page", async () => {
    await page.goto(`/search?q=${world.word}&labels=runbook`);
    await expect(page.getByRole("link", { name: "Restart the VPN gateway" })).toBeVisible();
  });
  const hits = await meetingAndFileHits(page, organization, world);
  await sweepAppearances(page, "search-new-types", async () => {
    await page.goto(`/search?q=${hits.word}`);
    await expect(page.getByRole("link", { name: hits.topicTitle })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(hits.fileName) })).toBeVisible();
  });
  await sweepAppearances(page, "search-first-use", async () => {
    await page.goto("/search");
    await expect(page.getByRole("button", { name: world.word, exact: true })).toBeVisible();
  });
  await sweepAppearances(page, "search-no-results", async () => {
    await page.goto(`/search?q=${world.word}+-contractors&spaces=${world.security.id}`);
    await expect(
      page.getByRole("button", { name: /Include archived content|Archivierte Inhalte einbeziehen/ }),
    ).toBeVisible();
  });
  await sweepAppearances(page, "command-palette", async () => {
    await page.goto("/home");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog").getByRole("combobox").fill("se");
    await expect(page.getByRole("dialog").getByRole("option").first()).toBeVisible();
  });
});
