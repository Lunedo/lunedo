import { expect, type Page, test } from "@playwright/test";
import { OWNER_STORAGE } from "../support/environment.js";
import { CAPTURED_PART, capture, copySession, record, type Screen } from "../support/screens.js";
import { enterSetupCode, runSetupSteps, type SetupStep, setUpMail, signInOwner } from "../support/setup.js";

test.describe.configure({ mode: "serial" });

const SETUP_SCREENS: Partial<Record<SetupStep, Screen>> = {
  "setup code": {
    number: "01",
    name: "setup-first-step",
    title: "Setup assistant, first step",
    role: "signed out, holds the setup code",
    state: "setup code entry",
    language: "browser",
  },
  organization: {
    number: "01",
    name: "setup-last-step",
    title: "Setup assistant, last step",
    role: "owner during setup",
    state: "first organization",
    language: "browser",
  },
};

test("sets up the instance and captures the setup assistant", async ({ page, browser }) => {
  const shown = async (step: SetupStep, setupPage: Page) => {
    const screen = SETUP_SCREENS[step];
    if (!screen || (CAPTURED_PART ?? "screens") !== "screens") return;
    const context = await browser.newContext({ locale: "de-DE" });
    try {
      await copySession(setupPage.context(), context);
      const german = await context.newPage();
      await capture(german, screen, async (target) => {
        await target.goto("/setup");
        await expect(target.locator("#main, main").first()).toBeVisible();
      });
    } catch (error) {
      record({ kind: "failed", title: screen.title, reason: String(error).split("\n")[0] ?? "" });
    } finally {
      await context.close();
    }
  };
  await enterSetupCode(page, shown);
  await runSetupSteps(page, shown, "Olivia Brandt");
  await expect(page.getByRole("heading", { name: "For you", level: 1 })).toBeVisible();
});

test("signs in the owner", async ({ page }) => {
  await signInOwner(page);
});

test.describe("mail", () => {
  test.use({ storageState: OWNER_STORAGE });

  test("sets up e-mail delivery", async ({ page }) => {
    await setUpMail(page);
  });
});
