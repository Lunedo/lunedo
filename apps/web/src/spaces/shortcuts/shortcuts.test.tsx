import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeWebAddress, isWebAddress } from "../../forms/addresses.js";
import { PreferencesProvider } from "../../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../../testing/render.js";
import { SpaceShortcutsScreen } from "../settings/space-shortcuts-screen.js";
import { SpaceContext, type SpaceContextValue } from "../space-context.js";
import type { SpaceWithRole } from "../space-queries.js";
import { shortcutHref } from "./shortcut-queries.js";
import { SidebarShortcuts } from "./sidebar-shortcuts.js";

const SPACE = "01929b1e-0000-7000-8000-0000000000a1";
const PAGE = "01929b1e-0000-7000-8000-0000000000b1";
const FIRST = "01929b1e-0000-7000-8000-0000000000c1";
const SECOND = "01929b1e-0000-7000-8000-0000000000c2";
const HIDDEN = "01929b1e-0000-7000-8000-0000000000c3";

const space = {
  id: SPACE,
  key: "ITOPS",
  name: "IT Operations",
  description: "",
  visibility: "private",
  organizationId: "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f",
  organizationName: "Northwind",
  personal: false,
  ownerId: null,
  ownerName: null,
  overviewItemId: null,
  archived: false,
  createdAt: "2026-10-05T08:00:00.000Z",
  updatedAt: "2026-10-05T08:00:00.000Z",
  role: "admin",
} as unknown as SpaceWithRole;

const rota = {
  id: FIRST,
  label: "On-call rota",
  url: null,
  item: { id: PAGE, kind: "page", title: "On-call rota 2026", spaceKey: "ITOPS" },
  hidden: false,
  position: 0,
};
const status = {
  id: SECOND,
  label: "Status page",
  url: "https://status.example.org/",
  item: null,
  hidden: false,
  position: 1,
};
const hidden = { id: HIDDEN, label: "Pay bands", url: null, item: null, hidden: true, position: 2 };

function inRouter(ui: ReactNode) {
  const context: SpaceContextValue = { space, canEdit: true, openMove: () => {}, openCreate: () => {} };
  const root = createRootRoute({
    component: () => (
      <PreferencesProvider>
        <SpaceContext value={context}>{ui}</SpaceContext>
      </PreferencesProvider>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/spaces/$spaceKey/settings/$tab" }),
      createRoute({ getParentRoute: () => root, path: "/spaces/$spaceKey/pages/$itemId/{-$slug}" }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/spaces/ITOPS/settings/shortcuts"] }),
  });
  return <RouterProvider router={router} />;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shortcut targets", () => {
  it("accept only complete web addresses and resolve content to its path", () => {
    expect(isWebAddress(completeWebAddress("https://status.example.org"))).toBe(true);
    expect(isWebAddress(completeWebAddress("http://intranet.local/rota"))).toBe(true);
    expect(completeWebAddress("status.example.org/vpn")).toBe("https://status.example.org/vpn");
    for (const value of ["javascript:alert(1)", "data:text/html,x", "/spaces/X"]) {
      expect(isWebAddress(completeWebAddress(value))).toBe(false);
    }
    expect(shortcutHref(rota)).toEqual({
      href: `/spaces/ITOPS/pages/${PAGE}/on-call-rota-2026`,
      external: false,
    });
    expect(shortcutHref(status)).toEqual({ href: "https://status.example.org/", external: true });
    expect(shortcutHref(hidden)).toBeNull();
  });
});

describe("shortcuts in the sidebar", () => {
  it("lists shortcuts in order and opens external addresses safely in a new tab", async () => {
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`GET /api/v1/spaces/${SPACE}/shortcuts`]: () => ({ body: [rota, status] }),
    });
    await renderWithProviders(inRouter(<SidebarShortcuts spaceId={SPACE} />));
    const navigation = await screen.findByRole("navigation", { name: "Shortcuts" });
    const links = within(navigation).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "On-call rota",
      "Status page (opens in a new tab)",
    ]);
    expect(links[0]?.getAttribute("href")).toBe(`/spaces/ITOPS/pages/${PAGE}/on-call-rota-2026`);
    expect(links[0]?.getAttribute("target")).toBeNull();
    expect(links[1]?.getAttribute("target")).toBe("_blank");
    expect(links[1]?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows no section when the space has no shortcuts the person can open", async () => {
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`GET /api/v1/spaces/${SPACE}/shortcuts`]: () => ({ body: [] }),
    });
    await renderWithProviders(inRouter(<SidebarShortcuts spaceId={SPACE} />));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByRole("navigation", { name: "Shortcuts" })).toBeNull();
  });
});

