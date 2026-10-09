import { expect, test } from "../support/fixtures.js";
import { callApi } from "../support/helpers.js";
import { secondSession, watcher } from "../support/sessions.js";

test.use({ instanceAdministrator: true });

test("shows an account created in another session without a reload", async ({ browser, organization }) => {
  const page = await watcher(browser, organization.adminState, "/settings/instance/accounts");
  await expect(page.getByRole("heading", { name: "Accounts", level: 1 })).toBeVisible();
  const other = await secondSession(browser, organization.admin);
  try {
    const name = `Live Placeholder ${Date.now()}`;
    await callApi(other, "POST", "/api/v1/instance/accounts/placeholders", {
      name,
      email: `live-${Date.now()}@import.test`,
    });
    await expect(page.getByRole("table").getByText(name)).toBeVisible();
  } finally {
    await other.context().close();
    await page.context().close();
  }
});
