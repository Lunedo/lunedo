import { mkdirSync } from "node:fs";
import path from "node:path";
import { STATE_DIR } from "../support/environment.js";
import { expect, test } from "../support/fixtures.js";
import { unique } from "../support/people.js";

test.use({ instanceAdministrator: true });

test("configures a local target and a schedule, backs up now and test-restores the backup", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const target = path.join(STATE_DIR, `backup-target-${unique()}`);
  mkdirSync(target, { recursive: true });

  await page.goto("/settings/instance/backups");
  await expect(page.getByRole("heading", { name: "Backups", level: 1 })).toBeVisible();
  await expect(page.getByText("A backup cannot be restored without this key")).toBeVisible();

  const directory = page.getByRole("textbox", { name: "Directory" });
  await directory.fill(target);
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(
    page.getByText("Lunedo wrote, read, listed and deleted a test object. The target works."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save target" }).click();
  await expect(page.getByRole("button", { name: "Save target" })).toHaveCount(0);

  await page.getByRole("switch", { name: "Back up every day" }).click();
  await expect(page.getByRole("switch", { name: "Back up every day" })).toBeChecked();
  const time = page.getByRole("textbox", { name: "Time" });
  await time.fill("03:30");
  await time.press("Enter");
  await expect(page.getByText("Scheduled backups are off")).toHaveCount(0);

  await page.getByRole("button", { name: "Back up now" }).click();
  await expect(
    page.getByText("The backup has started. It appears in the list when it is done."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Manual backups" })).toBeVisible({ timeout: 120_000 });
  const actions = page.getByRole("button", { name: /^Actions for lunedo-backup-.*-manual-/ }).first();
  await expect(actions).toBeVisible();

  await actions.click();
  await page.getByRole("menuitem", { name: "Test restore" }).click();
  await expect(page.getByText(/^(Passed|Verified only)$/).first()).toBeVisible({ timeout: 120_000 });

  await actions.click();
  await page.getByRole("menuitem", { name: "Show test restore result" }).click();
  const details = page.getByRole("dialog", { name: "Test restore" });
  await expect(details.getByText("Backup is complete and readable")).toBeVisible();
});
