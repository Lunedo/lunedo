import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { addVirtualAuthenticator, freshTotp, signInWithPassword } from "../support/helpers.js";
import { addAuthenticator, forwardFrom, type Person, SIGNED_OUT, unique } from "../support/people.js";

test.use({ storageState: SIGNED_OUT });

async function enterPassword(page: Page, person: Person) {
  await page.goto("/sign-in");
  await signInWithPassword(page, person.email, person.password);
  await expect(page.getByRole("heading", { name: "Confirm it's you" })).toBeVisible();
}

test("refuses a wrong password", async ({ page, organization }) => {
  await page.goto("/sign-in");
  await signInWithPassword(page, organization.admin.email, "not the password");
  await expect(page.getByText(/^The password is not correct\./)).toBeVisible();
});

test("signs in with password and authenticator app", async ({ page, browser, organization }) => {
  const { secret } = await addAuthenticator(browser, organization.adminState);
  await enterPassword(page, organization.admin);
  await page.getByLabel("Code from your authenticator app").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "For you", level: 1 })).toBeVisible();
});

test("signs in with password and a recovery code", async ({ page, browser, organization }) => {
  const [code] = (await addAuthenticator(browser, organization.adminState)).recoveryCodes;
  await enterPassword(page, organization.admin);
  await page.getByRole("button", { name: "Use a recovery code" }).click();
  await page.getByLabel("Recovery code").fill(code ?? "");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "For you", level: 1 })).toBeVisible();
});

test("adds a passkey and uses it as second factor and for sign-in", async ({ browser, organization }) => {
  const { admin } = organization;
  await addAuthenticator(browser, organization.adminState);
  const context = await forwardFrom(await browser.newContext({ storageState: organization.adminState }));
  const page = await context.newPage();
  await page.goto("/settings/security");
  const removeAuthenticator = await addVirtualAuthenticator(context, page);

  await page.getByRole("button", { name: "Add passkey" }).first().click();
  const keyName = `Test key ${unique()}`;
  await page.getByLabel("Name", { exact: true }).fill(keyName);
  await page.getByRole("dialog").getByRole("button", { name: "Add passkey" }).click();
  const confirm = page.getByRole("dialog", { name: "Confirm your identity" });
  const added = page.getByText(keyName, { exact: true });
  await expect(confirm.or(added)).toBeVisible();
  if (await confirm.isVisible()) {
    await confirm.getByLabel("Password", { exact: true }).fill(admin.password);
    await confirm.getByRole("button", { name: "Confirm" }).click();
  }
  await expect(added).toBeVisible();

  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await signInWithPassword(page, admin.email, admin.password);
  await page.getByRole("button", { name: "Use a passkey" }).click();
  await page.getByRole("button", { name: "Use passkey" }).click();
  await expect(page.getByRole("heading", { name: "For you", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page.getByRole("heading", { name: "For you", level: 1 })).toBeVisible();
  await removeAuthenticator();
  await context.close();
});

test("returns to the page that was open when the session ended", async ({ browser, organization }) => {
  const { admin } = organization;
  const { secret } = await addAuthenticator(browser, organization.adminState);
  const context = await forwardFrom(await browser.newContext({ storageState: organization.adminState }));
  const page = await context.newPage();
  await page.goto("/settings/security");
  await expect(page.getByRole("heading", { name: "Sign-in and security", level: 1 })).toBeVisible();
  await context.clearCookies({ name: "__Host-lunedo-session" });
  await page.reload();
  await expect(page).toHaveURL(/\/sign-in\?/);
  expect(new URL(page.url()).searchParams.get("redirect")).toBe("/settings/security");
  await signInWithPassword(page, admin.email, admin.password);
  await page.getByLabel("Code from your authenticator app").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/settings\/security$/);
  await context.close();
});
