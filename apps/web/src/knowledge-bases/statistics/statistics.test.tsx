import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../../preferences/preferences-provider.js";
import { SpaceContext, type SpaceContextValue } from "../../spaces/space-context.js";
import type { SpaceWithRole } from "../../spaces/space-queries.js";
import { mockApi, renderWithProviders } from "../../testing/render.js";
import type { Statistics } from "./queries.js";
import { StatisticsScreen } from "./statistics-screen.js";

const SPACE_ID = "01929b1e-0000-7000-8000-0000000000b1";
const ARTICLE = "01929b1e-0000-7000-8000-0000000000d1";
const NOTE = "01929b1e-0000-7000-8000-0000000000e1";

function inSpace(ui: ReactNode, role: "admin" | "editor", openCreate: SpaceContextValue["openCreate"]) {
  const context: SpaceContextValue = {
    space: { id: SPACE_ID, key: "HELP", type: "knowledgeBase", name: "Help", role } as SpaceWithRole,
    canEdit: true,
    openMove: () => undefined,
    openCopy: () => undefined,
    openCreate,
  };
  const root = createRootRoute({
    component: () => (
      <PreferencesProvider>
        <SpaceContext value={context}>{ui}</SpaceContext>
      </PreferencesProvider>
    ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return <RouterProvider router={router} />;
}

const article = {
  id: ARTICLE,
  number: 1020,
  title: "Set up the VPN",
  categoryPath: [{ id: SPACE_ID, title: "IT" }],
};

const statistics: Statistics = {
  period: { from: "2026-09-20", to: "2026-10-19" },
  searches: { total: 200, zeroResults: 40 },
  ratings: { helpful: 30, unhelpful: 10 },
  views: 640,
  topTerms: [{ term: "vpn", searches: 120, zeroResults: 0, lastSearchedAt: "2026-10-19T08:00:00.000Z" }],
  zeroResultTerms: [
    { term: "parkausweis", searches: 37, zeroResults: 37, lastSearchedAt: "2026-10-18T14:00:00.000Z" },
  ],
  unhelpful: [{ article, helpful: 30, unhelpful: 10, feedback: 1 }],
  mostRead: [{ article, views: 640 }],
};

describe("the search statistics", () => {
  it("shows the figures and creates an article from a search without results", async () => {
    const api = mockApi({ [`GET /api/v1/spaces/${SPACE_ID}/statistics`]: () => ({ body: statistics }) });
    const openCreate = vi.fn();
    await renderWithProviders(inSpace(<StatisticsScreen />, "editor", openCreate));
    expect(await screen.findByText("20%")).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    const zero = screen.getByRole("table", { name: "Searches without results" });
    await userEvent.click(within(zero).getByRole("button", { name: "Create article for “parkausweis”" }));
    expect(openCreate).toHaveBeenCalledWith("page", null, "Parkausweis");
    await userEvent.click(screen.getByRole("radio", { name: "90 days" }));
    await waitFor(() =>
      expect(api.requests.some((request) => request.path.includes("period=90d"))).toBe(true),
    );
  });

  it("lets terms and article titles shrink so that counts and actions stay in view", async () => {
    mockApi({ [`GET /api/v1/spaces/${SPACE_ID}/statistics`]: () => ({ body: statistics }) });
    await renderWithProviders(inSpace(<StatisticsScreen />, "editor", vi.fn()));
    await screen.findByText("20%");
    for (const [name, column] of [
      ["Searches without results", "Search term"],
      ["Most frequent search terms", "Search term"],
      ["Rated as not helpful", "Article"],
      ["Most read", "Article"],
    ] as const) {
      const table = screen.getByRole("table", { name });
      expect(within(table).getByRole("columnheader", { name: column }).className).toContain("max-w-0");
    }
    const unhelpful = screen.getByRole("table", { name: "Rated as not helpful" });
    expect(
      within(unhelpful)
        .getByRole("button", { name: /Read 1 note/ })
        .closest(".hidden"),
    ).toBeNull();
  });

  it("lets admins delete a note after asking", async () => {
    const api = mockApi({
      [`GET /api/v1/spaces/${SPACE_ID}/statistics`]: () => ({ body: statistics }),
      [`GET /api/v1/spaces/${SPACE_ID}/statistics/articles/${ARTICLE}/feedback`]: () => ({
        body: {
          items: [{ id: NOTE, itemId: ARTICLE, day: "2026-10-17", text: "Step 2 looks different" }],
          nextCursor: null,
        },
      }),
      [`DELETE /api/v1/spaces/${SPACE_ID}/statistics/feedback/${NOTE}`]: () => ({ status: 204 }),
    });
    await renderWithProviders(inSpace(<StatisticsScreen />, "admin", () => undefined));
    await userEvent.click(await screen.findByRole("button", { name: "Read 1 note on “Set up the VPN”" }));
    expect(await screen.findByText("Step 2 looks different")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Delete note" }));
    expect(api.requests.some((request) => request.method === "DELETE")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Delete note for good" }));
    await waitFor(() => expect(api.requests.some((request) => request.method === "DELETE")).toBe(true));
  });

  it("offers no deletion to editors", async () => {
    mockApi({
      [`GET /api/v1/spaces/${SPACE_ID}/statistics`]: () => ({ body: statistics }),
      [`GET /api/v1/spaces/${SPACE_ID}/statistics/articles/${ARTICLE}/feedback`]: () => ({
        body: {
          items: [{ id: NOTE, itemId: ARTICLE, day: "2026-10-17", text: "Step 2 looks different" }],
          nextCursor: null,
        },
      }),
    });
    await renderWithProviders(inSpace(<StatisticsScreen />, "editor", () => undefined));
    await userEvent.click(await screen.findByRole("button", { name: "Read 1 note on “Set up the VPN”" }));
    expect(await screen.findByText("Step 2 looks different")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete note" })).toBeNull();
  });

  it("explains an empty period and offers the whole year", async () => {
    mockApi({
      [`GET /api/v1/spaces/${SPACE_ID}/statistics`]: () => ({
        body: {
          ...statistics,
          searches: { total: 0, zeroResults: 0 },
          ratings: { helpful: 0, unhelpful: 0 },
          views: 0,
          topTerms: [],
          zeroResultTerms: [],
          unhelpful: [],
          mostRead: [],
        },
      }),
    });
    await renderWithProviders(inSpace(<StatisticsScreen />, "editor", () => undefined));
    expect(await screen.findByText("No readers in this period")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show 12 months" })).toBeTruthy();
  });
});
