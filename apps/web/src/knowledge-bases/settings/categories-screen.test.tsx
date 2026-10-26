import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceContext, type SpaceContextValue } from "../../spaces/space-context.js";
import type { SpaceWithRole } from "../../spaces/space-queries.js";
import { mockApi, problem, renderWithProviders } from "../../testing/render.js";
import { CategoriesScreen } from "./categories-screen.js";
import { wrapSelection } from "./introduction-editor.js";

const SPACE_ID = "01929b1e-0000-7000-8000-0000000000b1";
const id = (suffix: string) => `01929b1e-0000-7000-8000-0000000000${suffix}`;

function folder(
  suffix: string,
  title: string,
  parent: string | null,
  level: number,
  extra: Partial<{ description: string; contactEmail: string | null; icon: string | null }> = {},
) {
  return {
    id: id(suffix),
    parentId: parent ? id(parent) : null,
    level,
    title,
    description: extra.description ?? "",
    icon: extra.icon ?? null,
    contactEmail: extra.contactEmail ?? null,
    effectiveContactEmail: extra.contactEmail ?? null,
    contactSource: extra.contactEmail ? ("category" as const) : null,
    position: "a0",
    articles: 2,
  };
}

const FOLDERS = [
  folder("01", "IT", null, 1, { contactEmail: "it@example.org", icon: "monitor" }),
  folder("02", "HR", null, 1),
  folder("03", "Microsoft", "01", 2),
  folder("04", "Outlook", "03", 3, { description: "Mail in the **browser**" }),
  folder("05", "Web App", "04", 4),
  folder("06", "Teams", "03", 3),
];

function context(role: "admin" | "editor" = "admin", openCreate = vi.fn()): SpaceContextValue {
  return {
    space: {
      id: SPACE_ID,
      key: "HELP",
      type: "knowledgeBase",
      name: "Help",
      archived: false,
      role,
    } as SpaceWithRole,
    canEdit: true,
    openMove: () => undefined,
    openCopy: () => undefined,
    openCreate,
  };
}

function routes(extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    [`GET /api/v1/spaces/${SPACE_ID}/categories`]: () => ({ body: FOLDERS }),
    [`GET /api/v1/spaces/${SPACE_ID}/knowledge-base`]: () => ({
      body: { spaceId: SPACE_ID, audience: "public", groups: [], contactEmail: "help@example.org" },
    }),
    ...extra,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("areas and topics of a knowledge base", () => {
  it("shows folders of any depth and edits the chosen one with its inherited contact", async () => {
    routes();
    await renderWithProviders(
      <SpaceContext value={context()}>
        <CategoriesScreen />
      </SpaceContext>,
    );
    const tree = await screen.findByRole("list", { name: "Folder tree" });
    expect(
      within(tree)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining("IT"),
      expect.stringContaining("Microsoft"),
      expect.stringContaining("Outlook"),
      expect.stringContaining("Web App"),
      expect.stringContaining("Teams"),
      expect.stringContaining("HR"),
    ]);
    await userEvent.click(within(tree).getByRole("button", { name: /^Web App/ }));
    expect(await screen.findByText("IT › Microsoft › Outlook")).toBeTruthy();
    expect(screen.getByText("Inherited from IT")).toBeTruthy();
    await userEvent.click(within(tree).getByRole("button", { name: "Collapse Microsoft" }));
    expect(within(tree).queryByText("Outlook")).toBeNull();
  });

  it("previews the formatted introduction", async () => {
    routes();
    await renderWithProviders(
      <SpaceContext value={context()}>
        <CategoriesScreen />
      </SpaceContext>,
    );
    const tree = await screen.findByRole("list", { name: "Folder tree" });
    await userEvent.click(within(tree).getByRole("button", { name: /^Outlook/ }));
    const preview = await screen.findByRole("region", { name: "Preview" });
    expect(within(preview).getByText("browser").tagName).toBe("STRONG");
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    const field = screen.getByRole("textbox", { name: "Introduction" });
    expect(toolbar.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("moves a folder into the folder above from its menu and confirms a change of access", async () => {
    let attempts = 0;
    const api = routes({
      [`POST /api/v1/items/${id("06")}/move`]: (request) => {
        attempts += 1;
        if (!(request.body as { confirmation?: string }).confirmation) {
          return problem(409, "moveChangesAccess", {
            impact: {
              gaining: 0,
              losing: 1,
              raised: 0,
              lowered: 0,
              unlisted: 0,
              truncated: false,
              changes: [{ accountId: id("99"), name: "Anna Berger", before: "reader", after: null }],
              leavesConfidential: false,
              confirmation: "signed",
            },
          });
        }
        return { body: {} };
      },
    });
    await renderWithProviders(
      <SpaceContext value={context()}>
        <CategoriesScreen />
      </SpaceContext>,
    );
    const tree = await screen.findByRole("list", { name: "Folder tree" });
    await userEvent.click(within(tree).getByRole("button", { name: "Actions for Teams" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Move into the folder above" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /Move/ }));
    await waitFor(() => expect(attempts).toBe(2));
    const moves = api.requests.filter((entry) => entry.path.endsWith("/move"));
    expect(moves[0]?.body).toEqual({ parentId: id("04"), afterId: id("05") });
    expect(moves[1]?.body).toEqual({ parentId: id("04"), afterId: id("05"), confirmation: "signed" });
  });

  it("lets editors create a topic inside a folder but only space admins change contacts", async () => {
    routes();
    const openCreate = vi.fn();
    await renderWithProviders(
      <SpaceContext value={context("editor", openCreate)}>
        <CategoriesScreen />
      </SpaceContext>,
    );
    const tree = await screen.findByRole("list", { name: "Folder tree" });
    await userEvent.click(within(tree).getByRole("button", { name: "Actions for Outlook" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "New topic inside" }));
    expect(openCreate).toHaveBeenCalledWith("folder", id("04"));
    expect(
      screen
        .getAllByRole("textbox", { name: "Contact address" })
        .every((field) => field.hasAttribute("disabled")),
    ).toBe(true);
  });
});

describe("formatting the introduction", () => {
  it("wraps the selection and toggles a callout on whole lines", () => {
    expect(wrapSelection("Use VPN", 4, 7, "bold", "text")).toEqual({
      value: "Use **VPN**",
      start: 6,
      end: 9,
    });
    expect(wrapSelection("Use ", 4, 4, "link", "text").value).toBe("Use [text](https://)");
    expect(wrapSelection("One\nTwo", 5, 5, "callout", "text").value).toBe("One\n> Two");
    expect(wrapSelection("One\n> Two", 6, 6, "callout", "text").value).toBe("One\nTwo");
  });
});
