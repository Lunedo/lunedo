import { pagePath } from "../support/addresses.js";
import { expect, test } from "../support/fixtures.js";
import { callApi, expectAccessible } from "../support/helpers.js";
import { unique } from "../support/people.js";

test.use({ instanceAdministrator: true });

const paragraph = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

test("copies a page with its children into another space after confirming wider access", async ({
  page,
  organization,
}) => {
  const reader = await organization.invite("Rita");
  await page.goto("/spaces");
  const boardKey = `BD${unique()}`;
  const board = (await callApi(page, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
    name: "Board",
    key: boardKey,
    visibility: "private",
    grants: [],
  })) as { id: string };
  const handbookKey = `HB${unique()}`;
  await callApi(page, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
    name: "Team Handbook",
    key: handbookKey,
    visibility: "organization",
    grants: [{ principalKind: "organizationMembers", principalId: null, role: "reader" }],
  });
  const budget = (await callApi(page, "POST", `/api/v1/spaces/${board.id}/items`, {
    kind: "page",
    title: "Budget",
    parentId: null,
    mode: "live",
  })) as { id: string; number: number; title: string };
  await callApi(page, "PUT", `/api/v1/pages/${budget.id}/content`, { document: paragraph("Plan for 2027") });
  const numbers = (await callApi(page, "POST", `/api/v1/spaces/${board.id}/items`, {
    kind: "page",
    title: "Q1 numbers",
    parentId: budget.id,
    mode: "live",
  })) as { id: string };
  await callApi(page, "PUT", `/api/v1/pages/${numbers.id}/content`, { document: paragraph("Travel 4,000") });

  await page.goto(pagePath(boardKey, budget));
  const tree = page.getByRole("tree", { name: "Page tree" });
  const source = tree.getByRole("treeitem", { name: "Budget" });
  await source.getByRole("button", { name: "Actions for Budget" }).click();
  await page.getByRole("menuitem", { name: "Copy…" }).click();
  const dialog = page.getByRole("dialog", { name: "Copy Budget" });
  await dialog.getByRole("combobox", { name: "Space" }).click();
  await page.getByRole("option", { name: /Team Handbook/ }).click();
  await dialog.getByRole("checkbox", { name: "Copy the pages below as well" }).click();
  const access = dialog.getByRole("region", { name: "Who can open the copy" });
  await expect(access.getByText("2 items are created.")).toBeVisible();
  await expect(access.getByText(/can open the copy but not the original/)).toBeVisible();
  await expect(access.getByText(new RegExp(reader.name))).toBeVisible();
  await expectAccessible(page, "copy dialog");

  await dialog.getByRole("button", { name: "Copy to Team Handbook" }).click();
  const confirm = dialog.getByRole("checkbox", { name: "I want these people to be able to open the copy" });
  await expect(confirm).toBeFocused();
  await confirm.click();
  await dialog.getByRole("button", { name: "Copy to Team Handbook" }).click();

  await expect(page.getByText("Budget copied to Team Handbook").first()).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/spaces/${handbookKey}/pages/`));
  await expect(page.getByRole("heading", { name: "Budget", level: 1 })).toBeVisible();
  await expect(page.getByText("Plan for 2027")).toBeVisible();
  const copiedTree = page.getByRole("tree", { name: "Page tree" });
  await copiedTree.getByRole("treeitem", { name: "Budget" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(copiedTree.getByRole("treeitem", { name: "Q1 numbers" })).toBeVisible();
});
