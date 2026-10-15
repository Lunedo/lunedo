import { collaborationSpace, commentOnVpnPage, vpnPage } from "../support/collaboration.js";
import { expect, test } from "../support/fixtures.js";
import { callApi, expectAccessible, setAppearance } from "../support/helpers.js";
import { screenshot, sweepAppearances, WIDTHS } from "../support/sweeps.js";

test("watching and notification settings pass the accessibility check in every appearance", async ({
  page,
  organization,
}) => {
  test.slow();
  const space = await collaborationSpace(page, organization);
  const { id: pageId, path: pagePath } = await vpnPage(page, space);
  await commentOnVpnPage(page, pageId);
  await callApi(page, "PUT", `/api/v1/spaces/${space.id}/watch`, { state: "muted", keepActionable: true });
  await sweepAppearances(page, "notification-settings", async () => {
    await page.goto("/settings/notifications");
    await expect(page.getByRole("list", { name: /^(Events|Ereignisse)$/ })).toBeVisible();
  });
  await sweepAppearances(page, "watched-items", async () => {
    await page.goto("/settings/notifications/watching");
    await expect(page.getByRole("list").first()).toBeVisible();
  });
  await sweepAppearances(page, "organization-notification-defaults", async () => {
    await page.goto(`/settings/organizations/${organization.id}/notifications`);
    await expect(page.getByRole("list", { name: /^(Events|Ereignisse)$/ })).toBeVisible();
  });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(pagePath);
    await page.getByRole("button", { name: /^Watching options for VPN access/ }).click();
    await page.getByRole("menuitem", { name: "Mute…" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectAccessible(page, `mute dialog at ${width}`);
    await screenshot(page, `mute-dialog-${width}.png`);
    await page.keyboard.press("Escape");
  }
  await setAppearance(page, { colorMode: "light", language: "en" });
});
