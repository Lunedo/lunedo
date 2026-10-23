import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { type BrowserContext, expect, type Page } from "@playwright/test";
import { STATE_DIR } from "./environment.js";
import { setAppearance } from "./helpers.js";

export const SCREENS_DIR = process.env.LUNEDO_SCREENS_DIR ?? path.join(STATE_DIR, "screens");
export const CAPTURE_LOG = path.join(SCREENS_DIR, "capture.jsonl");

export const DEVICES = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;

export type Device = keyof typeof DEVICES;
export type Language = "de" | "en";
export type Theme = "light" | "dark";

export interface Screen {
  number: string;
  name: string;
  title: string;
  role: string;
  state: string;
  phone?: boolean;
  english?: boolean;
  fullPage?: boolean;
  language?: "account" | "browser" | "content";
}

export interface CapturedEntry {
  kind: "captured";
  file: string;
  title: string;
  route: string;
  role: string;
  state: string;
  language: Language;
  theme: Theme;
  device: Device;
}

export interface FailedEntry {
  kind: "failed";
  title: string;
  reason: string;
}

export type CaptureEntry = CapturedEntry | FailedEntry;

export function record(entry: CaptureEntry): void {
  mkdirSync(SCREENS_DIR, { recursive: true });
  appendFileSync(CAPTURE_LOG, `${JSON.stringify(entry)}\n`);
}

export function routeOf(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    "{id}",
  );
}

const LOADING = '[aria-busy="true"], .animate-spin, .animate-pulse';

export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("load");
  await expect(page.locator(LOADING), "Something on the screen is still loading").toHaveCount(0, {
    timeout: 30_000,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(
    () =>
      Array.from(document.images).every(
        (image) => image.complete && (image.naturalWidth > 0 || image.getAttribute("src") === null),
      ),
    undefined,
    { timeout: 30_000 },
  );
  const toasts = page.locator('li[role="status"][data-state="open"]');
  await expect(toasts)
    .toHaveCount(0, { timeout: 10_000 })
    .catch(async () => {
      for (const toast of await toasts.all()) await toast.locator("button[aria-label]").last().click();
    });
  await page.waitForTimeout(300);
}

async function shoot(page: Page, file: string, fullPage: boolean): Promise<void> {
  const viewport = page.viewportSize();
  const hidden = fullPage
    ? await page.evaluate(() => {
        const main = document.querySelector("#main");
        return main ? main.scrollHeight - main.clientHeight : 0;
      })
    : 0;
  const grow = viewport !== null && hidden > 0;
  if (grow) await page.setViewportSize({ ...viewport, height: viewport.height + hidden });
  try {
    await settle(page);
    await page.screenshot({ fullPage, path: path.join(SCREENS_DIR, file), animations: "disabled" });
  } finally {
    if (grow) await page.setViewportSize(viewport);
  }
}

export async function applyLanguage(page: Page, screen: Screen, language: Language): Promise<void> {
  const mode = screen.language ?? "account";
  if (mode === "content") return;
  if (page.url() === "about:blank") await page.goto("/sign-in");
  if (mode === "account") {
    await setAppearance(page, { language });
    return;
  }
  await page.evaluate((value) => localStorage.setItem("lunedo.language", value), language);
}

export async function capture(
  page: Page,
  screen: Screen,
  open: (page: Page, language: Language, device: Device) => Promise<void>,
): Promise<void> {
  const languages: Language[] = screen.english ? ["de", "en"] : ["de"];
  const devices: Device[] = screen.phone ? ["desktop", "phone"] : ["desktop"];
  for (const language of languages) {
    await applyLanguage(page, screen, language);
    for (const device of devices) {
      await page.setViewportSize(DEVICES[device]);
      await page.emulateMedia({ colorScheme: "light" });
      await open(page, language, device);
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        const file = `${screen.number}-${screen.name}-${language}-${theme}-${device}.png`;
        await shoot(page, file, screen.fullPage ?? true);
        record({
          kind: "captured",
          file,
          title: screen.title,
          route: routeOf(page),
          role: screen.role,
          state: screen.state,
          language,
          theme,
          device,
        });
      }
    }
  }
}

export async function copySession(from: BrowserContext, to: BrowserContext): Promise<void> {
  await to.addCookies(await from.cookies());
}
