import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, renderWithProviders } from "../testing/render.js";
import { AgendaSection } from "./agenda.js";
import { MeetingHeader } from "./meeting-header.js";
import type { Agenda, Meeting, Series } from "./queries.js";
import { SeriesOverview } from "./series-overview.js";

const MEETING = "01929b1e-0000-7000-8000-0000000000e1";
const SERIES = "01929b1e-0000-7000-8000-0000000000c1";
const SPACE = "01929b1e-0000-7000-8000-0000000000a1";
const FIREWALL = "01929b1e-0000-7000-8000-0000000000f1";
const PRINTERS = "01929b1e-0000-7000-8000-0000000000f2";
const LENA = { id: "01929b1e-0000-7000-8000-0000000000b1", name: "Lena Hofer" };

function inRouter(ui: ReactNode) {
  const root = createRootRoute({ component: () => <PreferencesProvider>{ui}</PreferencesProvider> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return <RouterProvider router={router} />;
}

function topic(
  id: string,
  title: string,
  extra: Partial<Agenda["topics"][number]> = {},
): Agenda["topics"][number] {
  return {
    id,
    title,
    status: "open",
    outcome: null,
    oneOff: false,
    owner: LENA,
    labels: [],
    createdAt: "2026-10-05T08:00:00.000Z",
    update: { text: "", formatted: false },
    previous: [],
    tasks: [],
    ...extra,
  };
}

function agenda(topics: Agenda["topics"]): Agenda {
  return { meetingId: MEETING, seriesId: SERIES, current: true, topics, decisions: [], tasks: [] };
}

describe("the agenda of a meeting", () => {
  it("lists all open topics in order and moves one with the arrow buttons", async () => {
    const api = mockApi({
      [`GET /api/v1/meetings/${MEETING}/agenda`]: () => ({
        body: agenda([topic(FIREWALL, "Firewall"), topic(PRINTERS, "Printers")]),
      }),
      [`PUT /api/v1/meeting-series/${SERIES}/topic-order`]: () => ({ status: 204 }),
    });
    await renderWithProviders(inRouter(<AgendaSection meetingId={MEETING} spaceKey="ITOPS" writable />));
    const list = await screen.findByRole("list", { name: /Open topics/ });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([expect.stringContaining("Firewall"), expect.stringContaining("Printers")]);
    await userEvent.click(screen.getByRole("button", { name: "Move Printers up" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "PUT")?.body).toEqual({
        topicId: PRINTERS,
        afterId: null,
      }),
    );
    expect(screen.getByRole("button", { name: "Move Printers" })).toBeTruthy();
    await userEvent.click(await screen.findByRole("button", { name: /Undo/ }));
    await waitFor(() =>
      expect(api.requests.filter((request) => request.method === "PUT").at(-1)?.body).toEqual({
        topicId: PRINTERS,
        afterId: FIREWALL,
      }),
    );
    expect(screen.getByRole("link", { name: "archive of the series" })).toBeTruthy();
  });

  it("saves the update of this meeting by itself and needs text to close as a decision", async () => {
    const api = mockApi({
      [`GET /api/v1/meetings/${MEETING}/agenda`]: () => ({ body: agenda([topic(FIREWALL, "Firewall")]) }),
      [`PUT /api/v1/meetings/${MEETING}/topics/${FIREWALL}/update`]: () => ({ status: 204 }),
    });
    await renderWithProviders(inRouter(<AgendaSection meetingId={MEETING} spaceKey="ITOPS" writable />));
    await userEvent.click(await screen.findByRole("button", { name: "Show Firewall" }));
    await userEvent.click(screen.getByRole("button", { name: "Close as decision" }));
    expect(await screen.findByText("Write the decision into the field, then click again.")).toBeTruthy();
    const field = screen.getByRole("textbox", { name: "Update on Firewall in this meeting" });
    expect(document.activeElement).toBe(field);
    await userEvent.type(field, "Window on 1 Nov.");
    await waitFor(
      () =>
        expect(api.requests.find((request) => request.path.endsWith("/update"))?.body).toEqual({
          text: "Window on 1 Nov.",
        }),
      { timeout: 3000 },
    );
  });

  it("refuses to edit an update with formatting and shows a closed meeting read-only", async () => {
    mockApi({
      [`GET /api/v1/meetings/${MEETING}/agenda`]: () => ({
        body: {
          ...agenda([topic(FIREWALL, "Firewall", { update: { text: "Bold", formatted: true } })]),
          current: false,
        },
      }),
    });
    await renderWithProviders(inRouter(<AgendaSection meetingId={MEETING} spaceKey="ITOPS" writable />));
    expect(await screen.findByRole("heading", { name: /Topics of this meeting/ })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show Firewall" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Move Firewall" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });
});

const meeting: Meeting = {
  id: MEETING,
  seriesId: SERIES,
  seriesTitle: "Jour fixe IT",
  title: "Jour fixe IT · 2 Nov 2026",
  state: "upcoming",
  current: true,
  startsAt: "2026-11-02T08:30:00.000Z",
  recurrenceId: "2026-11-02T08:30:00.000Z",
  durationMinutes: 60,
  timeZone: "Europe/Vienna",
  closedAt: null,
  closedBy: null,
  nextMeetingId: null,
  rhythm: true,
  extra: false,
  attendees: [
    {
      id: LENA.id,
      name: LENA.name,
      pictureRef: null,
      attendance: null,
      member: true,
      active: true,
      canRead: true,
    },
  ],
  guests: [],
  calendarUid: null,
};

describe("the head of a meeting", () => {
  it("records attendance with a select and adds a guest without an account", async () => {
    const api = mockApi({
      [`GET /api/v1/meetings/${MEETING}`]: () => ({ body: meeting }),
      [`PUT /api/v1/meetings/${MEETING}/attendees/${LENA.id}`]: () => ({ status: 204 }),
      [`POST /api/v1/meetings/${MEETING}/guests`]: () => ({ status: 201, body: { id: SPACE } }),
    });
    await renderWithProviders(inRouter(<MeetingHeader meetingId={MEETING} spaceKey="ITOPS" writable />));
    await userEvent.click(await screen.findByRole("combobox", { name: "Attendance of Lena Hofer" }));
    await userEvent.click(await screen.findByRole("option", { name: "Present" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.path.endsWith(`/attendees/${LENA.id}`))?.body).toEqual({
        attendance: "present",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Person" }));
    await userEvent.click(screen.getByRole("radio", { name: "Person without an account" }));
    await userEvent.click(screen.getByRole("button", { name: "Add to this meeting" }));
    expect(await screen.findByText("Enter the name of the person.")).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Martin Huber");
    await userEvent.click(screen.getByRole("button", { name: "Add to this meeting" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.path.endsWith("/guests"))?.body).toEqual({
        name: "Martin Huber",
        note: null,
      }),
    );
  });

  it("plans an additional meeting from the date menu", async () => {
    mockApi({ [`GET /api/v1/meetings/${MEETING}`]: () => ({ body: meeting }) });
    await renderWithProviders(inRouter(<MeetingHeader meetingId={MEETING} spaceKey="ITOPS" writable />));
    await userEvent.click(await screen.findByRole("button", { name: "Date" }));
    expect(await screen.findByRole("menuitem", { name: "Move meeting" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Skip meeting" })).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: "Add additional meeting" }));
    expect(await screen.findByRole("form", { name: "Add additional meeting" })).toBeTruthy();
  });
});

const series = {
  id: SERIES,
  spaceId: SPACE,
  title: "Jour fixe IT",
  parentId: null,
  archived: false,
  oneOnOne: false,
  members: [{ ...LENA, pictureRef: null, active: true, canRead: true }],
  schedule: {
    rhythm: { frequency: "weekly", interval: 1, weekdays: ["MO"] },
    recurrence: "FREQ=WEEKLY;BYDAY=MO",
    startsOn: "2026-10-05",
    startTime: "09:30",
    timeZone: "Europe/Vienna",
    durationMinutes: 60,
  },
  template: { id: "builtin:team-meeting", name: "Team meeting" },
  reminder: "oneDay",
  source: "manual",
  calendarUid: null,
  upcoming: null,
  openTopics: 0,
  overview: {
    columns: [["topics"], ["decisions"]],
    hidden: ["tasks", "meetings", "attendance", "links"],
    links: [],
  },
  createdAt: "2026-10-01T08:00:00.000Z",
} as unknown as Series;

describe("the overview of a series", () => {
  it("moves a module into the other column and hides one, for everyone", async () => {
    const api = mockApi({
      [`GET /api/v1/meeting-series/${SERIES}/topics?status=open`]: () => ({ body: [] }),
      [`GET /api/v1/meeting-series/${SERIES}/decisions?limit=5`]: () => ({ body: [] }),
      [`PUT /api/v1/meeting-series/${SERIES}/overview`]: () => ({ status: 204 }),
      [`GET /api/v1/meeting-series/${SERIES}`]: () => ({ body: series }),
    });
    await renderWithProviders(
      inRouter(<SeriesOverview series={series} spaceKey="ITOPS" customizing onOpenTab={() => undefined} />),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Move Open topics to the right column" }),
    );
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "PUT")?.body).toEqual({
        columns: [[], ["decisions", "topics"]],
        hidden: ["tasks", "meetings", "attendance", "links"],
        links: [],
      }),
    );
    expect(screen.getByRole("button", { name: "Move Decisions" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Attendance" })).toBeTruthy();
  });
});
