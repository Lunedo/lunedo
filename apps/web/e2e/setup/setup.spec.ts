import { expect, test } from "@playwright/test";
import {
  ORGANIZATION_NAME,
  OWNER,
  OWNER_STORAGE,
  readState,
  SMTP_HOST,
  SMTP_PORT,
  writeState,
} from "../support/environment.js";
import { expectAccessible, freshTotp, signInWithPassword, waitForMail } from "../support/helpers.js";

test.describe.configure({ mode: "serial" });

test("sets up a fresh instance and signs in the owner with a second factor", async ({ page }) => {
  const { setupCode } = readState();
  expect(setupCode).toBeTruthy();

  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "Set up Pagehall" })).toBeVisible();
  await expectAccessible(page, "setup code");
  await page.getByLabel("Setup code").fill("WRONG-CODE-0000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("The setup code is not correct.")).toBeVisible();
  await page.goto("about:blank");
  await page.goto(`/setup#code=${setupCode ?? ""}`);
  await expect(page.getByLabel("Setup code")).toHaveValue(setupCode ?? "");
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "System check" })).toBeVisible();
  await expectAccessible(page, "system check");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Your instance" })).toBeVisible();
  await page.getByLabel("Instance name").fill("Example Wiki");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Owner account" })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill(OWNER.name);
  await page.getByLabel("E-mail", { exact: true }).fill(OWNER.email);
  await page.getByLabel("Password", { exact: true }).fill(OWNER.password);
  await page.getByLabel("Repeat the password").fill("something else entirely");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("The passwords do not match.")).toBeVisible();
  await page.getByLabel("Repeat the password").fill(OWNER.password);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Two-factor authentication is required")).toBeVisible();
  const secret = (await page.locator("code").first().textContent())?.replace(/\s/g, "") ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+$/);
  await expect(page.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
  await page.getByLabel("Code from your authenticator app").fill("000000");
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("The code is not correct.")).toBeVisible();
  await page.getByLabel("Code from your authenticator app").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("list", { name: "Recovery codes" })).toBeVisible();
  const codes = await page
    .getByRole("list", { name: "Recovery codes" })
    .getByRole("listitem")
    .allTextContents();
  expect(codes.length).toBeGreaterThanOrEqual(8);
  writeState({ ownerSecret: secret, ownerRecoveryCodes: codes });
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Back up your keys" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download keys" }).click();
  expect((await download).suggestedFilename()).toBe("pagehall-keys.env");
  await expect(page.getByRole("figure", { name: "Master key and backup key" })).toContainText(
    "PAGEHALL_MASTER_KEYS=",
  );
  await page.getByRole("checkbox", { name: /I stored both keys/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "First organization" })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill(ORGANIZATION_NAME);
  await page.getByRole("button", { name: "Finish setup" }).click();

  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: `Sign in to ${ORGANIZATION_NAME}` })).toBeVisible();
  await expect(page.getByText("Example Wiki")).toBeVisible();
  await expectAccessible(page, "sign-in");
  await signInWithPassword(page, OWNER.email, OWNER.password);
  await expect(page.getByRole("heading", { name: "Confirm it's you" })).toBeVisible();
  await page.getByLabel("Code from your authenticator app").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page.getByRole("heading", { name: "Preferences" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await page.context().storageState({ path: OWNER_STORAGE });

  await page.goto("/settings/instance/general");
  await expect(page.getByText("E-mail is not set up")).toBeVisible();
  await page.getByRole("link", { name: "Set up e-mail" }).click();
  await page.getByLabel("Server", { exact: true }).fill(SMTP_HOST);
  await page.getByLabel("Port").fill(String(SMTP_PORT));
  await page.getByRole("radiogroup", { name: "Security" }).getByRole("radio", { name: /None/ }).click();
  await page.getByLabel("Sender address").fill("wiki@pagehall.test");
  await page.getByLabel("Send a test mail to").fill(OWNER.email);
  await page.getByRole("button", { name: "Send test mail" }).click();
  await expect(page.getByText("The mail server accepted the test mail.")).toBeVisible();
  await waitForMail(OWNER.email, /test/i);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("SMTP settings saved. Pagehall sends through SMTP.").first()).toBeVisible();
  await page.goto("/settings/instance/general");
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
  await expect(page.getByText("E-mail is not set up")).toBeHidden();

  const setupAgain = await page.request.get("/api/v1/setup");
  expect(setupAgain.status()).toBe(404);
});
