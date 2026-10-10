import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { callApi } from "../support/helpers.js";
import {
  FOLDER_EXPORT,
  PEOPLE_EXPORT_TEMPLATE,
  placeFolderExport,
  updateImportRow,
  waitForImportState,
} from "../support/imports.js";
import { unique } from "../support/people.js";
import { sweepAppearances } from "../support/sweeps.js";

async function prepared(page: Page, organizationId: string, reviewer: { id: string; name: string } | null) {
  await placeFolderExport(organizationId, PEOPLE_EXPORT_TEMPLATE);
  const created = (await callApi(page, "POST", `/api/v1/organizations/${organizationId}/imports`, {
    source: "confluence-csv",
  })) as { id: string };
  await page.request.patch(`/api/v1/imports/${created.id}`, {
    data: { file: { kind: "folder", name: FOLDER_EXPORT } },
    headers: { "X-Pagehall-Request": "1", origin: new URL(page.url()).origin },
  });
  await waitForImportState(created.id, "ready");
  await page.request.patch(`/api/v1/imports/${created.id}`, {
    data: { spaceKey: `S${unique()}`.slice(0, 10), spaceName: "IT Operations" },
    headers: { "X-Pagehall-Request": "1", origin: new URL(page.url()).origin },
  });
  if (reviewer)
    await callApi(page, "PUT", `/api/v1/imports/${created.id}/reviewers`, { accountIds: [reviewer.id] });
  await page.request.put(`/api/v1/imports/${created.id}/people-source/user-list`, {
    data: [
      "User id,User name,email",
      `557058:bbbbbbbb-0002,${reviewer?.name ?? "Rita Reviewer"},rita.reviewer@elsewhere.example`,
      "557058:dddddddd-0004,Carol Clark,",
    ].join("\n"),
    headers: { "X-Pagehall-Request": "1", origin: new URL(page.url()).origin, "content-type": "text/csv" },
  });
  return created.id;
}

test("import screens pass the accessibility check in English and German, light and dark, wide and narrow", async ({
  page,
  organization,
}) => {
  test.slow();
  test.setTimeout(240_000);
  const reviewer = await organization.invite("Rita");
  await page.goto(`/settings/organizations/${organization.id}/imports`);
  const draft = await prepared(page, organization.id, reviewer);
  const finished = await prepared(page, organization.id, reviewer);
  await callApi(page, "POST", `/api/v1/imports/${finished}/start`);
  await waitForImportState(finished, "review");
  const held = await prepared(page, organization.id, null);
  await callApi(page, "POST", `/api/v1/imports/${held}/start`);
  await waitForImportState(held, "review");
  await updateImportRow(
    held,
    "update imports set state = 'held', phase = 'content', progress_done = 7, progress_total = 20 where id = $1",
  );
  const base = `/settings/organizations/${organization.id}/imports`;

  await sweepAppearances(page, "imports-list", async () => {
    await page.goto(base);
    await expect(page.getByRole("list", { name: /Imports|Importe/ })).toBeVisible();
  });
  for (const step of [0, 1, 2, 3]) {
    await sweepAppearances(page, `import-wizard-step-${step + 1}`, async () => {
      await page.goto(`${base}/${draft}/setup?step=${step}`);
      await expect(
        page.getByRole("list", { name: /Steps of the import|Schritte des Imports/ }),
      ).toBeVisible();
    });
  }
  await sweepAppearances(page, "import-progress-held", async () => {
    await page.goto(`${base}/${held}`);
    await expect(page.getByRole("progressbar").first()).toBeVisible();
  });
  await sweepAppearances(page, "import-stop-dialog", async () => {
    await page.goto(`${base}/${held}`);
    await page.getByRole("button", { name: /^(Stop import|Import stoppen)$/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
  for (const tab of ["summary", "macros", "people", "comments", "attachments", "permissions"]) {
    await sweepAppearances(page, `import-report-${tab}`, async () => {
      await page.goto(`${base}/${finished}?tab=${tab}`);
      await expect(page.getByRole("tablist")).toBeVisible();
    });
  }
  await sweepAppearances(page, "import-accept-dialog", async () => {
    await page.goto(`${base}/${finished}`);
    await page
      .getByRole("button", { name: /^(Accept import|Import übernehmen)$/ })
      .first()
      .click();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: /^(Accept import|Import übernehmen)$/ }),
    ).toBeVisible();
  });
  await sweepAppearances(page, "import-people-mapping-dialog", async () => {
    await page.goto(`${base}/${finished}?tab=people`);
    await page
      .getByRole("button", { name: /^(Choose|.* wählen)/ })
      .first()
      .click();
    await page.getByRole("button", { name: /^(Map 1 person|1 Person zuordnen)$/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
  await sweepAppearances(page, "import-group-dialog", async () => {
    await page.goto(`${base}/${finished}?tab=permissions`);
    await page
      .getByRole("button", { name: /^(Create group|Gruppe) “?„?hr-team/ })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
  await sweepAppearances(page, "import-discard-dialog", async () => {
    await page.goto(`${base}/${finished}`);
    await page.getByRole("button", { name: /^(Discard import|Import verwerfen)$/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
