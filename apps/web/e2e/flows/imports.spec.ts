import { expect, test } from "../support/fixtures.js";
import { expectAccessible } from "../support/helpers.js";
import {
  FOLDER_EXPORT,
  importIdFrom,
  placeFolderExport,
  waitForImportState,
  writeSourceFile,
  writeSyntheticExport,
} from "../support/imports.js";
import { unique } from "../support/people.js";

test("an administrator uploads an XML export, a reviewer reads it in quarantine and the administrator accepts it", async ({
  page,
  organization,
}) => {
  test.slow();
  const reviewer = await organization.invite("Rita");
  const outsider = await organization.invite("Otto");
  const archive = test.info().outputPath("export.zip");
  await writeSyntheticExport("xml", archive);
  const key = `X${unique()}`.slice(0, 10);

  await page.goto(`/settings/organizations/${organization.id}/imports`);
  await expect(page.getByText("No imports yet")).toBeVisible();
  await expectAccessible(page, "empty imports list");
  await page.getByRole("button", { name: "New import" }).first().click();
  await expect(page).toHaveURL(/\/imports\/[0-9a-f-]+\/setup/);
  const importId = importIdFrom(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByText("Choose the export file, and wait until the upload is finished."),
  ).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(archive);
  await expect(page.getByText("Export read")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Uploaded", { exact: true })).toBeVisible();
  await expectAccessible(page, "import source step");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "People", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Check and save the API token first, or choose another way.")).toBeVisible();
  await page.getByRole("radio", { name: /Skip for now/ }).check();
  await page.getByRole("checkbox", { name: /every author becomes a placeholder/ }).click();
  await expect(page.getByRole("checkbox", { name: /every author becomes a placeholder/ })).toBeChecked();
  await expectAccessible(page, "import people step");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Space", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Synthetic space");
  await page.getByLabel("Key", { exact: true }).fill(key);
  await page.getByLabel("Address of the Confluence site").fill("https://example.atlassian.net/wiki");
  await page.getByRole("combobox", { name: "Add a reviewer" }).fill(reviewer.name.split(" ")[0] ?? "");
  await page.getByRole("option", { name: new RegExp(reviewer.name) }).click();
  await expect(page.getByRole("button", { name: `Remove ${reviewer.name}` })).toBeVisible();
  await expectAccessible(page, "import space step");
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" && response.url().endsWith(`/api/v1/imports/${importId}`),
  );
  await page.getByRole("button", { name: "Continue" }).click();
  await saved;

  await expect(page.getByRole("heading", { name: "Check and start", level: 1 })).toBeVisible();
  await expect(page.getByText(`Space “Synthetic space” (${key})`)).toBeVisible();
  await page.reload();
  await expect(page.getByText(`Space “Synthetic space” (${key})`)).toBeVisible();
  await expectAccessible(page, "import check step");
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page).toHaveURL(new RegExp(`/imports/${importId}$`));
  await waitForImportState(importId, "review");
  await expect(page.getByRole("button", { name: "Accept import" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Macros/ })).toBeVisible();
  await expectAccessible(page, "import report");

  const { page: reviewing } = await organization.signIn(reviewer);
  await reviewing.goto(`/settings/organizations/${organization.id}/imports/${importId}`);
  await expect(reviewing.getByRole("heading", { name: "Synthetic space", level: 1 })).toBeVisible();
  await expect(reviewing.getByRole("button", { name: "Accept import" })).toHaveCount(0);
  await expect(reviewing.getByRole("button", { name: "Discard import" })).toHaveCount(0);
  await reviewing.goto(`/spaces/${key}`);
  await expect(reviewing.getByText("Import in quarantine")).toBeVisible();

  const { page: outside } = await organization.signIn(outsider);
  const hidden = await outside.request.get(`/api/v1/imports/${importId}`);
  expect(hidden.status()).toBe(404);
  await outside.goto("/spaces");
  await expect(outside.getByText(key)).toHaveCount(0);

  await page.getByRole("button", { name: "Accept import" }).click();
  const dialog = page.getByRole("dialog", { name: "Accept “Synthetic space”?" });
  await expect(dialog.getByText(reviewer.name).first()).toBeVisible();
  await expectAccessible(page, "accept dialog");
  await dialog.getByRole("button", { name: "Accept import" }).click();
  await expect(page.getByText("Synthetic space is now a regular space.").first()).toBeVisible();
  await waitForImportState(importId, "accepted");

  await outside.goto(`/spaces/${key}`);
  await expect(outside.getByText("Import in quarantine")).toHaveCount(0);
  await expect(outside.getByRole("link", { name: "Alpha" }).first()).toBeVisible();
});

