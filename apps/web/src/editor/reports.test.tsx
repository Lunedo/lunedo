import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportFilters, reportQuery } from "../collaboration/task-report.js";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { SpaceContext, type SpaceContextValue } from "../spaces/space-context.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { PageReadView } from "./read-view.js";
import { decisionReportFromAttrs, pageReportFromAttrs } from "./reports.js";
import { TemplateButtonSettingsForm } from "./template-button.js";

const PAGE = "01929b1e-0000-7000-8000-000000000001";
const SPACE = "01929b1e-0000-7000-8000-000000000002";
const ALPHA = "01929b1e-0000-7000-8000-000000000003";
const TEMPLATE = "01929b1e-0000-7000-8000-000000000004";
const CREATED = "01929b1e-0000-7000-8000-000000000005";

const template = {
  id: TEMPLATE,
  level: "space",
  organizationId: null,
  spaceId: SPACE,
  name: "Project notes",
  description: "",
  category: "meetings",
  title: "Notes",
  fields: [
    { key: "currentDate", label: "Date", type: "date", required: false },
    { key: "topic", label: "Topic", type: "text", required: true },
  ],
  document: { type: "doc", content: [{ type: "paragraph" }] },
  series: null,
  updatedAt: "2026-10-01T00:00:00.000Z",
};

function routes(extra: Record<string, Parameters<typeof mockApi>[0][string]> = {}) {
  return mockApi({
    "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
    "GET /api/v1/reports/pages": () => ({
      body: [
        {
          id: ALPHA,
          title: "Alpha",
          path: `/spaces/OPS/pages/${ALPHA}/alpha`,
          spaceId: SPACE,
          author: { id: SPACE, name: "Anna Berger" },
          createdAt: "2026-09-01T08:00:00.000Z",
          updatedAt: "2026-10-01T08:00:00.000Z",
        },
      ],
    }),
    "GET /api/v1/reports/decisions": (request) => {
      const cursor = new URL(request.path, "http://localhost").searchParams.get("cursor");
      return {
        body: cursor
          ? { items: [decision("2", "Rotate keys yearly")], nextCursor: null }
          : { items: [decision("1", "Use WireGuard")], nextCursor: "next" },
      };
    },
    [`GET /api/v1/spaces/${SPACE}/template-gallery`]: () => ({ body: [template] }),
    [`POST /api/v1/spaces/${SPACE}/items`]: () => ({
      status: 201,
      body: { id: CREATED, spaceId: SPACE, kind: "page", title: "2 Oct 2026 Launch notes" },
    }),
    ...extra,
  });
}

function decision(id: string, text: string) {
  return {
    id: `01929b1e-0000-7000-8000-00000000010${id}`,
    text,
    page: { id: ALPHA, title: "Alpha", path: `/spaces/OPS/pages/${ALPHA}/alpha` },
    date: "2026-09-01T08:00:00.000Z",
  };
}

function inSpace(ui: ReactNode, canEdit: boolean) {
  const value = {
    space: { id: SPACE, key: "OPS", name: "Operations" },
    canEdit,
    openMove: () => {},
    openCopy: () => {},
    openCreate: () => {},
  } as unknown as SpaceContextValue;
  return <SpaceContext value={value}>{ui}</SpaceContext>;
}

async function read(content: unknown[], wrap: (ui: ReactNode) => ReactNode = (ui) => ui) {
  await renderWithProviders(
    <PreferencesProvider>
      {wrap(
        <PageReadView
          document={{ type: "doc", content }}
          references={{ people: {}, pages: {} }}
          pageId={PAGE}
        />,
      )}
    </PreferencesProvider>,
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
  routes();
});

