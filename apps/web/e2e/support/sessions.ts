import { type Browser, expect, type Page } from "@playwright/test";
import { liveUpdatesConnected, signInWithPassword } from "./helpers.js";
import { forwardFrom, type Person, SIGNED_OUT, type StorageState } from "./people.js";

export async function watcher(browser: Browser, storageState: StorageState, path: string): Promise<Page> {
  const context = await forwardFrom(await browser.newContext({ storageState }));
  const page = await context.newPage();
  const connected = liveUpdatesConnected(page);
  await page.goto(path);
  await connected;
  return page;
}

export async function secondSession(browser: Browser, person: Person): Promise<Page> {
  const context = await forwardFrom(await browser.newContext({ storageState: SIGNED_OUT }));
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signInWithPassword(page, person.email, person.password);
  await expect(page.getByRole("heading", { name: "For you", level: 1 })).toBeVisible();
  return page;
}
