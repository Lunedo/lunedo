import { expect, test } from "../support/fixtures.js";
import { callApi, expectAccessible } from "../support/helpers.js";
import { forwardFrom, SIGNED_OUT } from "../support/people.js";
import { createPage, place } from "../support/places.js";
import { screenshot, sweepAppearances, WIDTHS } from "../support/sweeps.js";

test("the attachments of a page pass the accessibility check in English and German, light and dark, wide and narrow", async ({
  page,
  organization,
}) => {
  const { pagePath } = await place(page, organization);
  await page.goto(pagePath);
  const upload = page.locator("input[data-page-attach]");
  await upload.setInputFiles([
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("First version of the notes") },
    { name: "routers.csv", mimeType: "text/csv", buffer: Buffer.from("name,ip\ncore,10.0.0.1\n") },
    { name: "page.html", mimeType: "text/html", buffer: Buffer.from("<script>alert(1)</script>") },
  ]);
  await expect(page.getByRole("button", { name: /^page\.html/ })).toBeVisible();
  await upload.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Second version of the notes"),
  });
  await expect(page.getByRole("button", { name: /^notes\.txt/ })).toContainText("version 2");
  await sweepAppearances(page, "attachments", async () => {
    await page.goto(pagePath);
    await expect(page.getByRole("button", { name: /^notes\.txt/ })).toBeVisible();
  });
});

test("sharing screens pass the accessibility check in English and German, light and dark, wide and narrow", async ({
  page,
  organization,
}) => {
  test.slow();
  const { spaceKey, pageId, pagePath } = await place(page, organization);
  const colleague = await organization.invite("Sven");
  await callApi(page, "POST", `/api/v1/pages/${pageId}/access`, {
    changes: [
      { action: "share", holderKind: "account", holderId: colleague.id, role: "reader" },
      { action: "restrict", kind: "view" },
    ],
  });
  const link = (await callApi(page, "POST", `/api/v1/pages/${pageId}/share-links`, {
    scope: "people",
    people: [{ kind: "account", id: colleague.id }],
  })) as { token: string };
  const { page: other } = await organization.signIn(colleague);

  await sweepAppearances(page, "space-access", async () => {
    await page.goto(`/spaces/${spaceKey}/settings/access`);
    await expect(page.getByRole("link", { name: "Network plan" }).first()).toBeVisible();
  });
  await sweepAppearances(page, "share-dialog", async () => {
    await page.goto(pagePath);
    await page.getByRole("button", { name: /^(Share|Teilen)$/ }).click();
    await expect(page.getByRole("dialog").getByText(colleague.name).first()).toBeVisible();
  });
  await sweepAppearances(page, "share-links", async () => {
    await page.goto(pagePath);
    await page.getByRole("button", { name: /^(Share|Teilen)$/ }).click();
    await page.getByRole("tab", { name: /^(Share links|Links)$/ }).click();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: /^(Copy link|Link kopieren)$/ }),
    ).toBeVisible();
  });
  await sweepAppearances(page, "give-access", async () => {
    await page.goto(`/spaces/${spaceKey}/settings/access`);
    await page
      .getByRole("button", {
        name: /^(Give access|Zugriff geben|Continue giving access|Zugriff geben fortsetzen)$/,
      })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
  await sweepAppearances(other, "shared-page", async () => {
    await other.goto(`/s/${link.token}`);
    await expect(other.getByRole("heading", { name: "Network plan" })).toBeVisible();
  });
});

test("a page opened through a link for anyone passes the accessibility check light and dark, wide and narrow", async ({
  page,
  browser,
  organization,
}) => {
  const { spaceId, spaceKey } = await place(page, organization, "Hidden plan");
  await callApi(page, "PUT", `/api/v1/organizations/${organization.id}/settings/sharing.anyoneLinks`, {
    value: true,
  });
  try {
    const open = await createPage(page, spaceId, spaceKey, "Status page");
    const made = (await callApi(page, "POST", `/api/v1/pages/${open.id}/share-links`, {
      scope: "anyone",
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      password: "harbour lantern",
    })) as { token: string };
    const anonymous = await forwardFrom(await browser.newContext({ storageState: SIGNED_OUT }));
    try {
      const visitor = await anonymous.newPage();
      await visitor.goto(`/s/${made.token}`);
      await visitor.getByLabel("Password", { exact: true }).fill("harbour lantern");
      await visitor.getByRole("button", { name: "Open page" }).click();
      await expect(visitor.getByRole("heading", { name: "Status page" })).toBeVisible();
      for (const colorScheme of ["light", "dark"] as const) {
        await visitor.emulateMedia({ colorScheme });
        for (const width of WIDTHS) {
          await visitor.setViewportSize({ width, height: 900 });
          await expectAccessible(visitor, `link page (${colorScheme}, ${width})`);
          await screenshot(visitor, `link-page-${colorScheme}-${width}.png`);
        }
      }
    } finally {
      await anonymous.close();
    }
  } finally {
    await callApi(page, "PUT", `/api/v1/organizations/${organization.id}/settings/sharing.anyoneLinks`, {
      clear: true,
    });
  }
});

test("the access overview passes the accessibility check in English and German, light and dark, wide and narrow", async ({
  page,
  organization,
}) => {
  const { pageId } = await place(page, organization);
  const person = await organization.invite("Anna");
  await callApi(page, "POST", `/api/v1/pages/${pageId}/access`, {
    changes: [{ action: "share", holderKind: "account", holderId: person.id, role: "editor" }],
  });
  await sweepAppearances(page, "access-overview", async () => {
    await page.goto(`/settings/organizations/${organization.id}/access`);
    await page.getByRole("combobox", { name: "Person" }).fill(person.name);
    await page.getByRole("option", { name: new RegExp(person.name) }).click();
    await expect(page.getByRole("button", { name: /^(Why\?|Warum\?)$/ }).first()).toBeVisible();
  });
});