describe("the shortcut settings", () => {
  function api() {
    let list = [rota, status, hidden];
    const calls = mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`GET /api/v1/spaces/${SPACE}/shortcuts/manage`]: () => ({ body: list }),
      "GET /api/v1/items": () => ({
        body: [{ id: PAGE, title: "Runbook", spaceKey: "ITOPS", spaceName: "IT Operations" }],
      }),
      [`POST /api/v1/spaces/${SPACE}/shortcuts`]: (request) => {
        const body = request.body as { label: string; target: { url?: string } };
        const created = { ...status, id: "01929b1e-0000-7000-8000-0000000000c9", label: body.label };
        list = [...list, created];
        return { status: 201, body: created };
      },
      [`PUT /api/v1/spaces/${SPACE}/shortcuts/order`]: (request) => {
        const ids = (request.body as { ids: string[] }).ids;
        list = ids.map((id) => list.find((entry) => entry.id === id) ?? rota);
        return { body: list };
      },
      [`DELETE /api/v1/spaces/${SPACE}/shortcuts/${SECOND}`]: () => {
        list = list.filter((entry) => entry.id !== SECOND);
        return { status: 204 };
      },
    });
    return calls;
  }

  it("marks shortcuts to content the admin cannot open without naming the content", async () => {
    api();
    await renderWithProviders(inRouter(<SpaceShortcutsScreen />));
    const list = await screen.findByRole("list", { name: "Shortcuts" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[2] as HTMLElement).getByText("Content you cannot open")).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText("On-call rota 2026 · ITOPS")).toBeTruthy();
  });

  it("asks only for content when a label may stay empty", async () => {
    api();
    await renderWithProviders(inRouter(<SpaceShortcutsScreen />));
    await userEvent.click(await screen.findByRole("button", { name: "Add shortcut" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add shortcut" }));
    expect(await within(dialog).findByText("Choose the content the shortcut leads to.")).toBeTruthy();
    expect(within(dialog).queryByText("Enter a label.")).toBeNull();
    expect(within(dialog).getByText(/Empty uses the title of the content/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("radio", { name: "Website" }));
    expect(within(dialog).queryByText(/Empty uses the title of the content/)).toBeNull();
  });

  it("validates a new shortcut on save and adds it", async () => {
    const { requests } = api();
    await renderWithProviders(inRouter(<SpaceShortcutsScreen />));
    await userEvent.click(await screen.findByRole("button", { name: "Add shortcut" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Website" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Address" }), "javascript:alert(1)");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add shortcut" }));
    expect(
      await within(dialog).findByText("Enter a web address, for example status.example.org."),
    ).toBeTruthy();
    expect(within(dialog).getByText("Enter a label.")).toBeTruthy();
    expect(requests.some((request) => request.method === "POST")).toBe(false);

    const address = within(dialog).getByRole("textbox", { name: "Address" });
    await userEvent.clear(address);
    await userEvent.type(address, "wiki.example.org/handbook");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Label" }), "Handbook");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add shortcut" }));
    await waitFor(() =>
      expect(requests.find((request) => request.method === "POST")?.body).toEqual({
        label: "Handbook",
        target: { url: "https://wiki.example.org/handbook" },
      }),
    );
    expect(await screen.findByText("Shortcut “Handbook” added.")).toBeTruthy();
  });

  it("reorders and removes shortcuts, with undo", async () => {
    const { requests } = api();
    await renderWithProviders(inRouter(<SpaceShortcutsScreen />));
    await userEvent.click(await screen.findByRole("button", { name: "Move “Status page” up" }));
    await waitFor(() =>
      expect(requests.find((request) => request.method === "PUT")?.body).toEqual({
        ids: [SECOND, FIRST, HIDDEN],
      }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Remove “Status page”" }));
    expect(await screen.findByText("Shortcut “Status page” removed.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() =>
      expect(requests.filter((request) => request.method === "POST").at(-1)?.body).toEqual({
        label: "Status page",
        target: { url: "https://status.example.org/" },
      }),
    );
  });
});
