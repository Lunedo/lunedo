import { itemPath } from "../support/addresses.js";
import { expect, test } from "../support/fixtures.js";
import { callApi } from "../support/helpers.js";
import { series, teamSpace } from "../support/meetings.js";
import { sweepAppearances } from "../support/sweeps.js";

test("meeting screens pass the review in both languages and themes", async ({ page, organization }) => {
  test.slow();
  const colleague = await organization.invite("Noah");
  const space = await teamSpace(page, organization, [colleague]);
  const created = await series(page, space.id, {
    name: "Jour fixe Ops",
    members: [colleague.id],
    rhythm: { frequency: "weekly", interval: 1, weekdays: ["MO"] },
    startsOn: "2030-03-18",
  });
  const topic = (await callApi(page, "POST", `/api/v1/meeting-series/${created.id}/topics`, {
    title: "Storage migration",
    labels: ["infrastructure"],
  })) as { id: string; number: number; title: string };
  await callApi(page, "POST", `/api/v1/topics/${topic.id}/decision`, {
    statement: "Move to the new NAS in May.",
  });
  const meetingPath = itemPath(space.key, "pages", created.upcoming);
  await sweepAppearances(page, "meetings-list", async () => {
    await page.goto(`/spaces/${space.key}/meetings`);
    await expect(page.getByRole("link", { name: /Jour fixe Ops/ }).first()).toBeVisible();
  });
  await sweepAppearances(page, "meeting-series", async () => {
    await page.goto(itemPath(space.key, "meetings", created));
    await expect(page.getByText("Move to the new NAS in May.")).toBeVisible();
  });
  await sweepAppearances(page, "meeting-page", async () => {
    await page.goto(meetingPath);
    await expect(page.getByRole("region", { name: /Meeting details|Besprechungsdetails/ })).toBeVisible();
  });
  await sweepAppearances(page, "meeting-private-notes", async () => {
    await page.goto(`${meetingPath}?notes=true`);
    await expect(
      page.getByRole("complementary", { name: /Your private notes|Deine privaten Notizen/ }),
    ).toBeVisible();
  });
  await sweepAppearances(page, "meeting-topic", async () => {
    await page.goto(itemPath(space.key, "topics", topic));
    await expect(page.getByRole("heading", { name: "Storage migration", level: 1 })).toBeVisible();
  });
  await sweepAppearances(page, "meeting-create-series", async () => {
    await page.goto(`/spaces/${space.key}/meetings`);
    await page
      .getByRole("button", { name: /New series|Neue Serie/ })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});

test("one-on-one screens pass the review in both languages and themes", async ({ page, organization }) => {
  const anna = await organization.invite("Anna");
  const ben = await organization.invite("Ben");
  const first = await organization.signIn(anna);
  const created = (await callApi(first.page, "POST", "/api/v1/one-on-ones", {
    otherId: ben.id,
    organizationId: organization.id,
    rhythm: { frequency: "weekly", interval: 2, weekdays: ["TH"] },
    startsOn: "2030-10-17",
    startTime: "14:00",
    timeZone: "Europe/Vienna",
    durationMinutes: 30,
  })) as { spaceId: string };
  const { key } = (await (await first.page.request.get(`/api/v1/spaces/${created.spaceId}`)).json()) as {
    key: string;
  };
  await page.goto("/home");
  await sweepAppearances(page, "confidential-spaces-organization", async () => {
    await page.goto(`/settings/organizations/${organization.id}/spaces`);
    await expect(page.getByText(key).first()).toBeVisible();
  });
  const second = await organization.signIn(ben);
  await sweepAppearances(second.page, "home-meetings", async () => {
    await second.page.goto("/home");
    await expect(second.page.getByRole("region", { name: /One-on-ones|1:1-Gespräche/ })).toBeVisible();
  });
});
