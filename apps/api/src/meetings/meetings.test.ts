import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  OWNER,
  signedInClient,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

interface Person {
  id: string;
  client: TestClient;
}

const SCHEDULE = {
  rhythm: { frequency: "weekly", interval: 2, weekdays: ["TH"] },
  startsOn: "2030-10-17",
  startTime: "14:00",
  timeZone: "Europe/Vienna",
  durationMinutes: 30,
};

describe.skipIf(!databaseBaseUrl)("meetings through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let organizationId: string;
  let counter = 0;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    const created = await owner.post("/api/v1/organizations", { name: "Meeting people" });
    organizationId = created.json().id;
  });

  afterAll(async () => {
    await test?.close();
  });

  async function person(home?: string): Promise<Person> {
    counter += 1;
    const email = `meetings${counter}@lunedo.test`;
    const password = "a long enough passphrase";
    const account = await createAccount(test, email, password, home ?? organizationId);
    return { id: account.id, client: await signedInClient(test, email, password) };
  }

  async function oneOnOne(first: Person, second: Person) {
    const created = await first.client.post("/api/v1/one-on-ones", {
      otherId: second.id,
      organizationId,
      ...SCHEDULE,
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json() as { spaceId: string; seriesId: string };
  }

  it("hold a team's series with attendance, topics, decisions and the decision log", async () => {
    const lead = await person();
    const colleague = await person();
    const space = await lead.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Team ${counter}`,
      key: `TM${counter}`,
      visibility: "private",
      grants: [{ principalKind: "account", principalId: colleague.id, role: "editor" }],
    });
    const spaceId = space.json().id;
    const series = await lead.client.post(`/api/v1/spaces/${spaceId}/meeting-series`, {
      name: "Jour fixe IT",
      members: [lead.id, colleague.id],
      rhythm: { frequency: "monthly", interval: 3, weekOfMonth: 1, weekday: "TU" },
      startsOn: "2030-01-01",
      startTime: "09:30",
      timeZone: "Europe/Vienna",
      durationMinutes: 45,
    });
    expect(series.statusCode, series.body).toBe(201);
    const details = series.json();
    expect(details.schedule.recurrence).toBe("FREQ=MONTHLY;INTERVAL=3;BYDAY=1TU");
    const meetingId = details.upcoming.id;
    expect(
      (
        await lead.client.put(`/api/v1/meetings/${meetingId}/attendees/${colleague.id}`, {
          attendance: "present",
        })
      ).statusCode,
    ).toBe(204);
    const topic = await lead.client.post(`/api/v1/meeting-series/${details.id}/topics`, {
      title: "Positions in AD",
      labels: ["Directory"],
    });
    expect(topic.statusCode, topic.body).toBe(201);
    const decided = await lead.client.post(`/api/v1/topics/${topic.json().id}/decision`, {
      statement: "Positions stay in AD.",
    });
    expect(decided.statusCode, decided.body).toBe(200);
    const log = await colleague.client.get(`/api/v1/meeting-series/${details.id}/decisions?text=AD`);
    expect(log.json().map((entry: { text: string }) => entry.text)).toEqual(["Positions stay in AD."]);
    const closed = await lead.client.post(`/api/v1/meetings/${meetingId}/close`, {});
    expect(closed.statusCode, closed.body).toBe(200);
    const next = await lead.client.get(`/api/v1/meetings/${closed.json().nextMeetingId}`);
    expect(next.json().startsAt).toBe("2030-04-02T07:30:00.000Z");
    const again = await colleague.client.post(`/api/v1/meetings/${meetingId}/close`, {});
    expect(again.json().code).toBe("meetingClosed");
    const meeting = await lead.client.get(`/api/v1/meetings/${meetingId}`);
    expect(meeting.json().attendees).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: colleague.id, attendance: "present" })]),
    );
    const topics = await lead.client.get(`/api/v1/meeting-series/${details.id}/topics?status=closed`);
    expect(topics.json()[0]).toMatchObject({ outcome: "decided", labels: ["directory"] });
    const upcoming = await colleague.client.get("/api/v1/meetings/upcoming");
    expect(upcoming.json().map((entry: { seriesId: string }) => entry.seriesId)).toContain(details.id);
    const tasks = await colleague.client.get(`/api/v1/tasks?seriesId=${details.id}`);
    expect(tasks.statusCode).toBe(200);
  });

  it("start a one-on-one only in an organization both people belong to", async () => {
    const first = await person();
    const elsewhere = await owner.post("/api/v1/organizations", { name: `Elsewhere ${counter}` });
    const stranger = await person(elsewhere.json().id);
    const none = await first.client.get(`/api/v1/one-on-ones/organizations?personId=${stranger.id}`);
    expect(none.json()).toEqual([]);
    const refused = await first.client.post("/api/v1/one-on-ones", {
      otherId: stranger.id,
      organizationId,
      ...SCHEDULE,
    });
    expect(refused.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("keep a one-on-one between its two people, notify the other and hide it from the spaces list", async () => {
    const first = await person();
    const second = await person();
    const organizations = await first.client.get(`/api/v1/one-on-ones/organizations?personId=${second.id}`);
    expect(organizations.json().map((entry: { id: string }) => entry.id)).toEqual([organizationId]);
    const created = await oneOnOne(first, second);
    const space = await second.client.get(`/api/v1/spaces/${created.spaceId}`);
    expect(space.json()).toMatchObject({ confidential: true, oneOnOne: true, role: "admin" });
    const notifications = await second.client.get("/api/v1/notifications");
    expect(notifications.body).toContain("oneOnOne.started");
    expect((await first.client.get("/api/v1/spaces")).body).not.toContain(created.spaceId);
    expect((await first.client.get("/api/v1/spaces?oneOnOne=true")).body).toContain(created.spaceId);
    const listed = await second.client.get("/api/v1/one-on-ones");
    expect(listed.json()).toEqual([
      expect.objectContaining({
        spaceId: created.spaceId,
        partners: [expect.objectContaining({ id: first.id })],
      }),
    ]);
    for (const path of [
      `/api/v1/spaces/${created.spaceId}`,
      `/api/v1/meeting-series/${created.seriesId}`,
      `/api/v1/meeting-series/${created.seriesId}/topics`,
      `/api/v1/meeting-series/${created.seriesId}/decisions`,
    ]) {
      expect((await owner.get(path)).statusCode, path).toBeGreaterThanOrEqual(400);
    }
    expect((await owner.get("/api/v1/meetings/upcoming")).body).not.toContain(created.seriesId);
  });

  it("let the remaining person add a successor, who then sees the earlier meetings", async () => {
    const first = await person();
    const second = await person();
    const successor = await person();
    const created = await oneOnOne(first, second);
    const changed = await first.client.post(`/api/v1/spaces/${created.spaceId}/one-on-one/successor`, {
      previousId: second.id,
      successorId: successor.id,
      mode: "add",
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(
      (await successor.client.get(`/api/v1/meeting-series/${created.seriesId}/meetings`)).statusCode,
    ).toBe(200);
    expect(
      (await second.client.get(`/api/v1/meeting-series/${created.seriesId}`)).statusCode,
    ).toBeGreaterThanOrEqual(400);
    const series = await first.client.get(`/api/v1/meeting-series/${created.seriesId}`);
    expect(
      series
        .json()
        .members.map((member: { id: string }) => member.id)
        .sort(),
    ).toEqual([first.id, successor.id].sort());
    const fresh = await first.client.post(`/api/v1/spaces/${created.spaceId}/one-on-one/successor`, {
      previousId: successor.id,
      successorId: second.id,
      mode: "new",
    });
    expect(fresh.statusCode, fresh.body).toBe(200);
    expect(fresh.json().spaceId).not.toBe(created.spaceId);
  });

  it("keep private notes with their author in every path of the API", async () => {
    const first = await person();
    const second = await person();
    const created = await oneOnOne(first, second);
    const meetingId = (await first.client.get(`/api/v1/meeting-series/${created.seriesId}`)).json().upcoming
      .id;
    const saved = await first.client.put(`/api/v1/meetings/${meetingId}/private-notes`, {
      document: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Ask about the raise" }] }],
      },
      revision: 0,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const conflict = await first.client.put(`/api/v1/meetings/${meetingId}/private-notes`, {
      document: { type: "doc", content: [{ type: "paragraph" }] },
      revision: 0,
    });
    expect(conflict.json().code).toBe("notesChanged");
    for (const [client, label] of [
      [second.client, "the other member and space admin"],
      [owner, "an administrator"],
    ] as const) {
      for (const path of [
        `/api/v1/meetings/${meetingId}/private-notes`,
        `/api/v1/meeting-series/${created.seriesId}/private-notes`,
        `/api/v1/pages/${meetingId}/content`,
        `/api/v1/meetings/${meetingId}`,
      ]) {
        expect((await client.get(path)).body, `${label}: ${path}`).not.toContain("Ask about the raise");
      }
    }
    expect(
      (await first.client.get(`/api/v1/meeting-series/${created.seriesId}/private-notes`)).body,
    ).toContain("Ask about the raise");
  });
});
