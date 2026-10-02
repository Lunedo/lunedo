import { expect, test } from "@playwright/test";
import { OWNER, OWNER_STORAGE, readState } from "../support/environment.js";
import { linkFrom, waitForMail } from "../support/helpers.js";

test.use({ storageState: OWNER_STORAGE });

const PERSON = {
  name: "Rita Reset",
  email: "rita.reset@pagehall.test",
  password: "reset passphrase for testing",
};

test("an administrator resets a member's second factor with a reason", async ({ page, browser }) => {
  const { organizationId } = readState();
  await page.goto("/settings/preferences");
  const invite = await page.request.post(`/api/v1/organizations/${organizationId}/invitations`, {
    data: { email: PERSON.email, kind: "member" },
    headers: { "X-Pagehall-Request": "1", origin: new URL(page.url()).origin },
  });
  expect(invite.status()).toBeLessThan(300);
  const link = linkFrom((await waitForMail(PERSON.email, /invit/i)).text);
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const person = await context.newPage();
  await person.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await person.getByRole("button", { name: "Accept invitation" }).click();
  await person.getByLabel("Name", { exact: true }).fill(PERSON.name);
  await person.getByLabel("Password", { exact: true }).fill(PERSON.password);
  await person.getByLabel("Repeat the password").fill(PERSON.password);
  await person.getByRole("button", { name: "Create account" }).click();
  await expect(person.getByText("Your account is ready. Sign in to start.")).toBeVisible();

  await page.goto("/settings/instance/accounts");
  await page.getByRole("searchbox", { name: "Search by name or e-mail" }).fill("Rita");
  await page.getByRole("table", { name: "Accounts" }).getByText(PERSON.name).click();
  const panel = page.getByRole("dialog", { name: PERSON.name });
  await panel.getByRole("button", { name: "Reset second factor" }).click();
  const dialog = page.getByRole("dialog", { name: `Reset the second factor of ${PERSON.name}?` });
  await dialog.getByLabel("Reason").fill("Lost phone, confirmed by call");
  await dialog.getByRole("button", { name: "Reset second factor" }).click();
  const confirm = page.getByRole("dialog", { name: "Confirm your identity" });
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.getByLabel("Password").fill(OWNER.password);
    await confirm.getByRole("button", { name: "Confirm" }).click();
  }
  await expect(page.getByText(`The second factor of ${PERSON.name} was reset.`).first()).toBeVisible();
  expect((await waitForMail(PERSON.email, /second factor/i)).text).toContain("Lost phone, confirmed by call");

  await person.goto("/sign-in");
  await person.getByLabel("E-mail").fill(PERSON.email);
  await person.getByLabel("Password", { exact: true }).fill(PERSON.password);
  await person.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(person.getByRole("heading", { name: "Set up a second factor" })).toBeVisible();
  await context.close();
});
