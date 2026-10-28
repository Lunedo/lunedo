import { mkdirSync } from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { BASE_URL } from "../support/environment.js";
import { callApi, setAppearance } from "../support/helpers.js";
import { PEOPLE, type PersonKey, personState, readWorld } from "../support/screen-world.js";
import { DEVICES, record, routeOf, SCREENS_DIR, settle } from "../support/screens.js";

const VIEWER: PersonKey = "lena";
const CO_EDITORS: { person: PersonKey; place: (page: Page) => Promise<void> }[] = [
  {
    person: "jonas",
    place: async (page) => editorContent(page).getByText("Pager", { exact: true }).selectText(),
  },
  {
    person: "aylin",
    place: async (page) =>
      editorContent(page)
        .getByText("Post a short status update every 30 minutes", { exact: true })
        .selectText(),
  },
  {
    person: "mateo",
    place: async (page) => editorContent(page).getByText("Chat, #db-help", { exact: true }).selectText(),
  },
];

const editorContent = (page: Page) => page.getByRole("textbox", { name: "Page content" });

async function contextFor(browser: Browser, person: PersonKey, time: Date): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: personState(person),
    viewport: DEVICES.desktop,
    deviceScaleFactor: 2,
    locale: "en-US",
    timezoneId: "Europe/Vienna",
    reducedMotion: "reduce",
  });
  await context.clock.setFixedTime(time);
  return context;
}

async function openEditor(page: Page, address: string): Promise<void> {
  await page.goto(`${address}?edit=true`);
  await expect(editorContent(page)).toBeEditable({ timeout: 30_000 });
}

test.afterEach(async ({ browserName: _ }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const reason = stripVTControlCharacters(testInfo.error?.message ?? "unknown error")
      .split("\n")
      .find((line) => line.trim() !== "");
    record({ kind: "failed", title: "Website start page", reason: reason ?? "unknown error" });
  }
});

test("captures the start-page picture of the website", async ({ browser }) => {
  const { engineering } = readWorld();
  const runbook = engineering.runbook;
  const contexts: BrowserContext[] = [];
  try {
    const setup = await browser.newContext({ baseURL: BASE_URL, storageState: personState(VIEWER) });
    contexts.push(setup);
    const setupPage = await setup.newPage();
    await setupPage.goto("/home");
    await setAppearance(setupPage, { language: "en" });
    await callApi(setupPage, "PUT", "/api/v1/account/preferences/appearance.sidebarCollapsedWhileEditing", {
      value: false,
    });
    const item = (await (await setupPage.request.get(`/api/v1/items/${runbook.id}`)).json()) as {
      contentUpdatedAt: string;
    };
    const time = new Date(Date.parse(item.contentUpdatedAt) + 2 * 3_600_000);

    const viewer = await contextFor(browser, VIEWER, time);
    contexts.push(viewer);
    const page = await viewer.newPage();
    await openEditor(page, runbook.path);

    for (const { person, place } of CO_EDITORS) {
      const context = await contextFor(browser, person, time);
      contexts.push(context);
      const other = await context.newPage();
      await openEditor(other, runbook.path);
      await place(other);
    }

    const coEditors = page.getByRole("list", { name: /editing/i });
    for (const { person } of CO_EDITORS) {
      await expect(coEditors.getByText(`${PEOPLE[person]} is editing`)).toBeAttached({ timeout: 20_000 });
    }
    await expect(page.locator(".ld-remote-selection")).toHaveCount(CO_EDITORS.length, { timeout: 20_000 });
    await expect(page.getByRole("tree").getByText("On-call runbook")).toBeVisible();
    await page.mouse.move(DEVICES.desktop.width - 2, DEVICES.desktop.height - 2);

    mkdirSync(path.join(SCREENS_DIR, "website"), { recursive: true });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await settle(page);
      const file = `website/hero-${theme}.png`;
      await page.screenshot({ path: path.join(SCREENS_DIR, file), animations: "disabled", caret: "hide" });
      record({
        kind: "captured",
        file,
        title: "Website start page",
        route: routeOf(page),
        role: `member (${PEOPLE[VIEWER]}), with ${CO_EDITORS.map(({ person }) => PEOPLE[person]).join(", ")} editing`,
        state: "On-call runbook in the editor, page tree open, three co-editors with their selections",
        language: "en",
        theme,
        device: "desktop",
      });
    }
  } finally {
    const reset = contexts[0];
    if (reset) {
      const resetPage = reset.pages()[0];
      if (resetPage) {
        await callApi(
          resetPage,
          "PUT",
          "/api/v1/account/preferences/appearance.sidebarCollapsedWhileEditing",
          {
            value: true,
          },
        );
      }
    }
    for (const context of contexts) await context.close();
  }
});
