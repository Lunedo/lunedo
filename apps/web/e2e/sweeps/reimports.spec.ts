import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { callApi } from "../support/helpers.js";
import {
  FOLDER_EXPORT,
  placeFolderExport,
  REIMPORT_AFTER_TEMPLATE,
  REIMPORT_BEFORE_TEMPLATE,
  runSql,
  waitForImportState,
} from "../support/imports.js";
import { unique } from "../support/people.js";
import { sweepAppearances } from "../support/sweeps.js";

const headers = (page: Page) => ({ "X-Pagehall-Request": "1", origin: new URL(page.url()).origin });

async function analyzed(page: Page, organizationId: string, template: string, spaceId?: string) {
  placeFolderExport(organizationId, template);
  const created = (await callApi(page, "POST", `/api/v1/organizations/${organizationId}/imports`, {
    source: "confluence-xml",
    ...(spaceId ? { spaceId } : {}),
  })) as { id: string };
  await page.request.patch(`/api/v1/imports/${created.id}`, {
    data: { file: { kind: "folder", name: FOLDER_EXPORT } },
    headers: headers(page),
  });
  await waitForImportState(created.id, "ready");
  return created.id;
}

async function started(page: Page, importId: string) {
  await callApi(page, "PUT", `/api/v1/imports/${importId}/people-source`, { kind: "skip", confirmed: true });
  await callApi(page, "POST", `/api/v1/imports/${importId}/start`);
  await waitForImportState(importId, "review");
}

test("re-import screens pass the accessibility check in English and German, light and dark, wide and narrow", async ({
  page,
  organization,
}) => {
  test.slow();
  test.setTimeout(300_000);
  await page.goto(`/settings/organizations/${organization.id}/imports`);
  await callApi(page, "POST", `/api/v1/organizations/${organization.id}/groups`, { name: "readers" });
  const first = await analyzed(page, organization.id, REIMPORT_BEFORE_TEMPLATE);
  await page.request.patch(`/api/v1/imports/${first}`, {
    data: { spaceKey: `R${unique()}`.slice(0, 10), spaceName: "Archive 2019–2022" },
    headers: headers(page),
  });
  await started(page, first);
  const accepted = (await callApi(page, "POST", `/api/v1/imports/${first}/accept`, {
    visibility: "private",
    grants: [],
  })) as { quarantineSpace: { id: string } };
  const spaceId = accepted.quarantineSpace.id;
  await runSql(
    `update page_documents set revision = revision + 1 where item_id in (
      select target_id from import_items where import_id = $1 and kind = 'page' and source_id in ('3004', '3005', '3006'))`,
    [first],
  );
  await runSql(
    `insert into collaboration_presence (item_id, node, connections, seen_at)
      select target_id, 'sweep', 1, now() + interval '1 hour' from import_items
      where import_id = $1 and kind = 'page' and source_id = '3007'`,
    [first],
  );
  const reimport = await analyzed(page, organization.id, REIMPORT_AFTER_TEMPLATE, spaceId);
  await started(page, reimport);
  const draft = await analyzed(page, organization.id, REIMPORT_AFTER_TEMPLATE, spaceId);
  const base = `/settings/organizations/${organization.id}/imports`;

  await sweepAppearances(page, "reimport-imports-list", async () => {
    await page.goto(base);
    await expect(page.getByRole("list", { name: /Imports|Importe/ })).toBeVisible();
  });
  await sweepAppearances(page, "reimport-accepted-import", async () => {
    await page.goto(`${base}/${first}`);
    await expect(
      page.getByRole("textbox", { name: /Paste an old Confluence link|Alten Confluence-Link/ }),
    ).toBeVisible();
  });
  for (const step of [0, 1, 2]) {
    await sweepAppearances(page, `reimport-wizard-step-${step + 1}`, async () => {
      await page.goto(`${base}/${draft}/setup?step=${step}`);
      await expect(
        page.getByRole("list", { name: /Steps of the import|Schritte des Imports/ }),
      ).toBeVisible();
    });
  }
  for (const tab of ["conflicts", "updates", "deleted", "moved", "permissions"]) {
    await sweepAppearances(page, `reimport-changes-${tab}`, async () => {
      await page.goto(`${base}/${reimport}?tab=${tab}`);
      await expect(page.getByRole("tablist")).toBeVisible();
      await expect(page.getByRole("tabpanel")).toBeVisible();
    });
  }
  await sweepAppearances(page, "reimport-conflicts-selected", async () => {
    await page.goto(`${base}/${reimport}?tab=conflicts`);
    await expect(
      page.getByRole("link", { name: /^(Compare “Take source”|„Take source“ mit)/ }),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: /^(Select all|Alle auswählen)$/ }).click();
    await expect(page.getByRole("toolbar")).toBeVisible();
  });
  for (const view of ["inline", "sideBySide"]) {
    await sweepAppearances(page, `reimport-comparison-${view}`, async () => {
      await page.goto(`${base}/${reimport}?tab=conflicts`);
      await page.getByRole("link", { name: /^(Compare “Take source”|„Take source“ mit)/ }).click();
      await expect(page.getByRole("region", { name: /^(Comparison|Vergleich)$/ })).toBeVisible();
      if (view === "sideBySide") {
        await page.getByRole("radio", { name: /^(Side by side|Nebeneinander)$/ }).click();
        await expect(page.getByRole("heading", { name: /^Confluence, (version|Version) 2$/ })).toBeVisible();
      }
    });
  }
  await sweepAppearances(page, "reimport-difference-dialog", async () => {
    await page.goto(`${base}/${reimport}?tab=permissions`);
    await page
      .getByRole("button", { name: /^(Apply…|Übernehmen…)$/ })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
  await sweepAppearances(page, "confluence-link-not-found", async () => {
    await page.goto("/confluence/display/NOPE/Missing+page");
    await expect(
      page.getByText(/This Confluence page is not here|Diese Confluence-Seite gibt es hier nicht/),
    ).toBeVisible();
  });
});
