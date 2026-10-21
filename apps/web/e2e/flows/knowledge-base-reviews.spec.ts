import { expect, test } from "../support/fixtures.js";
import { callApi, expectAccessible } from "../support/helpers.js";
import { makeArticleDue } from "../support/jobs.js";
import { unique } from "../support/people.js";

test("an article becomes due, appears on For you, is marked as reviewed and leaves the list", async ({
  page,
  organization,
}) => {
  await page.goto("/home");
  const name = `Help ${unique()}`;
  const space = (await callApi(page, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
    name,
    key: `RV${unique()}`,
    type: "knowledgeBase",
    audience: "signedIn",
    grants: [],
  })) as { id: string; key: string };
  await callApi(page, "PUT", `/api/v1/spaces/${space.id}/knowledge-base/reviews`, { intervalMonths: 3 });
  const title = `VPN at home ${unique()}`;
  const article = (await callApi(page, "POST", `/api/v1/spaces/${space.id}/items`, {
    kind: "page",
    title,
    parentId: null,
  })) as { id: string };
  await callApi(page, "POST", `/api/v1/pages/${article.id}/publish`, {});
  await makeArticleDue(article.id);

  await page.goto("/home");
  const due = page.getByRole("region", { name: "Due for review" });
  await expect(due.getByRole("link", { name: title })).toBeVisible();
  await expect(due.getByText(/Overdue for|Due today/)).toBeVisible();
  await expectAccessible(page, "due for review on the home page");

  await page.goto(`/spaces/${space.key}/reviews`);
  const list = page.getByRole("list", { name: "Review" });
  await expect(list.getByRole("link", { name: title, exact: true })).toBeVisible();
  await expectAccessible(page, "review list");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const row = list.getByRole("listitem").filter({ hasText: title });
    for (const part of [
      row.getByText(/Overdue for|Due today/),
      row.getByRole("button", { name: `Mark as reviewed: ${title}` }),
      row.getByRole("link", { name: `Edit “${title}”` }),
    ]) {
      await expect(part).toBeInViewport({ ratio: 1 });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/home");
  await due.getByRole("button", { name: `Mark as reviewed: ${title}` }).click();
  await expect(page.getByText(`“${title}” marked as reviewed.`, { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Due for review" })).toHaveCount(0);

  await page.goto(`/spaces/${space.key}/reviews`);
  await expect(page.getByText("Nothing due in this selection")).toBeVisible();

  await page.goto(`/spaces/${space.key}/settings/reviews`);
  await expect(page.getByRole("combobox", { name: "Review interval" })).toBeVisible();
  await expectAccessible(page, "review settings");
});
