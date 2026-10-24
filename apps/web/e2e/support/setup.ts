import { readFileSync } from "node:fs";
import { expect, type Locator, type Page } from "@playwright/test";
import {
  ORGANIZATION_NAME,
  OWNER,
  OWNER_STORAGE,
  readState,
  SETUP_STORAGE,
  SMTP_HOST,
  SMTP_PORT,
  writeState,
} from "./environment.js";
import { expectAccessible, freshTotp, signInWithPassword, waitForMail } from "./helpers.js";
import { unique } from "./people.js";

export type SetupStep =
  | "setup code"
  | "system check"
  | "instance"
  | "owner account"
  | "second factor"
  | "recovery codes"
  | "owner ready"
  | "key backup"
  | "organization";

interface SetupStage {
  name: SetupStep;
  shown: (page: Page) => Locator;
  run: (page: Page, ownerName: string) => Promise<void>;
}

const STAGES: SetupStage[] = [
  {
    name: "system check",
    shown: (page) => page.getByRole("heading", { name: "System check" }),
    run: async (page) => {
      await expectAccessible(page, "system check");
      await page.getByRole("button", { name: "Continue" }).click();
    },
  },
  {
    name: "instance",
    shown: (page) => page.getByRole("heading", { name: "Your instance" }),
    run: async (page) => {
      await page.getByLabel("Instance name").fill("Example Wiki");
      await page.getByRole("button", { name: "Continue" }).click();
    },
  },
  {
    name: "owner account",
    shown: (page) => page.getByLabel("Repeat the password"),
    run: async (page, ownerName) => {
      await page.getByLabel("Name", { exact: true }).fill(ownerName);
      await page.getByLabel("E-mail", { exact: true }).fill(OWNER.email);
      await page.getByLabel("Password", { exact: true }).fill(OWNER.password);
      await page.getByLabel("Repeat the password").fill("something else entirely");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("The passwords do not match.")).toBeVisible();
      await page.getByLabel("Repeat the password").fill(OWNER.password);
      await page.getByRole("button", { name: "Continue" }).click();
    },
  },
  {
    name: "second factor",
    shown: (page) => page.getByText("Two-factor authentication is required"),
    run: async (page) => {
      const secret = (await page.locator("code").first().textContent())?.replace(/\s/g, "") ?? "";
      expect(secret).toMatch(/^[A-Z2-7]+$/);
      writeState({ ownerSecret: secret });
      await expect(page.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
      await page.getByLabel("Code from your authenticator app").fill("000000");
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByText("The code is not correct.")).toBeVisible();
      await page.getByLabel("Code from your authenticator app").fill(await freshTotp(secret));
      await page.getByRole("button", { name: "Confirm" }).click();
    },
  },
  {
    name: "recovery codes",
    shown: (page) => page.getByRole("list", { name: "Recovery codes" }),
    run: async (page) => {
      const codes = await page
        .getByRole("list", { name: "Recovery codes" })
        .getByRole("listitem")
        .allTextContents();
      expect(codes.length).toBeGreaterThanOrEqual(8);
      await page.getByRole("button", { name: "Continue" }).click();
    },
  },
  {
    name: "owner ready",
    shown: (page) => page.getByText("The owner account is ready"),
    run: async (page) => {
      await page.getByRole("button", { name: "Continue" }).click();
    },
  },
  {
    name: "key backup",
    shown: (page) => page.getByRole("heading", { name: "Back up your keys" }),
    run: async (page) => {
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download keys" }).click();
      expect((await download).suggestedFilename()).toBe("lunedo-keys.env");
      await expect(page.getByRole("figure", { name: "Master key and backup key" })).toContainText(
        "LUNEDO_MASTER_KEYS=",
      );
      await page.getByRole("checkbox", { name: /I stored both keys/ }).check();
      await page.getByRole("button", { name: "Continue" }).click();
    },
  },
  {
    name: "organization",
    shown: (page) => page.getByRole("heading", { name: "First organization" }),
    run: async (page) => {
      await page.getByLabel("Name", { exact: true }).fill(ORGANIZATION_NAME);
      await page.getByRole("button", { name: "Finish setup" }).click();
    },
  },
];

