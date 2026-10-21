import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { mockApi, renderWithProviders } from "../testing/render.js";
import { SpaceExport } from "./space-export.js";

const knowledgeBase = { id: "01929b1e-0000-7000-8000-0000000000a1" };

function inRouter(ui: ReactNode) {
  const root = createRootRoute({ component: () => ui });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return <RouterProvider router={router} />;
}

describe("exporting a knowledge base", () => {
  it("speaks of articles instead of pages and blog posts", async () => {
    mockApi({
      [`GET /api/v1/spaces/${knowledgeBase.id}/exports`]: () => ({ body: { items: [], nextCursor: null } }),
    });
    await renderWithProviders(
      inRouter(
        <SpaceExport
          space={{
            id: knowledgeBase.id,
            key: "HELP",
            name: "Help Center",
            exportEnabled: true,
            admin: true,
            knowledgeBase: true,
          }}
        />,
      ),
    );
    expect(await screen.findByText(/^Export every article you can read/)).toBeTruthy();
    expect(screen.queryByText(/blog post/)).toBeNull();
  });
});
