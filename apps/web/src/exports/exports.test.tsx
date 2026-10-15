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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, problem, type RecordedRequest, renderWithProviders } from "../testing/render.js";
import { ExportsList } from "./exports-list.js";
import { PageExportDialog } from "./page-export-dialog.js";
import { SpaceExport } from "./space-export.js";

const PAGE = "01929b1e-0000-7000-8000-0000000000e1";
const SPACE = "01929b1e-0000-7000-8000-0000000000e2";
const READY = "01929b1e-0000-7000-8000-0000000000e3";
const FAILED = "01929b1e-0000-7000-8000-0000000000e4";
const RUNNING = "01929b1e-0000-7000-8000-0000000000e5";

function exportEntry(overrides: Record<string, unknown>) {
  return {
    id: READY,
    scope: "space",
    spaceId: SPACE,
    rootItemId: null,
    name: "IT Operations",
    state: "ready",
    progress: { done: 10, total: 10 },
    fileName: "IT Operations 2026-10-14.zip",
    size: 2_097_152,
    errorCode: null,
    createdAt: "2026-10-14T09:00:00.000Z",
    finishedAt: "2026-10-14T09:01:00.000Z",
    expiresAt: "2026-10-21T09:01:00.000Z",
    ...overrides,
  };
}

function inRouter(ui: ReactNode) {
  const root = createRootRoute({ component: () => <PreferencesProvider>{ui}</PreferencesProvider> });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/settings/exports" }),
      createRoute({ getParentRoute: () => root, path: "/spaces/$spaceKey/settings/export" }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return <RouterProvider router={router} />;
}

let requests: RecordedRequest[] = [];

function api(routes: Parameters<typeof mockApi>[0] = {}) {
  ({ requests } = mockApi({
    "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
    "GET /api/v1/exports": () => ({
      body: [
        exportEntry({}),
        exportEntry({
          id: FAILED,
          state: "failed",
          errorCode: "exportDisabled",
          fileName: null,
          expiresAt: null,
        }),
        exportEntry({
          id: RUNNING,
          scope: "pages",
          name: "Runbooks",
          state: "running",
          progress: { done: 3, total: 12 },
          fileName: null,
          expiresAt: null,
        }),
      ],
    }),
    ...routes,
  }));
}

beforeEach(() => {
  api();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export");
  vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function dialog(options: { exportEnabled?: boolean; publishable?: boolean; admin?: boolean } = {}) {
  return renderWithProviders(
    inRouter(
      <PageExportDialog
        page={{ id: PAGE, title: "VPN setup", publishable: options.publishable ?? true }}
        space={{ key: "ITOPS", exportEnabled: options.exportEnabled ?? true, admin: options.admin ?? false }}
        open
        onOpenChange={() => {}}
      />,
    ),
  );
}

describe("page export", () => {
  it("downloads the page in the chosen format", async () => {
    api({ [`GET /api/v1/pages/${PAGE}/export`]: () => ({ body: "<!doctype html>" }) });
    await dialog();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /^HTML/ }));
    await user.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(requests.map((request) => request.path)).toContain(`/api/v1/pages/${PAGE}/export?format=html`);
  });

  it("starts the export with subpages in the background", async () => {
    api({
      [`POST /api/v1/pages/${PAGE}/exports`]: () => ({ status: 202, body: exportEntry({ state: "queued" }) }),
    });
    await dialog();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /ZIP with subpages/ }));
    await user.click(screen.getByRole("button", { name: "Start export" }));
    expect(await screen.findByText("Export started")).toBeTruthy();
    expect(requests.some((request) => request.method === "POST")).toBe(true);
  });

  it("says why an export cannot start and keeps the dialog open", async () => {
    api({ [`POST /api/v1/pages/${PAGE}/exports`]: () => problem(409, "exportRunning") });
    await dialog();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /ZIP with subpages/ }));
    await user.click(screen.getByRole("button", { name: "Start export" }));
    expect(await screen.findByText(/Another export of yours is still running/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start export" })).toBeTruthy();
  });

  it("asks to try again later when the storage for exports is full", async () => {
    api({ [`POST /api/v1/pages/${PAGE}/exports`]: () => problem(503, "exportStorageFull") });
    await dialog();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /ZIP with subpages/ }));
    await user.click(screen.getByRole("button", { name: "Start export" }));
    expect(await screen.findByText(/The storage for exports is full. Try again later/)).toBeTruthy();
  });

  it("says where the button would be that export is turned off, with the way to turn it on for admins", async () => {
    await dialog({ exportEnabled: false, admin: true });
    expect(await screen.findByText("Export is turned off for this space")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open export settings" }).getAttribute("href")).toBe(
      "/spaces/ITOPS/settings/export",
    );
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });

  it("asks to publish a page that was never published", async () => {
    await dialog({ publishable: false });
    expect(await screen.findByText("This page has not been published yet")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});

describe("the list of exports", () => {
  it("offers the download of ready exports, explains failures and shows progress", async () => {
    await renderWithProviders(inRouter(<ExportsList />));
    const list = await screen.findByRole("list", { name: "Your exports" });
    const download = within(list).getByRole("link", { name: "Download" });
    expect(download.getAttribute("href")).toBe(`/api/v1/exports/${READY}/content`);
    expect(within(list).getByText(/Export was turned off for the space/)).toBeTruthy();
    expect(
      within(list).getByRole("progressbar", { name: "Progress of the export of Runbooks" }),
    ).toBeTruthy();
    expect(within(list).getAllByRole("link", { name: "Download" })).toHaveLength(1);
  });

  it("explains an export that grew beyond the largest size", async () => {
    api({
      "GET /api/v1/exports": () => ({
        body: [
          exportEntry({
            id: FAILED,
            state: "failed",
            errorCode: "tooLarge",
            fileName: null,
            expiresAt: null,
          }),
        ],
      }),
    });
    await renderWithProviders(inRouter(<ExportsList />));
    const list = await screen.findByRole("list", { name: "Your exports" });
    expect(within(list).getByText(/Export a smaller part, such as a page with its subpages/)).toBeTruthy();
  });

  it("deletes an export after asking", async () => {
    api({ [`DELETE /api/v1/exports/${READY}`]: () => ({ status: 204 }) });
    await renderWithProviders(inRouter(<ExportsList />));
    const user = userEvent.setup();
    const [remove] = await screen.findAllByRole("button", { name: "Delete the export of IT Operations" });
    await user.click(remove as HTMLElement);
    const confirm = await screen.findByRole("dialog");
    expect(
      within(confirm).getByText("The download is deleted at once. You can export again later."),
    ).toBeTruthy();
    await user.click(within(confirm).getByRole("button", { name: "Delete export" }));
    await waitFor(() =>
      expect(requests.some((request) => request.method === "DELETE" && request.path.endsWith(READY))).toBe(
        true,
      ),
    );
  });
});

describe("space export", () => {
  it("starts the export of the space and lists only its exports", async () => {
    api({
      [`POST /api/v1/spaces/${SPACE}/exports`]: () => ({
        status: 202,
        body: exportEntry({ state: "queued" }),
      }),
    });
    await renderWithProviders(
      inRouter(
        <SpaceExport
          space={{ id: SPACE, key: "ITOPS", name: "IT Operations", exportEnabled: true, admin: false }}
        />,
      ),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Export space" }));
    expect(await screen.findByText("Export started")).toBeTruthy();
    expect(requests.some((request) => request.path === `/api/v1/spaces/${SPACE}/exports`)).toBe(true);
  });

  it("tells readers that export is off without offering the action", async () => {
    await renderWithProviders(
      inRouter(
        <SpaceExport
          space={{ id: SPACE, key: "ITOPS", name: "IT Operations", exportEnabled: false, admin: false }}
        />,
      ),
    );
    expect(await screen.findByText(/A space admin can turn it on/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Export space" })).toBeNull();
  });
});
