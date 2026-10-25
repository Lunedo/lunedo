import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, type Locator, type Page } from "@playwright/test";
import { Secret, TOTP } from "otpauth";
import { MAILPIT_URL, readState, writeState } from "./environment.js";

const TOTP_PERIOD_MS = 30_000;

export async function freshTotp(secret: string): Promise<string> {
  for (;;) {
    const now = Date.now();
    const current = Math.floor(now / TOTP_PERIOD_MS);
    const used = readState().totpSteps?.[secret] ?? Number.NEGATIVE_INFINITY;
    const secondsLeft = (TOTP_PERIOD_MS - (now % TOTP_PERIOD_MS)) / 1000;
    const step = [current - 1, current, current + 1].find(
      (candidate) => candidate > used && (candidate >= current || secondsLeft >= 3),
    );
    if (step !== undefined) {
      writeState({ totpSteps: { ...readState().totpSteps, [secret]: step } });
      return TOTP.generate({
        secret: Secret.fromBase32(secret.replace(/\s/g, "")),
        timestamp: step * TOTP_PERIOD_MS,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

interface MailpitMessage {
  ID: string;
  To: { Address: string }[];
  Subject: string;
}

export async function waitForMail(
  to: string,
  subject: RegExp,
  timeoutMs = 30_000,
): Promise<{ text: string }> {
  const deadline = Date.now() + timeoutMs;
  let subjects: string[] = [];
  while (Date.now() < deadline) {
    const response = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    if (response.ok) {
      const result = (await response.json()) as { messages: MailpitMessage[] };
      subjects = result.messages.map((candidate) => candidate.Subject);
      const message = result.messages.find((candidate) => subject.test(candidate.Subject));
      if (message) {
        const detail = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)).json()) as {
          Text: string;
        };
        return { text: detail.Text };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `No mail to ${to} matching ${subject} arrived in Mailpit (${MAILPIT_URL}) within ${timeoutMs / 1000} s. ` +
      (subjects.length > 0
        ? `Mails to this address have other subjects: ${subjects.join(" | ")}`
        : "No mail to this address arrived at all; check that the worker delivers mail."),
  );
}

export function linkFrom(text: string): string {
  const match = /(https?:\/\/\S+#token=[\w-]+)/.exec(text);
  if (!match?.[1]) throw new Error("The mail contains no link with a token");
  return match[1];
}

export async function addVirtualAuthenticator(
  context: BrowserContext,
  page: Page,
): Promise<() => Promise<void>> {
  const session = await context.newCDPSession(page);
  await session.send("WebAuthn.enable");
  const { authenticatorId } = await session.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return async () => {
    await session.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  };
}

export async function expectAccessible(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const violations = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(" ")).slice(0, 5),
  }));
  expect(violations, `${label}: accessibility violations`).toEqual([]);
}

export async function setAppearance(
  page: Page,
  appearance: {
    colorMode?: "light" | "dark";
    highContrast?: boolean;
    textSize?: number;
    language?: "en" | "de";
  },
): Promise<void> {
  const put = async (key: string, value: unknown) => {
    const response = await page.request.put(`/api/v1/account/preferences/${key}`, {
      data: { value },
      headers: { "X-Lunedo-Request": "1", origin: new URL(page.url()).origin },
    });
    expect(response.status(), key).toBe(204);
  };
  if (appearance.colorMode) await put("appearance.colorMode", appearance.colorMode);
  if (appearance.highContrast !== undefined) await put("appearance.highContrast", appearance.highContrast);
  if (appearance.textSize !== undefined) await put("appearance.textSize", appearance.textSize);
  if (appearance.language !== undefined) await put("locale.language", appearance.language);
}

export async function signInWithPassword(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Work e-mail address or sign-in name").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

export function liveUpdatesConnected(page: Page): Promise<unknown> {
  return page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/v1/notifications/stream" && response.ok(),
  );
}

export async function callApi(
  page: Page,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  data?: unknown,
) {
  const response = await page.request.fetch(path, {
    method,
    ...(data === undefined ? {} : { data }),
    headers: { "X-Lunedo-Request": "1", origin: new URL(page.url()).origin },
  });
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBeLessThan(300);
  return response.status() === 204 ? null : ((await response.json()) as unknown);
}

export async function openSettingsArea(
  page: Page,
  area: "My account" | "Organization" | "Instance",
): Promise<void> {
  if (area === "My account") {
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await page.getByRole("menuitem", { name: "Profile" }).click();
  } else {
    const gear = page.getByRole("button", { name: "Settings", exact: true });
    const menu = (await gear.getAttribute("aria-haspopup")) === "menu";
    await gear.click();
    if (menu) await page.getByRole("menuitem", { name: area }).click();
    await expect(page).toHaveURL(
      area === "Instance" ? /\/settings\/instance\// : /\/settings\/organizations\//,
    );
  }
  await expect(page.getByRole("navigation", { name: "Settings", exact: true })).toBeVisible();
}

export async function chooseDate(page: Page, trigger: Locator, isoDate: string): Promise<void> {
  await trigger.click();
  const day = page.locator(`[data-date="${isoDate}"]`);
  for (let step = 0; step < 240 && (await day.count()) === 0; step += 1) {
    await page.getByRole("button", { name: /^(Next month|Nächster Monat)$/ }).click();
  }
  await day.click();
}

export async function chooseTime(page: Page, combobox: Locator, time: string): Promise<void> {
  await combobox.fill(time);
  await page.getByRole("option", { name: time, exact: true }).click();
}
