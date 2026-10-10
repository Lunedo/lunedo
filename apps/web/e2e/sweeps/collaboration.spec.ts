import { collaborationSpace, commentOnVpnPage, publishedPost, vpnPage } from "../support/collaboration.js";
import { expect, test } from "../support/fixtures.js";
import { callApi, expectAccessible } from "../support/helpers.js";
import { screenshot, sweepAppearances, WIDTHS } from "../support/sweeps.js";

test("the comments panel passes the accessibility check wide and narrow", async ({ page, organization }) => {
  const space = await collaborationSpace(page, organization);
  const { id: pageId, path: pagePath } = await vpnPage(page, space);
  await commentOnVpnPage(page, pageId);
  const { page: other } = await organization.signIn(space.colleague);
  await other.goto(pagePath);
  await other.getByRole("button", { name: /Comments/ }).click();
  await expect(
    other.getByRole("complementary", { name: "Comments" }).getByText("Happened twice this week."),
  ).toBeVisible();
  for (const width of WIDTHS) {
    await other.setViewportSize({ width, height: 900 });
    await expectAccessible(other, `comments panel at ${width}`);
    await screenshot(other, `comments-panel-${width}.png`);
  }
});

test("new screens pass the accessibility check in English and German, light and dark, wide and narrow", async ({
  page,
  organization,
}) => {
  test.slow();
  const space = await collaborationSpace(page, organization);
  const { id: pageId, path: pagePath } = await vpnPage(page, space);
  await commentOnVpnPage(page, pageId);
  const postId = await publishedPost(page, space);
  await callApi(page, "PUT", `/api/v1/organizations/${organization.id}/blog/pinned/${postId}`, {
    pinned: true,
  });
  const post = /New VPN client from Monday/;
  await sweepAppearances(page, "page-with-comments", async () => {
    await page.goto(pagePath);
    await expect(page.getByText("Hotel Wi-Fi blocks UDP on port 51820.")).toBeVisible();
  });
  await sweepAppearances(page, "space-blog", async () => {
    await page.goto(`/spaces/${space.key}/blog`);
    await expect(page.getByRole("link", { name: post }).first()).toBeVisible();
  });
  await sweepAppearances(page, "organization-blog", async () => {
    await page.goto("/blog");
    await expect(page.getByRole("link", { name: post }).first()).toBeVisible();
  });
  await sweepAppearances(page, "my-tasks", async () => {
    await page.goto("/tasks");
    await expect(page.getByText(/^(No open tasks|Keine offenen Aufgaben)$/)).toBeVisible();
  });
  await sweepAppearances(page, "for-you", async () => {
    await page.goto("/home");
    await expect(page.getByRole("main").getByText("New VPN client from Monday").first()).toBeVisible();
  });
});
