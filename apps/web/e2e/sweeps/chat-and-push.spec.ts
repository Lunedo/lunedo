import { collaborationSpace } from "../support/collaboration.js";
import { expect, test } from "../support/fixtures.js";
import { callApi, expectAccessible, setAppearance } from "../support/helpers.js";
import { screenshot, sweepAppearances, WIDTHS } from "../support/sweeps.js";

test.use({ instanceAdministrator: true });

test("chat channels of a space pass the accessibility check in every appearance", async ({
  page,
  organization,
}) => {
  test.slow();
  const space = await collaborationSpace(page, organization);
  await callApi(page, "POST", `/api/v1/spaces/${space.id}/chat-channels`, {
    kind: "teams",
    name: "IT-Ops · General with a rather long channel name for wrapping",
    events: ["pagePublished", "blogPostPublished", "decisionRecorded"],
    target: { url: "https://93.184.216.34/workflows/hook" },
  });
  await sweepAppearances(page, "space-chat-channels", async () => {
    await page.goto(`/spaces/${space.key}/settings/chat`);
    await expect(page.getByRole("list", { name: /^(Chat channels|Chat-Kanäle)$/ })).toBeVisible();
  });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/spaces/${space.key}/settings/chat`);
    await page.getByRole("button", { name: "Connect a channel" }).click();
    const dialog = page.getByRole("dialog", { name: "Connect a channel" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Connect" }).click();
    await expect(dialog.getByText("Enter a name.")).toBeVisible();
    await expectAccessible(page, `connect dialog at ${width}`);
    await screenshot(page, `chat-connect-dialog-${width}.png`);
    await page.keyboard.press("Escape");
  }
  await setAppearance(page, { colorMode: "light", language: "en" });
});

test("browser push settings pass the accessibility check in every appearance", async ({
  page,
  organization,
}) => {
  test.slow();
  await page.goto("/settings/notifications");
  try {
    await callApi(page, "PUT", "/api/v1/instance/settings/notifications.browserPush", { value: true });
    await sweepAppearances(page, "notification-settings-with-push", async () => {
      await page.goto("/settings/notifications");
      await expect(
        page.getByRole("switch", { name: /: (Browser push|Browser-Push)$/ }).first(),
      ).toBeVisible();
    });
    await sweepAppearances(page, "instance-notification-defaults", async () => {
      await page.goto("/settings/instance/notifications");
      await expect(
        page.getByRole("switch", {
          name: /^(Browser push for this instance|Browser-Push für diese Instanz)$/,
        }),
      ).toBeVisible();
    });
    await sweepAppearances(page, "organization-announcement-channels", async () => {
      await page.goto(`/settings/organizations/${organization.id}/announcements`);
      await expect(page.getByRole("button", { name: /^(Connect a channel|Kanal verbinden)$/ })).toBeVisible();
    });
    await callApi(page, "PUT", "/api/v1/instance/settings/notifications.browserPush", { value: false });
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/settings/instance/notifications");
      await page.getByRole("switch", { name: "Browser push for this instance" }).click();
      await expect(page.getByRole("dialog", { name: "Turn on browser push?" })).toBeVisible();
      await expectAccessible(page, `push confirmation at ${width}`);
      await screenshot(page, `push-confirmation-${width}.png`);
      await page.keyboard.press("Escape");
    }
  } finally {
    await callApi(page, "PUT", "/api/v1/instance/settings/notifications.browserPush", { value: false });
    await setAppearance(page, { colorMode: "light", language: "en" });
  }
});
