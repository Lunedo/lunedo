import { type Page, test } from "@playwright/test";
import { expectAccessible, setAppearance } from "./helpers.js";

export const APPEARANCES = [
  { colorMode: "light", language: "en" },
  { colorMode: "dark", language: "de" },
] as const;

export const WIDTHS = [1440, 390] as const;

export async function screenshot(page: Page, file: string): Promise<void> {
  const viewport = page.viewportSize();
  const hidden = await page.evaluate(() => {
    const main = document.querySelector("#main");
    return main ? main.scrollHeight - main.clientHeight : 0;
  });
  if (viewport && hidden > 0) await page.setViewportSize({ ...viewport, height: viewport.height + hidden });
  await page.screenshot({ fullPage: true, path: test.info().outputPath(file) });
  if (viewport && hidden > 0) await page.setViewportSize(viewport);
  await test.info().attach(file, { path: test.info().outputPath(file), contentType: "image/png" });
}

export async function sweepAppearances(page: Page, name: string, open: () => Promise<void>): Promise<void> {
  for (const appearance of APPEARANCES) {
    await setAppearance(page, appearance);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await open();
      await page.evaluate(() => document.fonts.ready);
      await expectAccessible(page, `${name} (${appearance.colorMode}, ${appearance.language}, ${width})`);
      await screenshot(page, `${name}-${appearance.colorMode}-${appearance.language}-${width}.png`);
    }
  }
  await setAppearance(page, APPEARANCES[0]);
  await page.setViewportSize({ width: 1280, height: 900 });
}
