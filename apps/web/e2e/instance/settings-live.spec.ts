import { test } from "../support/fixtures.js";
import { appliesFormats, appliesLockedValues, switchesOpenSessions } from "../support/live-settings.js";

test.use({ instanceAdministrator: true });

test("switches open sessions when the instance language changes", async ({ browser, organization }) => {
  await switchesOpenSessions(browser, organization, "instance");
});

test("applies a locked instance language and time zone to people with their own values", async ({
  browser,
  organization,
}) => {
  await appliesLockedValues(browser, organization, "instance");
});

test("applies instance formats, time zone and accent color to open sessions", async ({
  browser,
  organization,
}) => {
  await appliesFormats(browser, organization, "instance");
});
