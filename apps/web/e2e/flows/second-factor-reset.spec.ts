import { expect, test } from "../support/fixtures.js";
import { callApi, linkFrom, signInWithPassword, waitForMail } from "../support/helpers.js";
import { forwardFrom, SIGNED_OUT, unique } from "../support/people.js";

test.use({ instanceAdministrator: true });

test("an administrator resets a member's second factor with a reason", async ({
  page,
  browser,
  organization,
}) => {
  const suffix = unique();
  const person = {
    name: `Rita Reset ${suffix}`,
    email: `rita.reset.${suffix.toLowerCase()}@lunedo.test`,
    password: "reset passphrase for testing",
  };
  await page.goto("/settings/preferences");
  await callApi(page, "POST", `/api/v1/organizations/${organization.id}/invitations`, {
    email: person.email,
    kind: "member",
  });
  const link = linkFrom((await waitForMail(person.email, /invit/i)).text);
  const context = await forwardFrom(await browser.newContext({ storageState: SIGNED_OUT }));
  const invitee = await context.newPage();
  await invitee.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await invitee.getByLabel("Name", { exact: true }).fill(person.name);
  await invitee.getByLabel("Password", { exact: true }).fill(person.password);
  await invitee.getByLabel("Repeat the password").fill(person.password);
  await invitee.getByRole("button", { name: "Create account" }).click();
  await expect(invitee.getByText("Your account is ready. Sign in to start.")).toBeVisible();

  await page.goto("/settings/instance/accounts");
  await page.getByRole("searchbox", { name: "Search by name or e-mail" }).fill(person.name);
  await page.getByRole("table", { name: "Accounts" }).getByText(person.name).click();
  await expect(page).toHaveURL(/\/settings\/instance\/accounts\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 1, name: person.name })).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: "Reset second factor" }).click();
  const dialog = page.getByRole("dialog", { name: `Reset the second factor of ${person.name}?` });
  await dialog.getByLabel("Reason").fill("Lost phone, confirmed by call");
  await dialog.getByRole("button", { name: "Reset second factor" }).click();
  const confirm = page.getByRole("dialog", { name: "Confirm your identity" });
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.getByLabel("Password").fill(organization.admin.password);
    await confirm.getByRole("button", { name: "Confirm" }).click();
  }
  await expect(page.getByText(`The second factor of ${person.name} was reset.`).first()).toBeVisible();
  expect((await waitForMail(person.email, /second factor/i)).text).toContain("Lost phone, confirmed by call");

  await invitee.goto("/sign-in");
  await signInWithPassword(invitee, person.email, person.password);
  await expect(invitee.getByRole("heading", { name: "Set up a second factor" })).toBeVisible();
  await context.close();
});
