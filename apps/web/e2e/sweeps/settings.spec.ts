import { expect, test } from "../support/fixtures.js";
import { expectAccessible, setAppearance } from "../support/helpers.js";

test.use({ instanceAdministrator: true });

for (const appearance of [
  { name: "light", colorMode: "light" as const, highContrast: false, textSize: 1 },
  { name: "dark", colorMode: "dark" as const, highContrast: false, textSize: 1 },
  { name: "high contrast", colorMode: "light" as const, highContrast: true, textSize: 1 },
  { name: "smallest text", colorMode: "light" as const, highContrast: false, textSize: 0.875 },
  { name: "largest text", colorMode: "dark" as const, highContrast: true, textSize: 1.25 },
  { name: "German", colorMode: "light" as const, highContrast: false, textSize: 1, language: "de" as const },
  {
    name: "German at the largest text",
    colorMode: "dark" as const,
    highContrast: false,
    textSize: 1.25,
    language: "de" as const,
  },
]) {
  test(`has no accessibility violations in ${appearance.name}`, async ({ page, organization }) => {
    await page.goto("/settings/preferences");
    await setAppearance(page, appearance);
    for (const path of [
      "/settings/profile",
      "/settings/preferences",
      "/settings/security",
      "/settings/notifications",
    ]) {
      await page.goto(path);
      await expect(page.locator("#main h1")).toBeVisible();
      await expectAccessible(page, `${path} in ${appearance.name}`);
    }
    const organizationId = organization.id;
    for (const screen of ["members", "groups", "roles", "security", "audit-log"]) {
      await page.goto(`/settings/organizations/${organizationId}/${screen}`);
      await expect(page.locator("#main h1")).toBeVisible();
      await expectAccessible(page, `${screen} in ${appearance.name}`);
    }
    for (const screen of ["general", "organizations", "mail", "break-glass"]) {
      await page.goto(`/settings/instance/${screen}`);
      await expect(page.locator("#main h1")).toBeVisible();
      await expectAccessible(page, `instance ${screen} in ${appearance.name}`);
    }
    await setAppearance(page, { colorMode: "light", highContrast: false, textSize: 1, language: "en" });
  });
}

for (const language of ["en", "de"] as const) {
  test(`works on a phone without horizontal scrolling in ${language}`, async ({ page, organization }) => {
    await page.goto("/settings/preferences");
    await setAppearance(page, { language, textSize: 1.25 });
    await page.setViewportSize({ width: 375, height: 740 });
    const organizationId = organization.id;
    for (const path of [
      "/settings/profile",
      "/settings/preferences",
      "/settings/security",
      "/settings/notifications",
      `/settings/organizations/${organizationId}/members`,
      `/settings/organizations/${organizationId}/security`,
      `/settings/organizations/${organizationId}/audit-log`,
      "/settings/instance/security",
    ]) {
      await page.goto(path);
      await expect(page.locator("#main h1")).toBeVisible();
      await expect(
        page.getByRole("combobox", {
          name: language === "en" ? "Settings section" : "Bereich der Einstellungen",
        }),
      ).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
      const outsideTheirCard = await page.evaluate(() =>
        [...document.querySelectorAll("#main section [data-setting-control] > *")]
          .filter((element) => {
            const card = element.closest("section")?.getBoundingClientRect();
            const box = element.getBoundingClientRect();
            return card !== undefined && (box.right > card.right + 1 || box.left < card.left - 1);
          })
          .map((element) => element.textContent?.trim()),
      );
      expect(outsideTheirCard, path).toEqual([]);
    }
    const width = 375;
    const de = language === "de";
    await page.goto(`/settings/organizations/${organizationId}/roles`);
    await page.getByRole("button", { name: de ? "Rolle anlegen" : "Create role" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox && dialogBox.x + dialogBox.width).toBeLessThanOrEqual(width);
    expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(
      0,
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: de ? /^Benachrichtigungen(,|$)/ : /^Notifications(,|$)/ }).click();
    const close = page.getByRole("button", {
      name: de ? "Benachrichtigungen schließen" : "Close notifications",
    });
    const closeBox = await close.boundingBox();
    expect(closeBox && closeBox.x + closeBox.width).toBeLessThanOrEqual(width);
    await close.click();
    await setAppearance(page, { language: "en", textSize: 1 });
  });
}
