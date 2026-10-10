import { expect, test } from "../support/fixtures.js";
import { callApi } from "../support/helpers.js";
import { type Series, series, teamSpace } from "../support/meetings.js";

test("a team holds a quarterly and a biweekly series with attendance, topics, tasks and decisions", async ({
  page,
  organization,
}) => {
  const colleague = await organization.invite("Lena");
  const space = await teamSpace(page, organization, [colleague]);
  await page.goto(`/spaces/${space.key}/meetings`);
  await page.getByRole("button", { name: "New series" }).first().click();
  const dialog = page.getByRole("dialog", { name: /New meeting series/ });
  await dialog.getByLabel("Name").fill("Jour fixe IT");
  await dialog.getByRole("combobox", { name: "Members" }).fill(colleague.name.split(" ")[0] ?? "");
  await page.getByRole("option", { name: new RegExp(colleague.name) }).click();
  await dialog.getByRole("combobox", { name: "Rhythm" }).click();
  await page.getByRole("option", { name: "Every few weeks" }).click();
  await dialog.getByLabel("Every how many weeks").fill("2");
  await dialog.getByLabel("First meeting").fill("2030-03-14");
  await dialog.getByLabel("Start time").fill("14:00");
  await dialog.getByRole("button", { name: "Create series" }).click();
  await expect(page.getByRole("heading", { name: "Jour fixe IT", level: 1 })).toBeVisible();
  await expect(page.getByText("Every 2 weeks on Thursday", { exact: false })).toBeVisible();

  const quarterly = await series(page, space.id, {
    name: "Quarterly review",
    members: [colleague.id],
    rhythm: { frequency: "monthly", interval: 3, weekOfMonth: 1, weekday: "TU" },
    startsOn: "2030-01-01",
  });
  expect(quarterly.upcoming.title).toContain("Quarterly review");

  await page.getByRole("button", { name: "Add topic" }).first().click();
  const topicDialog = page.getByRole("dialog", { name: "Add a running topic" });
  await topicDialog.getByLabel("Title").fill("Positions in AD");
  await topicDialog.getByRole("button", { name: "Add topic" }).click();
  await expect(page.getByRole("link", { name: /Positions in AD/ })).toBeVisible();

  await page.getByRole("link", { name: "Open agenda" }).click();
  await expect(page.getByRole("region", { name: "Meeting details" })).toBeVisible();
  const attendee = page.getByRole("button", { name: new RegExp(`${colleague.name}: Not recorded`) });
  await attendee.click();
  await page.getByRole("menuitem", { name: "Present" }).click();
  await expect(page.getByRole("button", { name: new RegExp(`${colleague.name}: Present`) })).toBeVisible();
  const meetingUrl = page.url();

  await page.getByRole("link", { name: "Jour fixe IT" }).first().click();
  await page.getByRole("link", { name: /Positions in AD/ }).click();
  await page.getByRole("button", { name: "Close as decision" }).click();
  const decide = page.getByRole("dialog", { name: /Close Positions in AD as a decision/ });
  await decide.getByLabel("Decision").fill("Positions are kept in AD and synchronized nightly.");
  await decide.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText("Decided", { exact: true })).toBeVisible();

  await page
    .getByRole("navigation", { name: "Breadcrumbs" })
    .getByRole("link", { name: "Jour fixe IT" })
    .click();
  await expect(page.getByText("Positions are kept in AD and synchronized nightly.")).toBeVisible();

  await page.goto(meetingUrl);
  await page.getByRole("button", { name: "Close meeting" }).click();
  await expect(page.getByText(/closed/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await page.goto(`/spaces/${space.key}/meetings`);
  await expect(page.getByRole("link", { name: /Jour fixe IT/ }).first()).toBeVisible();
});

test("two people hold a one-on-one that administrators cannot read, with private notes and a successor", async ({
  page,
  organization,
}) => {
  const anna = await organization.invite("Anna");
  const ben = await organization.invite("Ben");
  const clara = await organization.invite("Clara");
  const first = await organization.signIn(anna);
  try {
    await first.page.goto("/home");
    await first.page.getByRole("button", { name: "New one-on-one" }).click();
    const dialog = first.page.getByRole("dialog", { name: "Start a one-on-one" });
    await dialog.getByRole("combobox", { name: "With" }).fill(ben.name.split(" ")[0] ?? "");
    await first.page.getByRole("option", { name: new RegExp(ben.name) }).click();
    await dialog.getByLabel("First meeting").fill("2030-10-17");
    await dialog.getByRole("button", { name: "Start one-on-one" }).click();
    await expect(first.page.getByRole("heading", { level: 1 })).toContainText(anna.name.split(" ")[0] ?? "");
    const seriesUrl = first.page.url();
    const [, spaceKey, seriesId] = /\/spaces\/([^/]+)\/meetings\/([^/?]+)/.exec(seriesUrl) ?? [];
    const seriesData = (await (
      await first.page.request.get(`/api/v1/meeting-series/${seriesId}`)
    ).json()) as Series & { spaceId: string };
    await callApi(first.page, "PUT", `/api/v1/meetings/${seriesData.upcoming.id}/private-notes`, {
      document: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Ask about goals" }] }],
      },
      revision: 0,
    });

    await page.goto(`/spaces/${spaceKey}`);
    await expect(page.getByText(/not available|no access|keinen Zugriff/i).first()).toBeVisible();
    const response = await page.request.get(`/api/v1/meetings/${seriesData.upcoming.id}/private-notes`);
    expect(response.status()).toBeGreaterThanOrEqual(400);
    await page.goto(`/settings/organizations/${organization.id}/spaces`);
    await expect(page.getByText(spaceKey ?? "").first()).toBeVisible();
    await expect(page.getByText(anna.name)).toHaveCount(0);

    const second = await organization.signIn(ben);
    try {
      const notes = (await (
        await second.page.request.get(`/api/v1/meetings/${seriesData.upcoming.id}/private-notes`)
      ).json()) as { revision: number; document: unknown };
      expect(JSON.stringify(notes.document)).not.toContain("Ask about goals");
      expect(notes.revision).toBe(0);
    } finally {
      await second.context.close();
    }

    await first.page.goto(seriesUrl);
    await first.page.getByRole("button", { name: "More actions for the series" }).click();
    await first.page.getByRole("menuitem", { name: "Change person" }).click();
    const change = first.page.getByRole("dialog", { name: "Change a person of this one-on-one" });
    await change.getByRole("combobox", { name: /Successor/ }).fill(clara.name.split(" ")[0] ?? "");
    await first.page.getByRole("option", { name: new RegExp(clara.name) }).click();
    await change.getByRole("button", { name: "Add successor" }).click();
    await expect(first.page.getByText(new RegExp(`${clara.name}.*added`)).first()).toBeVisible();

    const third = await organization.signIn(clara);
    try {
      await third.page.goto(seriesUrl);
      await expect(third.page.getByRole("heading", { level: 1 })).toBeVisible();
      expect((await third.page.request.get(`/api/v1/meeting-series/${seriesId}/meetings`)).status()).toBe(
        200,
      );
    } finally {
      await third.context.close();
    }
  } finally {
    await first.context.close();
  }
});
