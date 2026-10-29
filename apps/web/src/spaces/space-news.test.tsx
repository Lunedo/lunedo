import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { SpaceNews } from "./space-news.js";
import { contentQuery } from "./space-queries.js";

const spaceId = "0192a000-0000-7000-8000-000000000001";
const overviewId = "0192a000-0000-7000-8000-000000000002";

function inRouter() {
  const root = createRootRoute({
    component: () => (
      <PreferencesProvider>
        <SpaceNews spaceId={spaceId} overviewId={overviewId} />
      </PreferencesProvider>
    ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return <RouterProvider router={router} />;
}

const content = {
  itemId: overviewId,
  title: "Space overview",
  version: 1,
  document: { type: "doc", content: [] },
  schemaVersion: 2,
  revision: 1,
  updatedAt: "2026-10-05T08:10:00.000Z",
  updatedBy: null,
  references: { people: {}, pages: {}, topics: {}, tooLargeImages: [] },
};

const newest = [
  {
    id: overviewId,
    number: 1001,
    kind: "page",
    title: "Space overview",
    path: "/spaces/OPS/pages/1001/space-overview",
    author: null,
    contentUpdatedAt: "2026-10-05T08:10:00.000Z",
  },
  {
    id: "0192a000-0000-7000-8000-000000000003",
    number: 1002,
    kind: "blogPost",
    title: "Launch notes",
    path: "/spaces/OPS/blog/1002/launch-notes",
    author: { id: "0192a000-0000-7000-8000-000000000004", name: "Anna Berger" },
    contentUpdatedAt: "2026-10-04T08:10:00.000Z",
  },
];

describe("the news of a space", () => {
  it("waits for the content of the overview before it asks for the newest pages", async () => {
    const calls = mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`GET /api/v1/spaces/${spaceId}/newest-content`]: () => ({ body: newest }),
    });
    await renderWithProviders(inRouter());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.requests.filter((request) => request.path.includes("newest-content"))).toEqual([]);
  });

  it("lists the newest content without the overview once the content has loaded", async () => {
    const calls = mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`GET /api/v1/spaces/${spaceId}/newest-content`]: () => ({ body: newest }),
    });
    await renderWithProviders(inRouter(), "en", (queryClient) =>
      queryClient.setQueryData(contentQuery(overviewId).queryKey, content),
    );
    expect(await screen.findByText("Launch notes")).toBeTruthy();
    expect(screen.queryByText("Space overview")).toBeNull();
    await waitFor(() =>
      expect(calls.requests.some((request) => request.path.includes("newest-content?limit=6"))).toBe(true),
    );
  });
});
