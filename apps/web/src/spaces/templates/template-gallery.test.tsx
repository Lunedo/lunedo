import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { mockApi, renderWithProviders } from "../../testing/render.js";
import type { SpaceWithRole } from "../space-queries.js";
import { TemplateGallery } from "./template-gallery.js";

const SPACE_ID = "01929b1e-0000-7000-8000-0000000000a1";
const IT = "01929b1e-0000-7000-8000-0000000000c1";
const REMOTE = "01929b1e-0000-7000-8000-0000000000c2";
const ARTICLE = "01929b1e-0000-7000-8000-0000000000d1";

const space = {
  id: SPACE_ID,
  key: "HELP",
  name: "Help Center",
  type: "knowledgeBase",
  personal: false,
  role: "editor",
} as SpaceWithRole;

const category = (id: string, title: string, parentId: string | null, position: string) => ({
  id,
  parentId,
  level: parentId ? 2 : 1,
  title,
  description: "",
  icon: null,
  contactEmail: null,
  effectiveContactEmail: null,
  contactSource: null,
  position,
  articles: 0,
});

function inRouter(ui: ReactNode) {
  const root = createRootRoute({ component: () => ui });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return <RouterProvider router={router} />;
}

function knowledgeBaseApi() {
  return mockApi({
    [`GET /api/v1/spaces/${SPACE_ID}/template-gallery`]: () => ({ body: [] }),
    [`GET /api/v1/spaces/${SPACE_ID}/categories`]: () => ({
      body: [category(IT, "IT", null, "a0"), category(REMOTE, "Remote access", IT, "a0")],
    }),
    [`POST /api/v1/spaces/${SPACE_ID}/items`]: () => ({
      status: 201,
      body: { id: ARTICLE, spaceId: SPACE_ID, kind: "page", title: "Untitled article", link: null },
    }),
  });
}

describe("the gallery in a knowledge base", () => {
  it("speaks of articles and puts the new article into the chosen category", async () => {
    const { requests } = knowledgeBaseApi();
    await renderWithProviders(
      inRouter(<TemplateGallery space={space} parentId={null} onOpenChange={() => undefined} />),
    );
    const dialog = await screen.findByRole("dialog", { name: "New article in Help Center" });
    expect(await within(dialog).findByRole("button", { name: /Blank article/, pressed: true })).toBeTruthy();
    expect(within(dialog).queryByText("All categories")).toBeNull();
    expect(within(dialog).queryByText(/page/i)).toBeNull();
    const choice = await within(dialog).findByRole("combobox", { name: "Category" });
    await waitFor(() => expect(choice.hasAttribute("disabled")).toBe(false));
    await userEvent.click(choice);
    await userEvent.click(await screen.findByRole("option", { name: "IT › Remote access" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create blank article" }));
    await waitFor(() =>
      expect(requests.find((request) => request.method === "POST")?.body).toEqual({
        kind: "page",
        title: "Untitled article",
        parentId: REMOTE,
      }),
    );
  });

  it("starts with the category the article is created in", async () => {
    const { requests } = knowledgeBaseApi();
    await renderWithProviders(
      inRouter(<TemplateGallery space={space} parentId={IT} onOpenChange={() => undefined} />),
    );
    const dialog = await screen.findByRole("dialog", { name: "New article in Help Center" });
    await within(dialog).findByRole("combobox", { name: "Category" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Title of the article/ }), "Printer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create blank article" }));
    await waitFor(() =>
      expect(requests.find((request) => request.method === "POST")?.body).toMatchObject({
        title: "Printer",
        parentId: IT,
      }),
    );
  });
});
