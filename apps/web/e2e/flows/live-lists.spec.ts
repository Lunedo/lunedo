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
    const searched = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/instance/accounts?") &&
        new URL(response.url()).searchParams.get("q") === name,
    );
    await page.getByRole("searchbox", { name: "Search by name or e-mail" }).fill(name);
    await searched;
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