test("an administrator imports a CSV export from the import folder and discards it", async ({
  page,
  organization,
}) => {
  test.slow();
  const key = `C${unique()}`.slice(0, 10);
  const folder = placeFolderExport(organization.id);
  await page.goto(`/settings/organizations/${organization.id}/imports`);
  await expect(page.getByRole("textbox", { name: "Import folder of this organization" })).toHaveValue(folder);
  await page.getByRole("button", { name: "New import" }).first().click();
  await expect(page).toHaveURL(/\/imports\/[0-9a-f-]+\/setup/);
  const importId = importIdFrom(page);
  await page.getByText("CSV space export", { exact: true }).click();
  await page.getByText("Server import folder", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Import folder of this organization" })).toHaveValue(folder);
  await page.getByRole("combobox", { name: "File in the import folder" }).click();
  await page.getByRole("option", { name: new RegExp(FOLDER_EXPORT) }).click();
  await expect(page.getByText("Export read")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: /Skip for now/ }).check();
  await page.getByRole("checkbox", { name: /every author becomes a placeholder/ }).click();
  await expect(page.getByRole("checkbox", { name: /every author becomes a placeholder/ })).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Start import" }).click();
  await waitForImportState(importId, "review");
  await page.reload();
  await page.getByRole("button", { name: "Discard import" }).click();
  const dialog = page.getByRole("dialog", { name: "Discard the import?" });
  await dialog.getByLabel(`Type ${key} to confirm`).fill(key);
  await dialog.getByRole("button", { name: "Discard import" }).click();
  await waitForImportState(importId, "discarded");
  await page.reload();
  await expect(page.getByText("The import was discarded")).toBeVisible();
  const space = await page.request.get(`/api/v1/spaces?q=${key}`);
  expect(JSON.stringify(await space.json())).not.toContain(key);
});

test("an administrator imports a Markdown folder and a Word document through the assistant", async ({
  page,
  organization,
}) => {
  test.slow();
  const markdown = test.info().outputPath("handbook.zip");
  const word = test.info().outputPath("security-policy.docx");
  await writeSourceFile("markdown", markdown);
  await writeSourceFile("word", word);

  const markdownKey = `M${unique()}`.slice(0, 10);
  await page.goto(`/settings/organizations/${organization.id}/imports`);
  await page.getByRole("button", { name: "New import" }).first().click();
  await expect(page).toHaveURL(/\/imports\/[0-9a-f-]+\/setup/);
  const markdownImport = importIdFrom(page);
  await page.getByRole("radio", { name: /Markdown folder/ }).check();
  await expectAccessible(page, "import source choice");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Upload", level: 1 })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(markdown);
  await expect(page.getByText("Export read")).toBeVisible({ timeout: 60_000 });
  await expectAccessible(page, "markdown upload step");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Space", level: 1 })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Team handbook");
  await page.getByLabel("Key", { exact: true }).fill(markdownKey);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Check and start", level: 1 })).toBeVisible();
  await expect(page.getByText("Folders, links and images")).toBeVisible();
  await expectAccessible(page, "markdown check step");
  await page.getByRole("button", { name: "Start import" }).click();
  await waitForImportState(markdownImport, "review");
  await page.reload();
  await expect(page.getByText("1 element stayed as text")).toBeVisible();
  await expectAccessible(page, "markdown import report");
  await page.goto(`/spaces/${markdownKey}`);
  await expect(page.getByText("Start with").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "setup" }).first()).toBeVisible();

  const wordKey = `W${unique()}`.slice(0, 10);
  await page.goto(`/settings/organizations/${organization.id}/imports`);
  await page.getByRole("button", { name: "New import" }).first().click();
  await expect(page).toHaveURL(/\/imports\/[0-9a-f-]+\/setup/);
  const wordImport = importIdFrom(page);
  await page.getByRole("radio", { name: /Word documents/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByText("Add at least one Word document and wait until every upload is finished."),
  ).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(word);
  await expect(page.getByText("Documents read")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("combobox", { name: "Pages" }).click();
  await page.getByRole("option", { name: "A subpage per top-level heading" }).click();
  await expect(page.getByText("3 pages with 0 attachments found.")).toBeVisible({ timeout: 60_000 });
  await expectAccessible(page, "word upload step");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Key", { exact: true }).fill(wordKey);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Headings, tables and images")).toBeVisible();
  await page.getByRole("button", { name: "Start import" }).click();
  await waitForImportState(wordImport, "review");
  await page.reload();
  await expect(page.getByRole("button", { name: "Accept import" })).toBeVisible();
  await page.goto(`/spaces/${wordKey}`);
  await expect(page.getByRole("link", { name: "Security policy" }).first()).toBeVisible();
});
