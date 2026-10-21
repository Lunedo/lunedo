import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { mockApi, problem, renderWithProviders } from "../../testing/render.js";
import { SpaceContext } from "../space-context.js";
import type { SpaceWithRole } from "../space-queries.js";
import { PageTree } from "./page-tree.js";

const space = { id: "0192f0c4-7c3a-7d2e-9f4b-3c2d1e0f5a40", key: "IT", role: "editor" } as SpaceWithRole;
const items = `GET /api/v1/spaces/${space.id}/items`;
const folder = {
  id: "0192f0c4-7c3a-7d2e-9f4b-3c2d1e0f5a41",
  kind: "folder",
  title: "Runbooks",
  parentId: null,
  hasChildren: true,
  link: null,
};
const child = "0192f0c4-7c3a-7d2e-9f4b-3c2d1e0f5a42";

function inSpace(ui: ReactNode) {
  const context = { space, canEdit: true, openMove: () => {}, openCopy: () => {}, openCreate: () => {} };
  const root = createRootRoute({ component: () => <SpaceContext value={context}>{ui}</SpaceContext> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return <RouterProvider router={router} />;
}

describe("PageTree", () => {
  it("shows the loading first level next to a busy, empty tree", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    await renderWithProviders(<PageTree space={space} currentId={null} ancestors={[]} />);
    const tree = screen.getByRole("tree", { name: "Page tree" });
    expect(tree.getAttribute("aria-busy")).toBe("true");
    expect(tree.children).toHaveLength(0);
    expect(screen.getByText("Loading pages")).toBeTruthy();
  });

  it("shows a failed first level with its retry next to the tree", async () => {
    mockApi({ [items]: () => problem(500, "internal") });
    await renderWithProviders(<PageTree space={space} currentId={null} ancestors={[]} />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    const tree = screen.getByRole("tree", { name: "Page tree" });
    expect(within(tree).queryByRole("button")).toBeNull();
    expect(tree.contains(retry)).toBe(false);
    expect(tree.hasAttribute("aria-busy")).toBe(false);
  });

  it("is busy while a level below an open item loads, without a status inside the tree, and no longer once it has loaded", async () => {
    let release: (value: { body: unknown }) => void = () => {};
    mockApi({
      [items]: ({ path }) =>
        path.includes("parentId=")
          ? new Promise((resolve) => {
              release = resolve;
            })
          : { body: { items: [folder], nextCursor: null } },
    });
    await renderWithProviders(inSpace(<PageTree space={space} currentId={null} ancestors={[folder.id]} />));
    const tree = await screen.findByRole("tree", { name: "Page tree" });
    const loading = await within(tree).findByText("Loading pages");
    expect(loading.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(within(tree).queryByRole("status")).toBeNull();
    expect(tree.getAttribute("aria-busy")).toBe("true");

    release({
      body: {
        items: [{ ...folder, id: child, title: "Restart", parentId: folder.id, hasChildren: false }],
        nextCursor: null,
      },
    });
    await within(tree).findByRole("treeitem", { name: "Restart" });
    expect(tree.hasAttribute("aria-busy")).toBe(false);
  });

  it("is no longer busy once the first level has loaded", async () => {
    mockApi({ [items]: () => ({ body: { items: [], nextCursor: null } }) });
    await renderWithProviders(<PageTree space={space} currentId={null} ancestors={[]} />);
    const tree = screen.getByRole("tree", { name: "Page tree" });
    await waitFor(() => expect(tree.hasAttribute("aria-busy")).toBe(false));
  });

  it("lists translations first below their original and names their language", async () => {
    const original = { ...folder, kind: "page", title: "Set up the VPN", hasChildren: true };
    mockApi({
      [items]: ({ path }) =>
        path.includes("parentId=")
          ? {
              body: {
                items: [
                  {
                    ...original,
                    id: child,
                    title: "Split tunnel",
                    parentId: original.id,
                    hasChildren: false,
                  },
                  {
                    ...original,
                    id: "0192f0c4-7c3a-7d2e-9f4b-3c2d1e0f5a43",
                    title: "Set up the VPN",
                    parentId: original.id,
                    hasChildren: false,
                    translationOf: original.id,
                    contentLanguage: "de",
                  },
                ],
                nextCursor: null,
              },
            }
          : { body: { items: [original], nextCursor: null } },
    });
    await renderWithProviders(inSpace(<PageTree space={space} currentId={null} ancestors={[original.id]} />));
    const tree = await screen.findByRole("tree", { name: "Page tree" });
    const translation = await within(tree).findByRole("treeitem", {
      name: "Set up the VPN (German translation)",
    });
    expect(within(translation).getByText("DE")).toBeTruthy();
    const levelTwo = within(tree)
      .getAllByRole("treeitem")
      .filter((item) => item.getAttribute("aria-level") === "2");
    expect(levelTwo.map((item) => item.getAttribute("aria-label"))).toEqual([
      "Set up the VPN (German translation)",
      "Split tunnel",
    ]);
  });

  it("offers more children and a failed level as items of the tree", async () => {
    mockApi({
      [items]: ({ path }) =>
        path.includes("parentId=")
          ? problem(500, "internal")
          : { body: { items: [folder], nextCursor: "next" } },
    });
    await renderWithProviders(inSpace(<PageTree space={space} currentId={null} ancestors={[folder.id]} />));
    const tree = await screen.findByRole("tree", { name: "Page tree" });
    expect(await within(tree).findByRole("treeitem", { name: "Show more" })).toBeTruthy();
    const failed = await within(tree).findByRole("treeitem", { name: /Try again/ });
    expect(within(failed).getByRole("button", { name: "Try again" })).toBeTruthy();
    for (const button of within(tree).getAllByRole("button", { hidden: true })) {
      expect(button.closest('[role="treeitem"]')).not.toBeNull();
    }
  });
});
