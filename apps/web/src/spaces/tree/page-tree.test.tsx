import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mockApi, problem, renderWithProviders } from "../../testing/render.js";
import type { SpaceWithRole } from "../space-queries.js";
import { PageTree } from "./page-tree.js";

const space = { id: "0192f0c4-7c3a-7d2e-9f4b-3c2d1e0f5a40", key: "IT", role: "editor" } as SpaceWithRole;
const items = `GET /api/v1/spaces/${space.id}/items`;

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

  it("is no longer busy once the first level has loaded", async () => {
    mockApi({ [items]: () => ({ body: { items: [], nextCursor: null } }) });
    await renderWithProviders(<PageTree space={space} currentId={null} ancestors={[]} />);
    const tree = screen.getByRole("tree", { name: "Page tree" });
    await waitFor(() => expect(tree.hasAttribute("aria-busy")).toBe(false));
  });
});
