import { idIn, itemOfNumber, numberIn } from "../support/addresses.js";
import { expect, test } from "../support/fixtures.js";
import { callApi, chooseDate, chooseTime } from "../support/helpers.js";
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
  await chooseDate(page, dialog.getByLabel("First meeting"), "2030-03-14");
  await chooseTime(page, dialog.getByLabel("Start time"), "14:00");
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

  await page.getByRole("tab", { name: /Topics/ }).click();
  await page.getByRole("button", { name: "Topic", exact: true }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Positions in AD");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("link", { name: "Positions in AD" })).toBeVisible();

  await page.getByRole("link", { name: "Open agenda" }).click();
  await expect(page.getByRole("region", { name: "Meeting details" })).toBeVisible();
  await page.getByRole("combobox", { name: `Attendance of ${colleague.name}` }).click();
  await page.getByRole("option", { name: "Present" }).click();
  await expect(page.getByRole("combobox", { name: `Attendance of ${colleague.name}` })).toContainText(
    "Present",
  );
  await page.getByRole("button", { name: "Person", exact: true }).click();
  await page.getByRole("radio", { name: "Person without an account" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Martin Huber");
  await page.getByRole("button", { name: "Add to this meeting" }).click();
  await expect(page.getByRole("list", { name: "Attendees" }).getByText("Guest")).toBeVisible();
  const meetingUrl = page.url();

  await page.getByRole("button", { name: "Topic", exact: true }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Printer costs");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const agenda = page.getByRole("list", { name: /Open topics/ });
  await expect(agenda.getByRole("listitem")).toHaveCount(2);
  await agenda.getByRole("listitem").nth(1).hover();
  await page.getByRole("button", { name: "Move Printer costs up" }).click();
  await expect(agenda.getByRole("listitem").first()).toContainText("Printer costs");
  await page.getByRole("button", { name: "Move Printer costs", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByText(/^(Picked up Printer costs|Printer costs is over Printer costs).$/),
  ).toBeAttached();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByText("Printer costs is over Positions in AD.")).toBeAttached();
  await page.keyboard.press("Space");
  await expect(agenda.getByRole("listitem").first()).toContainText("Positions in AD");

  await page.getByRole("button", { name: "Show Positions in AD" }).click();
  await page
    .getByRole("textbox", { name: "Update on Positions in AD in this meeting" })
    .fill("Positions are kept in AD and synchronized nightly.");
  await page.getByRole("button", { name: "Close as decision" }).click();
  await expect(page.getByText(/Decision recorded/).first()).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: /Decisions/ })
      .getByText("Positions are kept in AD and synchronized nightly."),
  ).toBeVisible();
  await expect(agenda.getByRole("listitem")).toHaveCount(1);

  await page.getByRole("link", { name: "Jour fixe IT", exact: true }).first().click();
  await expect(page.getByText("Positions are kept in AD and synchronized nightly.")).toBeVisible();

  await page.goto(meetingUrl);
  await expect(page.getByText(/Can be closed from/)).toBeVisible();
  const meetingId = (await itemOfNumber(page, numberIn(meetingUrl, "pages"))).id;
  await callApi(page, "PUT", `/api/v1/meetings/${meetingId}/start`, {
    startsAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });
  await page.reload();
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
    await first.page.getByRole("button", { name: "Create", exact: true }).click();
    await first.page.getByRole("menuitem", { name: "New one-on-one" }).click();
    const dialog = first.page.getByRole("dialog", { name: "Start a one-on-one" });
    await dialog.getByRole("combobox", { name: "With" }).fill(ben.name.split(" ")[0] ?? "");
    await first.page.getByRole("option", { name: new RegExp(ben.name) }).click();
    await chooseDate(first.page, dialog.getByLabel("First meeting"), "2030-10-17");
    await dialog.getByRole("button", { name: "Start one-on-one" }).click();
    await expect(first.page.getByRole("heading", { level: 1 })).toContainText(anna.name.split(" ")[0] ?? "");
    const seriesUrl = first.page.url();
    const spaceKey = /\/spaces\/([^/]+)\/meetings\//.exec(seriesUrl)?.[1];
    const seriesId = await idIn(first.page, "meetings");
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