export type StepShown = (step: SetupStep, page: Page) => Promise<void>;

const ignore: StepShown = async () => {};

export async function setupFinished(page: Page): Promise<boolean> {
  const response = await page.request.get("/api/v1/setup");
  return response.status() === 404;
}

export async function enterSetupCode(page: Page, shown: StepShown = ignore): Promise<void> {
  const { setupCode } = readState();
  expect(setupCode).toBeTruthy();
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "Set up Lunedo" })).toBeVisible();
  await expectAccessible(page, "setup code");
  await shown("setup code", page);
  await page.getByLabel("Setup code").fill("WRONG-CODE-0000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/^The setup code is not correct or was already used\./)).toBeVisible();
  await page.goto("about:blank");
  await page.goto(`/setup#code=${setupCode ?? ""}`);
  await expect(page.getByLabel("Setup code")).toHaveValue(setupCode ?? "");
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Set up Lunedo" })).toBeHidden();
  await page.context().storageState({ path: SETUP_STORAGE });
}

export async function resumeSetup(page: Page): Promise<void> {
  const saved = JSON.parse(readFileSync(SETUP_STORAGE, "utf8")) as {
    cookies: Parameters<ReturnType<Page["context"]>["addCookies"]>[0];
  };
  await page.context().addCookies(saved.cookies);
  await page.goto("/setup");
}

export async function runSetupSteps(
  page: Page,
  shown: StepShown = ignore,
  ownerName: string = OWNER.name,
): Promise<void> {
  const signIn = page.getByRole("heading", { name: "Sign in", exact: true });
  const done: string[] = [];
  while (!(await signIn.isVisible())) {
    const any = STAGES.reduce((found, stage) => found.or(stage.shown(page)), signIn);
    await expect(any.first()).toBeVisible();
    if (await signIn.isVisible()) break;
    let stage: SetupStage | undefined;
    for (const candidate of STAGES) {
      if (!stage && (await candidate.shown(page).isVisible())) stage = candidate;
    }
    if (!stage) continue;
    expect(done, `The setup showed the ${stage.name} step twice`).not.toContain(stage.name);
    done.push(stage.name);
    await shown(stage.name, page);
    await stage.run(page, ownerName);
    await expect(stage.shown(page)).toBeHidden();
  }
}

export async function signInOwner(page: Page): Promise<void> {
  const { ownerSecret } = readState();
  expect(ownerSecret).toBeTruthy();
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expectAccessible(page, "sign-in");
  await signInWithPassword(page, OWNER.email, OWNER.password);
  await expect(page.getByRole("heading", { name: "Confirm it's you" })).toBeVisible();
  await page.getByLabel("Code from your authenticator app").fill(await freshTotp(ownerSecret ?? ""));
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page.getByRole("heading", { name: "For you", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await page.context().storageState({ path: OWNER_STORAGE });
}

export async function setUpMail(page: Page): Promise<void> {
  await page.goto("/settings/instance/general");
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
  const notConfigured = await page
    .getByText("E-mail is not set up")
    .waitFor({ state: "visible", timeout: 5000 })
    .then(
      () => true,
      () => false,
    );
  if (notConfigured) {
    await page.getByRole("link", { name: "Set up e-mail" }).click();
    await page.getByLabel("Server", { exact: true }).fill(SMTP_HOST);
    await page.getByLabel("Port").fill(String(SMTP_PORT));
    await page.getByRole("radiogroup", { name: "Security" }).getByRole("radio", { name: /None/ }).click();
    await page.getByLabel("Sender address").fill("wiki@lunedo.test");
    const recipient = `test.mail.${unique().toLowerCase()}@lunedo.test`;
    await page.getByLabel("Send a test mail to").fill(recipient);
    await page.getByRole("button", { name: "Send test mail" }).click();
    await expect(page.getByText("The mail server accepted the test mail.")).toBeVisible();
    await waitForMail(recipient, /test/i);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("SMTP settings saved. Lunedo sends through SMTP.").first()).toBeVisible();
    await page.goto("/settings/instance/general");
    await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
    await expect(page.getByText("E-mail is not set up")).toBeHidden();
  }

  const setupAgain = await page.request.get("/api/v1/setup");
  expect(setupAgain.status()).toBe(404);
}
