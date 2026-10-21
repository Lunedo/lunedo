import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { mockApi, renderWithProviders } from "../../testing/render.js";
import type { SpaceWithRole } from "../space-queries.js";
import { CreateItemDialog } from "./create-item-dialog.js";

const knowledgeBase = {
  id: "01929b1e-0000-7000-8000-0000000000a1",
  key: "HELP",
  name: "Help Center",
  type: "knowledgeBase",
  role: "admin",
} as SpaceWithRole;
const standard = { ...knowledgeBase, key: "IT", name: "IT Operations", type: "standard" } as SpaceWithRole;
const CATEGORY = "01929b1e-0000-7000-8000-0000000000c1";

function inRouter(ui: ReactNode) {
  const root = createRootRoute({ component: () => ui });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return <RouterProvider router={router} />;
}

describe("creating a folder", () => {
  it("speaks of categories and subcategories in a knowledge base", async () => {
    mockApi({});
    await renderWithProviders(
      inRouter(
        <CreateItemDialog
          space={knowledgeBase}
          request={{ kind: "folder", parentId: null }}
          onOpenChange={() => undefined}
        />,
      ),
    );
    const dialog = await screen.findByRole("dialog", { name: "New category" });
    expect(
      within(dialog).getByText("Optional. Readers see it at the top of the category in the portal."),
    ).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Create category" })).toBeTruthy();
    expect(within(dialog).queryByText(/folder/i)).toBeNull();
  });

  it("names a folder below a category a subcategory", async () => {
    mockApi({});
    await renderWithProviders(
      inRouter(
        <CreateItemDialog
          space={knowledgeBase}
          request={{ kind: "folder", parentId: CATEGORY }}
          onOpenChange={() => undefined}
        />,
      ),
    );
    const dialog = await screen.findByRole("dialog", { name: "New subcategory" });
    expect(within(dialog).getByRole("button", { name: "Create subcategory" })).toBeTruthy();
  });

  it("keeps folders in other spaces", async () => {
    mockApi({});
    await renderWithProviders(
      inRouter(
        <CreateItemDialog
          space={standard}
          request={{ kind: "folder", parentId: null }}
          onOpenChange={() => undefined}
        />,
      ),
    );
    const dialog = await screen.findByRole("dialog", { name: "New folder" });
    expect(within(dialog).getByRole("button", { name: "Create folder" })).toBeTruthy();
  });
});
