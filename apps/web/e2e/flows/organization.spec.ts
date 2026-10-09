import { expect, test } from "../support/fixtures.js";
import { expectAccessible, linkFrom, signInWithPassword, waitForMail } from "../support/helpers.js";
import { forwardFrom, unique } from "../support/people.js";

function pattern(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

test("invites a member who accepts and signs in", async ({ page, browser, organization }) => {
  const suffix = unique();
  const member = {
    name: `Max Member ${suffix}`,
    email: `max.member.${suffix.toLowerCase()}@pagehall.test`,
    password: "member passphrase for testing",
  };
  await page.goto("/settings/preferences");
  await page.getByRole("list", { name: organization.name }).getByRole("link", { name: "Members" }).click();
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
  await expectAccessible(page, "members");

  await page.getByRole("button", { name: "Invite people" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite people" });
  await dialog.getByLabel("E-mail addresses").fill(member.email);
  await expect(dialog.getByText("Who gains access")).toBeVisible();
  await expect(dialog.getByRole("list", { name: "People who gain access" })).toContainText(member.email);
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("1 invitation sent.").first()).toBeVisible();
  await page.getByRole("tab", { name: /Invitations/ }).click();
  await expect(page.getByRole("cell", { name: member.email })).toBeVisible();

  const mail = await waitForMail(member.email, /invit/i);
  const link = linkFrom(mail.text);
  const invited = await forwardFrom(await browser.newContext({ storageState: { cookies: [], origins: [] } }));
  const invitee = await invited.newPage();
  await invitee.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await invitee.getByRole("button", { name: "Accept invitation" }).click();
  await invitee.getByLabel("Name", { exact: true }).fill(member.name);
  await invitee.getByLabel("Password", { exact: true }).fill(member.password);
  await invitee.getByLabel("Repeat the password").fill(member.password);
  await invitee.getByRole("button", { name: "Create account" }).click();
  await expect(invitee.getByText("Your account is ready. Sign in to start.")).toBeVisible();
  await invitee.getByRole("link", { name: "Sign in" }).click();
  await signInWithPassword(invitee, member.email, member.password);
  await expect(invitee.getByRole("heading", { name: "For you", level: 1 })).toBeVisible();
  await expect(invitee.getByRole("link", { name: "Audit log" })).toHaveCount(0);
  await invited.close();

  await page.reload();
  await page.getByRole("tab", { name: /All/ }).click();
  await expect(page.getByRole("cell", { name: pattern(member.name) }).first()).toBeVisible();
});

test("creates a group, adds a member and gives the group a custom role", async ({ page, organization }) => {
  const suffix = unique();
  const groupName = `Auditors ${suffix}`;
  const roleName = `Audit readers ${suffix}`;
  await page.goto("/settings/preferences");
  const member = await organization.invite("Greta");

  await page.getByRole("list", { name: organization.name }).getByRole("link", { name: "Groups" }).click();
  await page.getByRole("button", { name: "Create group" }).click();
  const create = page.getByRole("dialog", { name: "Create group" });
  await create.getByLabel("Name", { exact: true }).fill(groupName);
  await create.getByLabel("Description").fill("People who review the audit log");
  await create.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { name: groupName })).toBeVisible();

  await page.getByRole("button", { name: "Add member" }).click();
  const add = page.getByRole("dialog", { name: "Add member" });
  await add.getByRole("combobox", { name: "Person" }).fill(member.name);
  await page.getByRole("option", { name: pattern(member.name) }).click();
  await expect(add.getByText("Who gains access")).toBeVisible();
  await add.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("The member was added.").first()).toBeVisible();

  await page.getByRole("list", { name: organization.name }).getByRole("link", { name: "Roles" }).click();
  await page.getByRole("button", { name: "Create role" }).click();
  const role = page.getByRole("dialog", { name: "Create role" });
  await role.getByLabel("Name", { exact: true }).fill(roleName);
  await role.getByRole("radiogroup", { name: "Audit log" }).getByRole("radio", { name: "View" }).click();
  await role.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("cell", { name: roleName, exact: true })).toBeVisible();
  await expectAccessible(page, "roles");

  await page.getByRole("button", { name: "Give a role" }).first().click();
  const assign = page.getByRole("dialog", { name: "Give a role" });
  await assign.getByRole("combobox", { name: "Role" }).click();
  await page.getByRole("option", { name: pattern(roleName) }).click();
  const holders = assign.getByRole("combobox", { name: "People and groups" });
  await holders.fill(groupName);
  await page.getByRole("option", { name: pattern(groupName) }).click();
  await expect(holders).toHaveAttribute("aria-expanded", "false");
  await expect(assign.getByRole("list", { name: "People who gain access" })).toContainText(member.name);
  await assign.getByRole("button", { name: "Give role" }).click();
  await expect(page.getByRole("cell", { name: `Group ${groupName}`, exact: true })).toBeVisible();
});

test("creates a personal API token and revokes it", async ({ page, organization }) => {
  const tokenName = `Reporting export ${unique()}`;
  await page.goto("/settings/security");
  await page.getByRole("button", { name: "Create token" }).click();
  const dialog = page.getByRole("dialog", { name: "Create API token" });
  await dialog.getByLabel("Name", { exact: true }).fill(tokenName);
  await dialog
    .getByRole("radiogroup", { name: "Members and groups" })
    .getByRole("radio", { name: "View" })
    .click();
  await dialog.getByRole("button", { name: "Create token" }).click();
  const secret =
    (await page.getByRole("dialog", { name: "Your new token" }).locator("code").textContent()) ?? "";
  expect(secret).toMatch(/^ph_/);
  await page.getByRole("button", { name: "Done" }).click();
  const row = page.getByRole("listitem").filter({ hasText: tokenName });
  await expect(row).toBeVisible();

  const allowed = await page.request.fetch(`/api/v1/organizations/${organization.id}/members`, {
    headers: { authorization: `Bearer ${secret}`, cookie: "" },
  });
  expect(allowed.status()).toBe(200);

  await row.getByRole("button", { name: "Revoke" }).click();
  const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog", { name: /Revoke/ }));
  await expect(confirm.getByText("Who loses access")).toBeVisible();
  await confirm.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText(tokenName)).toHaveCount(0);
  const refused = await page.request.fetch(`/api/v1/organizations/${organization.id}/members`, {
    headers: { authorization: `Bearer ${secret}`, cookie: "" },
  });
  expect(refused.status()).toBe(401);
});
