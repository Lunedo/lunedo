import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { callApi, expectAccessible } from "../support/helpers.js";
import { forwardFrom, SIGNED_OUT } from "../support/people.js";
import { createPortal, waitForIndex } from "../support/portal.js";
import { screenshot, sweepAppearances, WIDTHS } from "../support/sweeps.js";

const MODES = [
  { colorScheme: "light", language: "en" },
  { colorScheme: "dark", language: "de" },
] as const;

async function sweep(page: Page, name: string, path: string) {
  for (const mode of MODES) {
    await page.emulateMedia({ colorScheme: mode.colorScheme });
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      await expectAccessible(page, `${name} (${mode.colorScheme}, ${width})`);
      await screenshot(page, `portal-${name}-${mode.colorScheme}-${mode.language}-${width}.png`);
    }
  }
}

test("the portal screens pass the review in both themes, wide and narrow", async ({
  page,
  browser,
  baseURL,
  organization,
}) => {
  test.slow();
  await page.goto("/");
  const publicPortal = await createPortal(page, {
    audience: "public",
    organizationId: organization.id,
    name: "Help center of Example Media",
  });
  const closed = await createPortal(page, { audience: "signedIn", organizationId: organization.id });
  await waitForIndex(page, publicPortal, "VPN");
  for (let index = 0; index < 3; index += 1) await page.goto(`${publicPortal.path}/search?q=vpn`);
  const howTo = publicPortal.articles[0];
  const trouble = publicPortal.articles[1];
  if (!howTo || !trouble) throw new Error("no articles");
  const context = await forwardFrom(await browser.newContext({ baseURL, storageState: SIGNED_OUT }));
  const reader = await context.newPage();
  for (const language of ["en", "de"] as const) {
    await callApi(page, "PUT", `/api/v1/organizations/${organization.id}/settings/locale.language`, {
      value: language,
    });
    const modes = MODES.filter((mode) => mode.language === language);
    for (const mode of modes) {
      const screens: [string, string][] = [
        ["start", `${publicPortal.path}/`],
        ["category", `${publicPortal.path}/topics/${publicPortal.categories.IT}`],
        ["topic", `${publicPortal.path}/topics/${publicPortal.categories["Remote access"]}`],
        ["contact", `${publicPortal.path}/contact`],
        ["how-to", `${publicPortal.path}/${howTo.address}`],
        ["troubleshooting", `${publicPortal.path}/${trouble.address}`],
        ["search", `${publicPortal.path}/search?q=vpn`],
        ["no-results", `${publicPortal.path}/search?q=parking%20permit`],
        ["not-found", `${publicPortal.path}/99999-missing`],
        ["sign-in", `${closed.path}/`],
        ["signed-out", `${publicPortal.path}/signed-out`],
      ];
      for (const [name, path] of screens) {
        await reader.emulateMedia({ colorScheme: mode.colorScheme });
        for (const width of WIDTHS) {
          await reader.setViewportSize({ width, height: 900 });
          await reader.goto(path);
          await reader.evaluate(() => document.fonts.ready);
          await expectAccessible(reader, `portal ${name} (${mode.colorScheme}, ${width})`);
          await screenshot(reader, `portal-${name}-${mode.colorScheme}-${mode.language}-${width}.png`);
        }
      }
    }
  }
  await sweep(page, "article-editor", `${publicPortal.path}/${howTo.address}`);
  await expect(page.getByRole("link", { name: /Edit|Bearbeiten/ })).toBeVisible();
  await context.close();
});

test.describe("as an instance administrator", () => {
  test.use({ instanceAdministrator: true });

  test("the portal settings pass the review in both languages and themes, wide and narrow", async ({
    page,
    organization,
  }) => {
    test.slow();
    await page.goto("/");
    const portal = await createPortal(page, { audience: "public", organizationId: organization.id });
    await sweepAppearances(page, "portal-address", async () => {
      await page.goto(`/spaces/${portal.spaceKey}/settings/address`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
    await sweepAppearances(page, "portal-appearance", async () => {
      await page.goto(`/spaces/${portal.spaceKey}/settings/appearance`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
    await sweepAppearances(page, "portal-instance", async () => {
      await page.goto("/settings/instance/portals");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  });
});
