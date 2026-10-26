import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpaceWithRole } from "../spaces/space-queries.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { type CategoryAccess, CategoryAccessDialog, CategoryAccessSummary } from "./category-access.js";
import { rootsWithMine } from "./category-tree.js";

const SPACE_ID = "01929b1e-0000-7000-8000-0000000000b1";
const IT = { id: "01929b1e-0000-7000-8000-0000000000c1", name: "IT" };
const HR = { id: "01929b1e-0000-7000-8000-0000000000c2", name: "People" };

const SPACE = {
  id: SPACE_ID,
  key: "HELP",
  type: "knowledgeBase",
  name: "Help",
  organizationId: "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f",
  role: "admin",
} as SpaceWithRole;

function category(overrides: Partial<CategoryAccess> = {}): CategoryAccess {
  return {
    itemId: "01929b1e-0000-7000-8000-0000000000f1",
    parentId: null,
    title: "IT and devices",
    readable: true,
    responsibleGroups: [IT],
    inheritedResponsibleGroups: null,
    visibleTo: null,
    visibleToPeople: 0,
    inheritedVisibleTo: null,
    articles: 42,
    subcategories: 3,
    mine: true,
    writable: true,
    ...overrides,
  };
}

const NO_EFFECT = {
  articles: 42,
  widening: false,
  losingWrite: [],
  losingWriteCount: 0,
  losingRead: 0,
  gainingRead: 0,
  publicPortalLosesAccess: false,
  unlisted: 0,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the access of a category", () => {
  it("shows who maintains and who reads it, and that it is hidden from others", async () => {
    await renderWithProviders(<CategoryAccessSummary entry={category({ inheritedVisibleTo: [HR] })} />);
    expect(screen.getByText("Visible to certain groups only")).toBeTruthy();
    expect(screen.getByText(/Only People can see this category/)).toBeTruthy();
    expect(screen.getByText("IT")).toBeTruthy();
  });

  it("names everyone with the role Editor when no group is responsible", async () => {
    await renderWithProviders(<CategoryAccessSummary entry={category({ responsibleGroups: null })} />);
    expect(screen.getByText("Everyone with the role Editor")).toBeTruthy();
    expect(screen.getByText("Like the knowledge base")).toBeTruthy();
  });

  it("shows the effect before saving and asks before more people may read", async () => {
    const api = mockApi({
      [`POST /api/v1/spaces/${SPACE_ID}/knowledge-base/categories/${category().itemId}/access/preview`]: (
        request,
      ) => ({
        body:
          (request.body as { visibleGroupIds: string[] | null }).visibleGroupIds === null
            ? { ...NO_EFFECT, widening: true, gainingRead: 310 }
            : {
                ...NO_EFFECT,
                losingWrite: [{ accountId: "a1", name: "Lukas Hofer" }],
                losingWriteCount: 1,
              },
      }),
      [`PUT /api/v1/spaces/${SPACE_ID}/knowledge-base/categories/${category().itemId}/access`]: (request) =>
        (request.body as { confirmWidening: boolean }).confirmWidening
          ? { body: category() }
          : problem(409, "categoryVisibilityWidening", { articles: 42 }),
    });
    const onOpenChange = vi.fn();
    await renderWithProviders(
      <CategoryAccessDialog
        space={SPACE}
        entry={category({ visibleTo: [HR] })}
        open
        onOpenChange={onOpenChange}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Access to “IT and devices”" });
    expect(
      await within(dialog).findByText(/Lukas Hofer can only read the 42 articles afterwards/),
    ).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("radio", { name: /Like the knowledge base/ }));
    expect(await within(dialog).findByText(/310 people can newly read the 42 articles/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save access" }));
    const confirm = await screen.findByRole("dialog", { name: "Let more people read the category?" });
    expect(within(confirm).getByText(/42 articles in “IT and devices” become readable/)).toBeTruthy();
    await userEvent.click(within(confirm).getByRole("button", { name: "Let more people read" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const saves = api.requests.filter((entry) => entry.method === "PUT");
    expect(saves.map((entry) => (entry.body as { confirmWidening: boolean }).confirmWidening)).toEqual([
      false,
      true,
    ]);
  });

  it("asks for a group when only certain groups may read, and focuses the field", async () => {
    const api = mockApi({
      [`POST /api/v1/spaces/${SPACE_ID}/knowledge-base/categories/${category().itemId}/access/preview`]:
        () => ({
          body: NO_EFFECT,
        }),
    });
    await renderWithProviders(
      <CategoryAccessDialog space={SPACE} entry={category()} open onOpenChange={() => undefined} />,
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("radio", { name: /Only certain groups/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save access" }));
    expect(
      await within(dialog).findByText("Choose at least one group that may see the category."),
    ).toBeTruthy();
    expect(api.requests.some((entry) => entry.method === "PUT")).toBe(false);
  });
});

describe("my categories", () => {
  it("are the top-level categories that hold one of my categories", () => {
    const top = category({ itemId: "top", mine: false });
    const sub = category({ itemId: "sub", parentId: "top", mine: true });
    const other = category({ itemId: "other", mine: false });
    expect([...rootsWithMine([top, sub, other])]).toEqual(["top"]);
  });
});
