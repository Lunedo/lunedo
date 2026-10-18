import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { callApi, expectAccessible } from "../support/helpers.js";
import { unique } from "../support/people.js";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const template = (document: unknown) => ({
  name: "Onboarding",
  description: "First week of a new colleague",
  category: "teams",
  title: "Onboarding",
  fields: [],
  document,
});

async function space(page: Page, organizationId: string, name: string) {
  const key = `TF${unique()}`;
  const created = (await callApi(page, "POST", `/api/v1/organizations/${organizationId}/spaces`, {
    name,
    key,
    visibility: "private",
    grants: [],
  })) as { id: string };
  return { id: created.id, key };
}

test("exports a template with an image and imports it into another space under a new name", async ({
  page,
  organization,
}) => {
  await page.goto("/spaces");
  const source = await space(page, organization.id, "People Team");
  const target = await space(page, organization.id, "Engineering");
  const created = (await callApi(
    page,
    "POST",
    `/api/v1/spaces/${source.id}/templates`,
    template({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Welcome" }] }] }),
  )) as { id: string };
  const uploaded = await page.request.fetch(
    `/api/v1/spaces/${source.id}/templates/${created.id}/files?name=welcome.png`,
    {
      method: "POST",
      data: PIXEL,
      headers: {
        "content-type": "application/octet-stream",
        "X-Pagehall-Request": "1",
        origin: new URL(page.url()).origin,
      },
    },
  );
  expect(uploaded.status()).toBe(201);
  const file = (await uploaded.json()) as { id: string };
  await callApi(
    page,
    "PUT",
    `/api/v1/spaces/${source.id}/templates/${created.id}`,
    template({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Welcome" }] },
        { type: "image", attrs: { attachmentId: file.id, alt: "Team photo", width: null, align: "center" } },
      ],
    }),
  );
  await callApi(
    page,
    "POST",
    `/api/v1/spaces/${target.id}/templates`,
    template({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Old" }] }] }),
  );

  await page.goto(`/spaces/${source.key}/settings/templates`);
  await page.getByRole("button", { name: "Export all" }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export templates" });
  await expect(exportDialog.getByText("Nothing is removed.")).toBeVisible();
  await expect(exportDialog.getByText("1 image")).toBeVisible();
  await expectAccessible(page, "template export dialog");
  const downloading = page.waitForEvent("download");
  await exportDialog.getByRole("button", { name: "Download file" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("onboarding.pagehall-template.zip");
  const path = await download.path();

  await page.goto(`/spaces/${target.key}/settings/templates`);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const importDialog = page.getByRole("dialog", { name: "Import templates" });
  await importDialog.getByLabel(/Drop a template file here/).setInputFiles(path);
  await importDialog.getByRole("button", { name: "Check file" }).click();
  const name = importDialog.getByRole("textbox", { name: "Name of the new template" });
  await expect(name).toHaveValue("Onboarding (imported)");
  await expectAccessible(page, "template import preview");
  await name.fill("Onboarding for engineers");
  await importDialog.getByRole("button", { name: "Import 1 template" }).click();
  await expect(page.getByText("Templates imported: 1 new, 0 replaced").first()).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Select Onboarding for engineers" })).toBeVisible();

  await page.goto(`/spaces/${target.key}`);
  await page.getByRole("button", { name: "Create in this space" }).click();
  await page.getByRole("menuitem", { name: "New page" }).click();
  const gallery = page.getByRole("dialog", { name: "Create in Engineering" });
  await gallery.getByRole("button", { name: /Onboarding for engineers/ }).click();
  await gallery.getByRole("button", { name: "Create from Onboarding for engineers" }).click();
  await expect(gallery).toBeHidden();
  const image = page.getByRole("textbox", { name: "Page content" }).getByRole("img", { name: "Team photo" });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  expect(await image.getAttribute("src")).toMatch(/^\/api\/v1\/attachments\//);
});

for (const level of ["instance", "organization", "space"] as const) {
  test.describe(`${level} templates`, () => {
    test.use({ instanceAdministrator: level === "instance" });

    test(`creates a ${level} template by typing, adds an image, saves and reopens it`, async ({
      page,
      organization,
    }) => {
      await page.goto("/spaces");
      const name = `Site survey ${unique()}`;
      const path =
        level === "instance"
          ? "/settings/instance/templates"
          : level === "organization"
            ? `/settings/organizations/${organization.id}/templates`
            : `/spaces/${(await space(page, organization.id, "Facilities")).key}/settings/templates`;
      await page.goto(path);
      await page.getByRole("button", { name: "Create template" }).first().click();
      const created = page.getByRole("dialog", { name: "New template" });
      await created.getByRole("textbox", { name: /^Name/ }).pressSequentially(name);
      await created
        .getByRole("textbox", { name: /^Description/ })
        .pressSequentially("Checklist for a new site");
      await created.getByRole("textbox", { name: /^Title of new pages/ }).pressSequentially("Survey");
      const content = created.getByRole("textbox", { name: "Content" });
      await content.click();
      await content.pressSequentially("Rooms and racks");
      await expect(created.getByText("Save the template first; then you can add images.")).toBeVisible();
      await created.getByRole("button", { name: "Create template" }).click();
      await expect(created).toBeHidden();
      await expect(page.getByText("Something went wrong in this browser")).toHaveCount(0);

      await page.getByRole("button", { name: `Actions for ${name}` }).click();
      await page.getByRole("menuitem", { name: "Edit template" }).click();
      const editing = page.getByRole("dialog", { name: "Edit template" });
      await expect(editing.getByRole("textbox", { name: "Content" })).toContainText("Rooms and racks");
      const choosing = page.waitForEvent("filechooser");
      await editing.getByRole("button", { name: "Image", exact: true }).click();
      await (await choosing).setFiles({ name: "rack.png", mimeType: "image/png", buffer: PIXEL });
      const image = editing.getByRole("textbox", { name: "Content" }).getByRole("img", { name: "rack.png" });
      await expect(image).toBeVisible();
      await editing.getByRole("textbox", { name: /^Description/ }).fill("Checklist for a new site and rooms");
      await editing.getByRole("button", { name: "Save template" }).click();
      await expect(editing).toBeHidden();

      await page.reload();
      await page.getByRole("button", { name: `Actions for ${name}` }).click();
      await page.getByRole("menuitem", { name: "Edit template" }).click();
      const reopened = page.getByRole("dialog", { name: "Edit template" });
      await expect(reopened.getByRole("textbox", { name: /^Description/ })).toHaveValue(
        "Checklist for a new site and rooms",
      );
      const stored = reopened
        .getByRole("textbox", { name: "Content" })
        .getByRole("img", { name: "rack.png" });
      await expect(stored).toBeVisible();
      await expect
        .poll(() => stored.evaluate((element) => (element as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
    });
  });
}
