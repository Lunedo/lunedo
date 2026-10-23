import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { OWNER_STORAGE, SETUP_STORAGE } from "../support/environment.js";
import {
  enterSetupCode,
  resumeSetup,
  runSetupSteps,
  setUpMail,
  setupFinished,
  signInOwner,
} from "../support/setup.js";

test.describe.configure({ mode: "serial" });

test("sets up a fresh instance", async ({ page }) => {
  test.skip(await setupFinished(page), "An earlier attempt finished the setup.");
  if (existsSync(SETUP_STORAGE)) await resumeSetup(page);
  else await enterSetupCode(page);

  await runSetupSteps(page);

  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByText("Example Wiki")).toBeVisible();
  expect(await setupFinished(page)).toBe(true);
});

test("signs in the owner with a second factor", async ({ page }) => {
  test.skip(existsSync(OWNER_STORAGE), "An earlier attempt already signed in the owner.");
  await signInOwner(page);
});

test.describe("e-mail", () => {
  test.use({ storageState: OWNER_STORAGE });

  test("sets up e-mail delivery for the instance", async ({ page }) => {
    await setUpMail(page);
  });
});
