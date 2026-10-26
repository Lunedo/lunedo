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

  it("shows the pages below the home page as the first level, without the home page and without meeting series", async () => {
    const home = "0192f0c4-7c3a-7d2e-9f4b-3c2d1e0f5a50";
    const withHome = { ...space, overviewItemId: home } as SpaceWithRole;
    const page = (id: string, title: string, parentId: string | null, kind = "page") => ({
      ...folder,
      id,
      kind,
      title,
      parentId,
      hasChildren: false,
      published: true,
    });
    mockApi({
      [items]: ({ path }) =>
        path.includes(`parentId=${home}`)
          ? {
              body: {
                items: [
                  page(child, "Network", home),
                  page("0192f0c4-7c3a-7d2e-9f4b-3c2d1e0f5a51", "Weekly sync", home, "meetingSeries"),
                ],
                nextCursor: null,
              },
            }
          : {
              body: {
                items: [
                  { ...page(home, "IT Operations", null), hasChildren: true },
                  page("0192f0c4-7c3a-7d2e-9f4b-3c2d1e0f5a52", "Imported", null),
                ],
                nextCursor: null,
              },
            },
    });
    await renderWithProviders(inSpace(<PageTree space={withHome} currentId={null} ancestors={[]} />));
    const tree = await screen.findByRole("tree", { name: "Page tree" });
    await within(tree).findByRole("treeitem", { name: "Network" });
    expect(
      within(tree)
        .getAllByRole("treeitem")
        .map((entry) => [entry.getAttribute("aria-label"), entry.getAttribute("aria-level")]),
    ).toEqual([
      ["Network", "1"],
      ["Imported", "1"],
    ]);
    expect(
      within(tree)
        .getAllByRole("treeitem")
        .filter((entry) => entry.getAttribute("tabindex") === "0"),
    ).toHaveLength(1);
  });

  it("draws the expand button of the current row on the accent fill, with a ring instead of a box on hover", async () => {
    mockApi({
      [items]: ({ path }) =>
        path.includes("parentId=")
          ? { body: { items: [], nextCursor: null } }
          : { body: { items: [folder], nextCursor: null } },
    });
    await renderWithProviders(inSpace(<PageTree space={space} currentId={folder.id} ancestors={[]} />));
    const row = await screen.findByRole("treeitem", { name: "Runbooks" });
    const toggle = row.querySelector("button") as HTMLButtonElement;
    expect(row.className).toContain("bg-accent");
    expect(toggle.className).toContain("text-on-accent");
    expect(toggle.className).toContain("hover:ring-on-accent");
    expect(toggle.className).not.toContain("hover:bg-hover");
  });

  it("opens a folder from anywhere on its row, but not from its expand button", async () => {
    mockApi({
      [items]: ({ path }) =>
        path.includes("parentId=")
          ? { body: { items: [], nextCursor: null } }
          : { body: { items: [folder], nextCursor: null } },
    });
    const context = { space, canEdit: true, openMove: () => {}, openCopy: () => {}, openCreate: () => {} };
    const root = createRootRoute({
      component: () => (
        <SpaceContext value={context}>
          <PageTree space={space} currentId={null} ancestors={[]} />
        </SpaceContext>
      ),
    });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
    await renderWithProviders(<RouterProvider router={router} />);
    const row = await screen.findByRole("treeitem", { name: "Runbooks" });
    (row.querySelector("button") as HTMLButtonElement).click();
    await waitFor(() => expect(row.getAttribute("aria-expanded")).toBe("true"));
    expect(router.state.location.pathname).toBe("/");
    ([...row.querySelectorAll("svg")].find((icon) => !icon.closest("button")) as SVGElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/spaces/IT/folders/${folder.id}/runbooks`),
    );
  });

  it("is no longer busy once the first level has loaded", async () => {
    mockApi({ [items]: () => ({ body: { items: [], nextCursor: null } }) });
    await renderWithProviders(<PageTree space={space} currentId={null} ancestors={[]} />);
    const tree = screen.getByRole("tree", { name: "Page tree" });
    await waitFor(() => expect(tree.hasAttribute("aria-busy")).toBe(false));
  });

  it("lists translations first below their original and names their language", async () => {
    const original = { ...folder, kind: "page", title: "Set up the VPN", hasChildren: true, published: true };
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
      name: "Set up the VPN DE (German translation)",
    });
    expect(within(translation).getByText("DE")).toBeTruthy();
    const levelTwo = within(tree)
      .getAllByRole("treeitem")
      .filter((item) => item.getAttribute("aria-level") === "2");
    expect(levelTwo.map((item) => item.getAttribute("aria-label"))).toEqual([
      "Set up the VPN DE (German translation)",
      "Split tunnel",
    ]);
  });

  it("names every badge it shows, so the name contains the visible text", async () => {
    const page = { ...folder, kind: "page", title: "Set up the VPN", hasChildren: true, published: false };
    mockApi({
      [items]: ({ path }) =>
        path.includes("parentId=")
          ? {
              body: {
                items: [
                  {
                    ...page,
                    id: child,
                    parentId: page.id,
                    hasChildren: false,
                    translationOf: page.id,
                    contentLanguage: "de",
                  },
                ],
                nextCursor: null,
              },
            }
          : { body: { items: [page], nextCursor: null } },
    });
    await renderWithProviders(inSpace(<PageTree space={space} currentId={null} ancestors={[page.id]} />));
    const tree = await screen.findByRole("tree", { name: "Page tree" });
    const original = await within(tree).findByRole("treeitem", { name: "Set up the VPN, Draft" });
    expect(within(original).getByText("Draft")).toBeTruthy();
    const translation = await within(tree).findByRole("treeitem", {
      name: "Set up the VPN DE (German translation), Draft",
    });
    expect(within(translation).getByText("DE")).toBeTruthy();
    expect(within(translation).getByText("Draft")).toBeTruthy();
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