describe("page report in the read view", () => {
  it("asks for the pages with the block's filters and shows title, author and last change", async () => {
    const { requests } = routes();
    await read([
      { type: "pageReport", attrs: { spaceId: SPACE, labels: ["vpn", "network"], sort: "title", limit: 5 } },
    ]);
    const link = await screen.findByRole("link", { name: "Alpha" });
    expect(link.getAttribute("href")).toBe(`/spaces/OPS/pages/${ALPHA}/alpha`);
    expect(screen.getByText("Anna Berger")).toBeTruthy();
    const query = new URL(
      requests.find((request) => request.path.startsWith("/api/v1/reports/pages"))?.path ?? "",
      "http://localhost",
    ).searchParams;
    expect(Object.fromEntries(query)).toEqual({
      spaceId: SPACE,
      labels: "vpn,network",
      sort: "title",
      reverse: "false",
      limit: "5",
    });
  });

  it("says when no page matches and explains a failed load with a retry", async () => {
    routes({ "GET /api/v1/reports/pages": () => ({ body: [] }) });
    await read([{ type: "pageReport" }]);
    expect(await screen.findByText("No pages you can see match the filters.")).toBeTruthy();
    routes({ "GET /api/v1/reports/pages": () => problem(503, "unavailable") });
    await read([{ type: "pageReport", attrs: { limit: 3 } }]);
    expect(await screen.findByText("The pages of the report could not be loaded.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });
});

describe("decision report in the read view", () => {
  it("lists decisions with their page and loads more on request", async () => {
    const { requests } = routes();
    await read([{ type: "decisionReport", attrs: { parentId: ALPHA, order: "oldest" } }]);
    expect(await screen.findByText("Use WireGuard")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Alpha" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show more decisions" }));
    expect(await screen.findByText("Rotate keys yearly")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show more decisions" })).toBeNull();
    const paths = requests.filter((request) => request.path.startsWith("/api/v1/reports/decisions"));
    expect(
      paths.map((request) => new URL(request.path, "http://localhost").searchParams.get("cursor")),
    ).toEqual([null, "next"]);
    expect(paths[0]?.path).toContain(`parentId=${ALPHA}`);
    expect(paths[0]?.path).toContain("order=oldest");
  });
});

describe("template button in the read view", () => {
  it("creates a page below the current page with the input values and the title pattern", async () => {
    const { requests } = routes();
    const assign = vi.fn();
    vi.stubGlobal("location", { ...globalThis.location, assign, origin: "http://localhost" });
    await read(
      [
        {
          type: "templateButton",
          attrs: { templateId: TEMPLATE, label: "New notes", title: "{currentDate} {topic}" },
        },
      ],
      (ui) => inSpace(ui, true),
    );
    await userEvent.click(await screen.findByRole("button", { name: "New notes" }));
    const dialog = await screen.findByRole("dialog", { name: "New page from Project notes" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Create page" }));
    expect(await within(dialog).findByText(/Topic/, { selector: "[role=alert], p" })).toBeTruthy();
    expect(requests.some((request) => request.method === "POST")).toBe(false);
    await userEvent.type(within(dialog).getByLabelText(/Topic/), "Launch");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create page" }));
    await waitFor(() => expect(requests.some((request) => request.method === "POST")).toBe(true));
    const created = requests.find((request) => request.method === "POST");
    expect(created?.body).toMatchObject({
      kind: "page",
      title: "",
      parentId: PAGE,
      template: { id: TEMPLATE, values: { topic: "Launch" }, titlePattern: "{currentDate} {topic}" },
    });
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(`/spaces/OPS/pages/${CREATED}/2-oct-2026-launch-notes?edit=true`),
    );
  });

  it("explains why it cannot be used by readers, outside the space and without its template", async () => {
    await read([{ type: "templateButton", attrs: { templateId: TEMPLATE, label: "New notes" } }], (ui) =>
      inSpace(ui, false),
    );
    expect((await screen.findByRole("button", { name: "New notes" })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Only editors of this space can create pages with this button.")).toBeTruthy();
    await read([{ type: "templateButton", attrs: { templateId: "builtin:how-to" } }], (ui) =>
      inSpace(ui, true),
    );
    expect(
      await screen.findByText(
        "The template of this button no longer exists. An editor can choose another one.",
      ),
    ).toBeTruthy();
  });
});

describe("template button settings", () => {
  it("refuse input fields the template does not have and save a valid title pattern", async () => {
    const onChange = vi.fn();
    await renderWithProviders(
      <TemplateButtonSettingsForm
        button={{ templateId: TEMPLATE, label: "", title: "" }}
        spaceId={SPACE}
        onChange={onChange}
      />,
    );
    const title = await screen.findByLabelText("Title of new pages");
    await screen.findByText(
      "Use the input fields {currentDate}, {topic}. Leave empty to use the title of the template.",
    );
    await userEvent.type(title, "{{name} notes");
    fireEvent.blur(title);
    expect(await screen.findByText(/\{name\} is not an input field of this template/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.clear(title);
    await userEvent.type(title, "{{topic} notes{Enter}");
    expect(onChange).toHaveBeenCalledWith({ title: "{topic} notes" });
  });
});

describe("report settings from attributes", () => {
  it("read page and decision reports from attributes and data attributes", () => {
    expect(
      pageReportFromAttrs({ spaceId: SPACE, labels: "a,b", sort: "created", reverse: "true", limit: "50" }),
    ).toEqual({ spaceId: SPACE, labels: ["a", "b"], sort: "created", reverse: true, limit: 50 });
    expect(pageReportFromAttrs({ sort: "random", limit: 500 })).toEqual({
      spaceId: null,
      labels: [],
      sort: "modified",
      reverse: false,
      limit: 20,
    });
    expect(decisionReportFromAttrs({ labels: ["x"], parentId: ALPHA, order: "oldest" })).toEqual({
      spaceId: null,
      labels: ["x"],
      parentId: ALPHA,
      order: "oldest",
    });
  });

  it("pass the page and label filters of a task report to the task list", () => {
    const filters = reportFilters({ pageIds: `${ALPHA},${PAGE}`, labels: "vpn", status: "done" });
    expect(reportQuery(filters)).toMatchObject({
      pageIds: `${ALPHA},${PAGE}`,
      labels: "vpn",
      status: "done",
    });
    expect(reportQuery(reportFilters({}))).not.toHaveProperty("pageIds");
  });
});
