import { expect, test } from "../support/fixtures.js";
import { callApi, expectAccessible } from "../support/helpers.js";
import { unique } from "../support/people.js";

test("creates a knowledge base and publishes a how-to only once its required section has content", async ({
  page,
  organization,
}) => {
  const name = `Help ${unique()}`;
  await page.goto("/spaces");
  await page.getByRole("button", { name: "Create space" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Create a space" });
  await dialog.getByRole("radio", { name: /^Knowledge base/ }).click();
  await dialog.getByLabel("Name").fill(name);
  await expect(dialog.getByRole("radio", { name: /^All signed-in people/ })).toBeChecked();
  await expectAccessible(page, "create knowledge base");
  await dialog.getByRole("button", { name: "Create space" }).click();

  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "View in portal" }).first()).toBeDisabled();
  await expect(page.getByText(/The portal for readers comes in a later version/).first()).toBeVisible();
  await expectAccessible(page, "knowledge base articles");
  const spaceKey = new URL(page.url()).pathname.split("/")[2] ?? "";
  const lookup = await page.request.get(`/api/v1/space-keys/${spaceKey}`);
  const space = ((await lookup.json()) as { space: { id: string } }).space;
  await callApi(page, "PUT", `/api/v1/spaces/${space.id}/knowledge-base/required-sections`, {
    templateId: "builtin:article-how-to",
    sectionKey: "steps",
    required: true,
  });

  await page.getByRole("button", { name: "Create in this space" }).click();
  await expect(page.getByRole("menuitem", { name: "New whiteboard" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "New article" }).click();
  const gallery = page.getByRole("dialog", { name: `Create in ${name}` });
  await gallery.getByRole("button", { name: /How-to/ }).click();
  await gallery.getByRole("button", { name: "Create from How-to" }).click();
  const editor = page.getByRole("textbox", { name: "Page content" });
  await expect(editor).toBeEditable();
  await expect(page.getByRole("heading", { name: "Steps" })).toBeVisible();

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("button", { name: "Publish version 1" }).click();
  await expect(
    page.getByText("Steps is required. Add text or an image here before publishing."),
  ).toBeVisible();
  await expect(page.getByText("Required sections are empty")).toBeVisible();
  await expectAccessible(page, "article with an empty required section");

  await page.keyboard.type("Open the VPN client and sign in.");
  await expect(page.getByText("Steps is required. Add text or an image here before publishing.")).toHaveCount(
    0,
  );
  await expect(page.getByRole("status").getByText("Saved to draft", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("button", { name: "Publish version 1" }).click();
  await expect(page.getByText("Published as version 1. Readers see it now.")).toBeVisible();

  await page.goto(`/spaces/${spaceKey}`);
  await expect(page.getByRole("link", { name: "How-to" })).toBeVisible();
  await expect(page.getByText("Without category")).toBeVisible();
});
