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
import { ExportDialog } from "./export-dialog.js";
import { ExportsList } from "./exports-list.js";
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
    format: "archive",
    options: { attachments: true, comments: false, contents: true, paper: "a4", orientation: "portrait" },
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
      createRoute({ getParentRoute: () => root, path: "/print" }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  router.subscribe("onResolved", ({ toLocation }) => {
    location = toLocation.href;
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
  location = "/";
  api();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export");
  vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

let location = "/";

function dialog(
  options: { exportEnabled?: boolean; publishable?: boolean; admin?: boolean; mayExportPages?: boolean } = {},
) {
  return renderWithProviders(
    inRouter(
      <ExportDialog
        page={{ id: PAGE, title: "VPN setup", publishable: options.publishable ?? true }}
        space={{
          id: SPACE,
          key: "ITOPS",
          name: "IT Operations",
          exportEnabled: options.exportEnabled ?? true,
          admin: options.admin ?? false,
          mayExportPages: options.mayExportPages ?? true,
        }}
        open
        onOpenChange={() => {}}
      />,
    ),
  );
}

function counts(total: { pages: number; blogPosts?: number; serverPdf?: boolean }) {
  return () => ({
    body: {
      pages: total.pages,
      blogPosts: total.blogPosts ?? 0,
      printLimit: 300,
      serverPdf: total.serverPdf ?? false,
    },
  });
}

function bodyOf(request: RecordedRequest | undefined): unknown {
  return request?.body;
}

describe("export dialog", () => {
  it("downloads a page as Word with the chosen paper and orientation", async () => {
    api({ [`GET /api/v1/pages/${PAGE}/export`]: () => ({ body: "PK" }) });
    await dialog();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /^Word/ }));
    await user.click(screen.getByRole("radio", { name: "Letter" }));
    await user.click(screen.getByRole("radio", { name: "Landscape" }));
    await user.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(requests.map((request) => request.path)).toContain(
      `/api/v1/pages/${PAGE}/export?format=docx&attachments=true&comments=false&contents=true&paper=letter&orientation=landscape`,
    );
  });

  it("downloads HTML as one file without attachments and as a ZIP with them", async () => {
    api({ [`GET /api/v1/pages/${PAGE}/export`]: () => ({ body: "<!doctype html>" }) });
    await dialog();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /^HTML/ }));
    expect(screen.queryByRole("switch", { name: "Include comments" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() =>
      expect(requests.map((request) => request.path)).toContain(`/api/v1/pages/${PAGE}/export?format=zip`),
    );
    await user.click(screen.getByRole("switch", { name: "Include attachments" }));
    await user.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() =>
      expect(requests.map((request) => request.path)).toContain(`/api/v1/pages/${PAGE}/export?format=html`),
    );
  });

  it("opens the print view for PDF of a single page with the browser hint", async () => {
    await dialog();
    expect(
      await screen.findByText("Your browser opens the print dialog — choose “Save as PDF”."),
    ).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("switch", { name: "Include comments" }));
    await user.click(screen.getByRole("button", { name: "Open print view" }));
    await waitFor(() => expect(location).toContain("/print?"));
    expect(location).toContain(`page=${PAGE}`);
    expect(location).toContain("comments=true");
  });

  it("prepares the print view of a page with its subpages on the server", async () => {
    api({
      [`GET /api/v1/pages/${PAGE}/exports/summary`]: counts({ pages: 5 }),
      [`POST /api/v1/pages/${PAGE}/exports`]: () => ({
        status: 202,
        body: exportEntry({ id: RUNNING, state: "queued", format: "print" }),
      }),
    });
    await dialog();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /This page and its subpages/ }));
    expect(await screen.findByText("5 pages you can read")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Prepare print view" }));
    await waitFor(() => expect(location).toContain(`export=${RUNNING}`));
    const started = requests.find((request) => request.method === "POST");
    expect(bodyOf(started)).toMatchObject({ format: "print", attachments: true, paper: "a4" });
  });

  it("offers Word, HTML or PDF on the server above the print limit", async () => {
    api({
      [`GET /api/v1/spaces/${SPACE}/exports/summary`]: counts({ pages: 412, blogPosts: 31, serverPdf: true }),
      [`POST /api/v1/spaces/${SPACE}/exports`]: () => ({
        status: 202,
        body: exportEntry({ state: "queued", format: "pdf" }),
      }),
    });
    await dialog();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /The whole space/ }));
    expect(await screen.findByText("412 pages and 31 blog posts")).toBeTruthy();
    expect(await screen.findByText("Too many pages for the print view")).toBeTruthy();
    expect(
      screen.getByText(/443 pages are more than browsers print reliably at once \(up to 300\)/),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create PDF on the server" }));
    expect(screen.getByText("The PDF is created on the server.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Start export" }));
    expect(await screen.findByText("Export started")).toBeTruthy();
    expect(bodyOf(requests.find((request) => request.method === "POST"))).toMatchObject({ format: "pdf" });
  });

  it("switches to Word above the print limit when PDF on the server is not set up", async () => {
    api({ [`GET /api/v1/spaces/${SPACE}/exports/summary`]: counts({ pages: 301 }) });
    await dialog();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /The whole space/ }));
    expect(await screen.findByText(/Export as Word or HTML instead/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create PDF on the server" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Export as Word" }));
    expect(
      (screen.getByRole("radio", { name: /^Word/ }) as HTMLButtonElement).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.queryByText("Too many pages for the print view")).toBeNull();
  });

  it("shows readers the scopes of several pages as unavailable and says why", async () => {
    await dialog({ mayExportPages: false });
    const subpages = await screen.findByRole("radio", { name: /This page and its subpages/ });
    const space = screen.getByRole("radio", { name: /The whole space/ });
    expect(subpages.hasAttribute("disabled")).toBe(true);
    expect(space.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getAllByText(
        "Only space admins can export several pages at once. Ask a space admin of IT Operations.",
      ),
    ).toHaveLength(2);
    expect(requests.some((request) => request.path.includes("/exports/summary"))).toBe(false);
  });

  it("says that an administrator has to free up space when the storage is almost full", async () => {
    api({
      [`GET /api/v1/pages/${PAGE}/exports/summary`]: counts({ pages: 2 }),
      [`POST /api/v1/pages/${PAGE}/exports`]: () => problem(507, "notEnoughStorage"),
    });
    await dialog();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /^Word/ }));
    await user.click(screen.getByRole("radio", { name: /This page and its subpages/ }));
    await user.click(screen.getByRole("button", { name: "Start export" }));
    expect(await screen.findByText(/Your instance administrator needs to free up space/)).toBeTruthy();
  });

  it("says why an export cannot start and keeps the dialog open", async () => {
    api({
      [`GET /api/v1/pages/${PAGE}/exports/summary`]: counts({ pages: 2 }),
      [`POST /api/v1/pages/${PAGE}/exports`]: () => problem(409, "exportRunning"),
    });
    await dialog();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /^Markdown/ }));
    await user.click(screen.getByRole("radio", { name: /This page and its subpages/ }));
    await user.click(screen.getByRole("button", { name: "Start export" }));
    expect(await screen.findByText(/Another export of yours is still running/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start export" })).toBeTruthy();
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
  it("starts a Word export of the space and lists only its exports", async () => {
    api({
      [`GET /api/v1/spaces/${SPACE}/exports/summary`]: counts({ pages: 12 }),
      [`POST /api/v1/spaces/${SPACE}/exports`]: () => ({
        status: 202,
        body: exportEntry({ state: "queued", format: "docx" }),
      }),
    });
    await renderWithProviders(
      inRouter(
        <SpaceExport
          space={{ id: SPACE, key: "ITOPS", name: "IT Operations", exportEnabled: true, admin: true }}
        />,
      ),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /^Word/ }));
    await user.click(screen.getByRole("button", { name: "Start export" }));
    expect(await screen.findByText("Export started")).toBeTruthy();
    const started = requests.find((request) => request.path === `/api/v1/spaces/${SPACE}/exports`);
    expect(bodyOf(started)).toMatchObject({ format: "docx" });
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
    expect(screen.queryByRole("button", { name: "Start export" })).toBeNull();
  });
});
