import { expect, type Page } from "@playwright/test";
import { paragraph } from "../support/collaboration.js";
import { test } from "../support/fixtures.js";
import { callApi, liveUpdatesConnected } from "../support/helpers.js";
import { unique } from "../support/people.js";

test.use({ instanceAdministrator: true });

function content(page: Page) {
  return page.getByRole("textbox", { name: "Page content" });
}

async function switchOff(page: Page): Promise<void> {
  await callApi(page, "PUT", "/api/v1/instance/maintenance", { enabled: false });
}

test("an administrator switches maintenance on, a colleague can only read, and it is switched off again", async ({
  page,
  organization,
}) => {
  await page.goto("/spaces");
  const colleague = await organization.invite("Mira");
  const key = `MT${unique()}`;
  const space = (await callApi(page, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
    name: "Maintenance",
    key,
    visibility: "private",
    grants: [{ principalKind: "account", principalId: colleague.id, role: "editor" }],
  })) as { id: string };
  const created = (await callApi(page, "POST", `/api/v1/spaces/${space.id}/items`, {
    kind: "page",
    title: "Opening hours",
    parentId: null,
    mode: "live",
  })) as { id: string };
  await callApi(page, "PUT", `/api/v1/pages/${created.id}/content`, {
    document: { type: "doc", content: [paragraph("Open from nine to five.")] },
  });

  const { page: other } = await organization.signIn(colleague);
  const connected = liveUpdatesConnected(other);
  await other.goto(`/spaces/${key}/pages/${created.id}/opening-hours?edit=true`);
  await connected;
  await expect(content(other)).toHaveAttribute("contenteditable", "true");

  try {
    await page.goto("/settings/instance/maintenance");
    await page.getByRole("textbox", { name: "Message" }).fill("Update until 18:00");
    await page.getByRole("button", { name: "Switch on maintenance mode" }).click();
    await expect(page.getByText("Maintenance mode is on", { exact: true })).toBeVisible();
    await expect(page.getByText("Maintenance in progress")).toBeVisible();

    await expect(other.getByText("Maintenance in progress")).toBeVisible();
    await expect(other.getByText("Update until 18:00")).toBeVisible();
    await expect(other.getByText("Read-only during maintenance")).toBeVisible();
    await expect(content(other)).toHaveAttribute("contenteditable", "false");
    const refused = await other.request.put(`/api/v1/pages/${created.id}/content`, {
      data: { document: { type: "doc", content: [paragraph("Changed during maintenance.")] } },
      headers: { "X-Lunedo-Request": "1", origin: new URL(other.url()).origin },
    });
    expect(refused.status()).toBe(503);
    expect(((await refused.json()) as { code: string }).code).toBe("maintenanceMode");

    await page.goto("/settings/instance/status");
    await expect(page.getByRole("heading", { name: "System status", level: 1 })).toBeVisible();
    await page.locator("summary", { hasText: "In order" }).click();
    for (const check of [
      "Version",
      "Maintenance mode",
      "Database",
      "Background jobs",
      "Recent errors",
      "HTTPS",
    ]) {
      await expect(page.getByText(check, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText(/^On since .*: the instance is read-only/)).toBeVisible();

    await page.goto("/settings/instance/maintenance");
    await page.getByRole("button", { name: "Switch off maintenance mode" }).click();
    await expect(page.getByText("Maintenance mode is off", { exact: true })).toBeVisible();

    await expect(other.getByText("Maintenance in progress")).toBeHidden();
    await expect(content(other)).toHaveAttribute("contenteditable", "true");
    await content(other).locator("p").last().click();
    await other.keyboard.type(" Closed on Sundays.");
    await expect(content(other)).toContainText("Closed on Sundays.");
  } finally {
    await switchOff(page);
  }
});

test("the status page shows each check with its state and where it is fixed", async ({ page }) => {
  await page.goto("/settings/instance/status");
  await expect(page.getByRole("heading", { name: "System status", level: 1 })).toBeVisible();
  await expect(page.getByText("Need attention", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Database", { exact: true })).toBeHidden();
  await page.locator("summary", { hasText: "In order" }).click();
  await expect(page.getByText("Database", { exact: true })).toBeVisible();
  await expect(page.getByText(/^PostgreSQL /)).toBeVisible();
  await expect(page.getByRole("table", { name: "Job queues" })).toBeVisible();
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByText(/^Checked /)).toBeVisible();
});
