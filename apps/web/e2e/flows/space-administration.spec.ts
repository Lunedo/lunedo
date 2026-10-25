import { expect, test } from "../support/fixtures.js";
import { callApi } from "../support/helpers.js";
import { unique } from "../support/people.js";

test("an organization administrator becomes space admin with a reason and the space admin learns why", async ({
  page,
  organization,
}) => {
  const owner = await organization.invite("Mia");
  const { page: ownerPage } = await organization.signIn(owner);
  const key = `SA${unique()}`;
  await callApi(ownerPage, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
    name: `Field notes ${key}`,
    key,
    visibility: "private",
    grants: [],
  });

  await page.goto(`/settings/organizations/${organization.id}/spaces`);
  await page.getByRole("searchbox", { name: "Name or key" }).fill(key);
  await page.getByRole("button", { name: `Actions for Field notes ${key}` }).click();
  await page.getByRole("menuitem", { name: "Become space admin …" }).click();
  const dialog = page.getByRole("dialog", { name: `Become space admin of Field notes ${key}` });
  await dialog.getByRole("button", { name: "Become space admin" }).click();
  await expect(dialog.getByText(/Name the reason/)).toBeVisible();
  await expect(dialog.getByLabel("Reason")).toBeFocused();
  await dialog.getByLabel("Reason").fill("The team asked for help with its permissions");
  await dialog.getByRole("button", { name: "Become space admin" }).click();
  await expect(page.getByText(`You are now space admin of Field notes ${key}.`).first()).toBeVisible();
  await page.getByRole("button", { name: "Open space" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${key}`));

  await ownerPage.goto("/notifications");
  await expect(
    ownerPage.getByText(/became space admin of Field notes .* The team asked for help with its permissions/),
  ).toBeVisible();

  await page.goto(`/settings/organizations/${organization.id}/spaces`);
  await page.getByRole("tab", { name: "Clean up" }).click();
  await expect(page.getByRole("heading", { name: "Spaces without active members" })).toBeVisible();
  await expect(page.getByText("Waiting period before clean-up")).toBeVisible();
});
