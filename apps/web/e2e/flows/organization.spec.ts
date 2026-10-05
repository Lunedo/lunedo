import { expect, test } from "@playwright/test";
import { OWNER_STORAGE, writeState } from "../support/environment.js";
import { expectAccessible, linkFrom, signInWithPassword, waitForMail } from "../support/helpers.js";

test.describe.configure({ mode: "serial" });
test.use({ storageState: OWNER_STORAGE });

const MEMBER = {
  name: "Max Member",
  email: "max.member@pagehall.test",
  password: "member passphrase for testing",
};

test("invites a member who accepts and signs in", async ({ page, browser }) => {
  await page.goto("/settings/preferences");
  await page.getByRole("list", { name: "Platform Team" }).getByRole("link", { name: "Members" }).click();
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
  const organizationId = /organizations\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  writeState({ organizationId: organizationId ?? "" });
  await expectAccessible(page, "members");

  await page.getByRole("button", { name: "Invite people" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite people" });
  await dialog.getByLabel("E-mail addresses").fill(MEMBER.email);
  await expect(dialog.getByText("Who gains access")).toBeVisible();
  await expect(dialog.getByRole("list", { name: "People who gain access" })).toContainText(MEMBER.email);
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("1 invitation sent.").first()).toBeVisible();
  await page.getByRole("tab", { name: /Invitations/ }).click();
  await expect(page.getByRole("cell", { name: MEMBER.email })).toBeVisible();

  const mail = await waitForMail(MEMBER.email, /invit/i);
  const link = linkFrom(mail.text);
  const invited = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const invitee = await invited.newPage();
  await invitee.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await invitee.getByRole("button", { name: "Accept invitation" }).click();
  await invitee.getByLabel("Name", { exact: true }).fill(MEMBER.name);
  await invitee.getByLabel("Password", { exact: true }).fill(MEMBER.password);
  await invitee.getByLabel("Repeat the password").fill(MEMBER.password);
  await invitee.getByRole("button", { name: "Create account" }).click();
  await expect(invitee.getByText("Your account is ready. Sign in to start.")).toBeVisible();
  await invitee.getByRole("link", { name: "Sign in" }).click();
  await signInWithPassword(invitee, MEMBER.email, MEMBER.password);
  await expect(invitee.getByRole("heading", { name: "Preferences" })).toBeVisible();
  await expect(invitee.getByRole("link", { name: "Audit log" })).toHaveCount(0);
  await invited.close();
  writeState({ memberEmail: MEMBER.email, memberPassword: MEMBER.password });

  await page.reload();
  await page.getByRole("tab", { name: /All/ }).click();
  await expect(page.getByRole("cell", { name: new RegExp(MEMBER.name) }).first()).toBeVisible();
});

test("creates a group, adds the member and gives the group a custom role", async ({ page }) => {
  await page.goto("/settings/preferences");
  await page.getByRole("list", { name: "Platform Team" }).getByRole("link", { name: "Groups" }).click();
  await page.getByRole("button", { name: "Create group" }).click();
  const create = page.getByRole("dialog", { name: "Create group" });
  await create.getByLabel("Name", { exact: true }).fill("Auditors");
  await create.getByLabel("Description").fill("People who review the audit log");
  await create.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { name: "Auditors" })).toBeVisible();

  await page.getByRole("button", { name: "Add member" }).click();
  const add = page.getByRole("dialog", { name: "Add member" });
  await add.getByRole("combobox", { name: "Person" }).fill(MEMBER.name.split(" ")[0] ?? "");
  await page.getByRole("option", { name: new RegExp(MEMBER.name) }).click();
  await expect(add.getByText("Who gains access")).toBeVisible();
  await add.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("The member was added.").first()).toBeVisible();

  await page.getByRole("list", { name: "Platform Team" }).getByRole("link", { name: "Roles" }).click();
  await page.getByRole("button", { name: "Create role" }).click();
  const role = page.getByRole("dialog", { name: "Create role" });
  await role.getByLabel("Name", { exact: true }).fill("Audit readers");
  await role.getByRole("radiogroup", { name: "Audit log" }).getByRole("radio", { name: "View" }).click();
  await role.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("cell", { name: "Audit readers", exact: true })).toBeVisible();
  await expectAccessible(page, "roles");

  await page.getByRole("button", { name: "Give a role" }).first().click();
  const assign = page.getByRole("dialog", { name: "Give a role" });
  await assign.getByRole("combobox", { name: "Role" }).click();
  await page.getByRole("option", { name: /Audit readers/ }).click();
  await assign.getByRole("combobox", { name: "People and groups" }).fill("Audit");
  await page.getByRole("option", { name: /Auditors/ }).click();
  await expect(assign.getByRole("list", { name: "People who gain access" })).toContainText(MEMBER.name);
  await assign.getByRole("button", { name: "Give role" }).click();
  await expect(page.getByRole("cell", { name: "Group Auditors", exact: true })).toBeVisible();
});

test("creates a personal API token and revokes it", async ({ page }) => {
  await page.goto("/settings/security");
  await page.getByRole("button", { name: "Create token" }).click();
  const dialog = page.getByRole("dialog", { name: "Create API token" });
  await dialog.getByLabel("Name", { exact: true }).fill("Reporting export");
  await dialog
    .getByRole("radiogroup", { name: "Members and groups" })
    .getByRole("radio", { name: "View" })
    .click();
  await dialog.getByRole("button", { name: "Create token" }).click();
  const secret =
    (await page.getByRole("dialog", { name: "Your new token" }).locator("code").textContent()) ?? "";
  expect(secret).toMatch(/^ph_/);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Reporting export")).toBeVisible();

  const organizationId = /([0-9a-f-]{36})/.exec(
    (await page.request.get("/api/v1/organizations").then((response) => response.text())) ?? "",
  )?.[1];
  const allowed = await page.request.fetch(`/api/v1/organizations/${organizationId}/members`, {
    headers: { authorization: `Bearer ${secret}`, cookie: "" },
  });
  expect(allowed.status()).toBe(200);

  await page.getByRole("button", { name: "Revoke" }).click();
  const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog", { name: /Revoke/ }));
  await expect(confirm.getByText("Who loses access")).toBeVisible();
  await confirm.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("Reporting export")).toHaveCount(0);
  const refused = await page.request.fetch(`/api/v1/organizations/${organizationId}/members`, {
    headers: { authorization: `Bearer ${secret}`, cookie: "" },
  });
  expect(refused.status()).toBe(401);
});
