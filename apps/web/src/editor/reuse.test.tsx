import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { IncludedContent, includeFromAttrs } from "./includes.js";
import { contentByLabelFromAttrs } from "./label-blocks.js";
import { propertiesReportFromAttrs } from "./properties.js";
import { PageReadView } from "./read-view.js";

const PAGE = "01929b1e-0000-7000-8000-000000000001";
const SPACE = "01929b1e-0000-7000-8000-000000000002";
const GRAZ = "01929b1e-0000-7000-8000-000000000003";
const LINZ = "01929b1e-0000-7000-8000-000000000004";
const PERSON = "01929b1e-0000-7000-8000-000000000005";
const SECRET = "01929b1e-0000-7000-8000-000000000006";
const NARROW = "01929b1e-0000-7000-8000-000000009999";

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

function row(id: string, number: number, title: string, owner: unknown[] | null) {
  return {
    page: { id, title, path: `/spaces/OPS/pages/${number}/${title.toLowerCase()}`, spaceId: SPACE },
    creator: null,
    labels: ["site"],
    cells: [owner],
  };
}

function routes(extra: Record<string, Parameters<typeof mockApi>[0][string]> = {}) {
  return mockApi({
    "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
    "GET /api/v1/reports/properties": (request) => {
      const offset = new URL(request.path, "http://localhost").searchParams.get("offset");
      return {
        body: {
          columns: ["Owner"],
          keys: ["Owner"],
          total: 3,
          rows:
            offset === "2"
              ? [row(LINZ, 1004, "Linz", null)]
              : [
                  row(GRAZ, 1003, "Graz", [
                    { type: "paragraph", content: [{ type: "mention", attrs: { id: PERSON } }] },
                  ]),
                  row(SECRET.replace("6", "7"), 1007, "Wien", [paragraph("Bernd")]),
                ],
          references: { people: { [PERSON]: "Anna Berger" }, pages: {}, topics: {} },
        },
      };
    },
    "GET /api/v1/reports/content-by-label": () => ({
      body: [
        {
          id: GRAZ,
          title: "Reset a password",
          kind: "page",
          path: "/spaces/OPS/pages/1003/reset",
          space: { id: SPACE, name: "Operations" },
          labels: ["how-to"],
          excerpt: "Open the portal.",
        },
      ],
    }),
    [`GET /api/v1/pages/${PAGE}/related-labels`]: () => ({
      body: [{ label: "network", href: "/spaces/OPS/labels/network" }],
    }),
    [`GET /api/v1/pages/${PAGE}/inclusion`]: (request) => {
      const query = new URL(request.path, "http://localhost").searchParams;
      if (query.get("targetId") === SECRET || query.has("sourceTitle")) return problem(404, "notFound");
      return {
        body: {
          state: query.get("excerpt") === "true" ? "noExcerpt" : "visible",
          page: { id: GRAZ, title: "Graz", path: "/spaces/OPS/pages/1003/graz", spaceId: SPACE },
          document:
            query.get("excerpt") === "true" ? null : { type: "doc", content: [paragraph("Included words")] },
          references: { people: {}, pages: {}, topics: {} },
          hiddenFromSomeReaders: query.get("targetId") === NARROW,
        },
      };
    },
    ...extra,
  });
}

async function read(content: unknown[]) {
  await renderWithProviders(
    <PreferencesProvider>
      <PageReadView
        document={{ type: "doc", content }}
        references={{ people: {}, pages: {} }}
        pageId={PAGE}
      />
    </PreferencesProvider>,
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
  routes();
});

describe("page properties in the read view", () => {
  it("show the names and values as a table and hide a hidden set", async () => {
    await read([
      {
        type: "pageProperties",
        content: [
          {
            type: "pageProperty",
            content: [
              { type: "pagePropertyKey", content: [{ type: "text", text: "Uplink" }] },
              { type: "pagePropertyValue", content: [paragraph("1 Gbit/s")] },
            ],
          },
        ],
      },
      {
        type: "pageProperties",
        attrs: { hidden: true },
        content: [
          {
            type: "pageProperty",
            content: [
              { type: "pagePropertyKey", content: [{ type: "text", text: "Secret" }] },
              { type: "pagePropertyValue", content: [paragraph("Hidden value")] },
            ],
          },
        ],
      },
    ]);
    expect(screen.getByRole("rowheader", { name: "Uplink" })).toBeTruthy();
    expect(screen.getByText("1 Gbit/s")).toBeTruthy();
    expect(screen.queryByText("Hidden value")).toBeNull();
  });
});

describe("page properties report", () => {
  it("asks with the block's filters, renders the values and pages through the results", async () => {
    const { requests } = routes();
    await read([
      {
        type: "propertiesReport",
        attrs: {
          spaceIds: [SPACE],
          labels: ["site"],
          columns: ["Owner"],
          sortBy: "Owner",
          pageSize: 2,
          firstColumn: "Site",
        },
      },
    ]);
    expect(await screen.findByRole("link", { name: "Graz" })).toBeTruthy();
    expect(screen.getByText("@Anna Berger")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Site/ })).toBeTruthy();
    const query = new URL(
      requests.find((request) => request.path.startsWith("/api/v1/reports/properties"))?.path ?? "",
      "http://localhost",
    ).searchParams;
    expect(Object.fromEntries(query)).toEqual({
      spaceIds: SPACE,
      labels: "site",
      columns: "Owner",
      sortBy: "Owner",
      reverse: "false",
      pageSize: "2",
      offset: "0",
    });
    expect(screen.getByText("Pages 1 to 2 of 3")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByRole("link", { name: "Linz" })).toBeTruthy();
  });

  it("keeps the page of the results in the address, so going back and links keep it", async () => {
    const history = createMemoryHistory({ initialEntries: ["/spaces/OPS/pages/1001/sites"] });
    const root = createRootRoute({
      component: () => (
        <PreferencesProvider>
          <PageReadView
            document={{
              type: "doc",
              content: [{ type: "propertiesReport", attrs: { columns: ["Owner"], pageSize: 2 } }],
            }}
            references={{ people: {}, pages: {} }}
            pageId={PAGE}
          />
        </PreferencesProvider>
      ),
    });
    const router = createRouter({ routeTree: root, history });
    const { requests } = routes();
    await renderWithProviders(<RouterProvider router={router} />);
    await screen.findByRole("link", { name: "Graz" });
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByRole("link", { name: "Linz" })).toBeTruthy();
    expect(decodeURIComponent(router.state.location.href)).toMatch(/reports=\{"[0-9a-z]+":2\}/);
    expect(requests.some((request) => request.path.includes("offset=2"))).toBe(true);
    history.back();
    expect(await screen.findByRole("link", { name: "Graz" })).toBeTruthy();
    history.forward();
    expect(await screen.findByRole("link", { name: "Linz" })).toBeTruthy();
  });

  it("lets readers sort by a column", async () => {
    const { requests } = routes();
    await read([{ type: "propertiesReport", attrs: { columns: ["Owner"] } }]);
    await screen.findByRole("link", { name: "Graz" });
    await userEvent.click(within(screen.getByRole("columnheader", { name: /Owner/ })).getByRole("button"));
    await waitFor(() => expect(requests.some((request) => request.path.includes("sortBy=Owner"))).toBe(true));
  });

  it("reads its settings from the block attributes and from the read view", () => {
    const fromDataset = propertiesReportFromAttrs({
      spaceIds: JSON.stringify([SPACE]),
      labels: JSON.stringify(["site"]),
      columns: JSON.stringify(["Owner, inc"]),
      reverse: "true",
      pageSize: "500",
    });
    expect(fromDataset).toEqual({
      spaceIds: [SPACE],
      labels: ["site"],
      setId: null,
      columns: ["Owner, inc"],
      sortBy: null,
      reverse: true,
      pageSize: 30,
    });
  });
});

describe("content by label and related labels", () => {
  it("list the pages with their excerpt and the related labels", async () => {
    await read([
      { type: "contentByLabel", attrs: { labels: ["how-to"], excerpts: true, title: "Guides" } },
      { type: "relatedLabels", attrs: {} },
    ]);
    expect(await screen.findByRole("link", { name: "Reset a password" })).toBeTruthy();
    expect(screen.getByText("Open the portal.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Guides" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: "network" })).toBeTruthy();
    expect(contentByLabelFromAttrs({ kinds: '["blogPost"]', limit: "7" })).toMatchObject({
      kinds: ["blogPost"],
      limit: 7,
    });
  });
});

describe("includes in the read view", () => {
  it("show the content of a readable page and nothing for a hidden one", async () => {
    await read([
      { type: "includePage", attrs: { pageId: GRAZ } },
      { type: "includePage", attrs: { pageId: SECRET } },
      { type: "includeExcerpt", attrs: { pageId: GRAZ, panel: true } },
    ]);
    expect(await screen.findByText("Included words")).toBeTruthy();
    expect(await screen.findByText("The included page has no excerpt with this name.")).toBeTruthy();
    expect(screen.queryByText(/Restricted content/)).toBeNull();
  });

  it("stop a page that includes itself", async () => {
    await read([{ type: "includePage", attrs: { pageId: PAGE } }]);
    expect(
      await screen.findByText("This content is not shown because it would include itself."),
    ).toBeTruthy();
  });

  it("tell editors that included content is restricted or not imported yet, without its title", async () => {
    await renderWithProviders(
      <PreferencesProvider>
        <IncludedContent
          include={{ pageId: SECRET, sourceSpace: null, sourceTitle: null, excerpt: false, name: null }}
          hostId={PAGE}
          panel={false}
          placeholders
        />
        <IncludedContent
          include={{ pageId: null, sourceSpace: "OPS", sourceTitle: "Runbook", excerpt: false, name: null }}
          hostId={PAGE}
          panel={false}
          placeholders
        />
      </PreferencesProvider>,
    );
    expect(await screen.findByText(/^Restricted content/)).toBeTruthy();
    expect(await screen.findByText(/The included page Runbook was not part of the import/)).toBeTruthy();
  });

  it("tell editors when some readers of the page cannot read the included page", async () => {
    const include = { sourceSpace: null, sourceTitle: null, excerpt: false, name: null };
    await renderWithProviders(
      <PreferencesProvider>
        <IncludedContent include={{ ...include, pageId: NARROW }} hostId={PAGE} panel={false} placeholders />
      </PreferencesProvider>,
    );
    expect(await screen.findByText("Included words")).toBeTruthy();
    expect(screen.getByText(/^Not everyone who can read this page can read the included page/)).toBeTruthy();
  });

  it("show no hint to readers and none when everyone can read the included page", async () => {
    const include = { sourceSpace: null, sourceTitle: null, excerpt: false, name: null };
    await renderWithProviders(
      <PreferencesProvider>
        <IncludedContent include={{ ...include, pageId: NARROW }} hostId={PAGE} panel={false} />
        <IncludedContent include={{ ...include, pageId: GRAZ }} hostId={PAGE} panel placeholders />
      </PreferencesProvider>,
    );
    await waitFor(() => expect(screen.getAllByText("Included words")).toHaveLength(2));
    expect(screen.queryByText(/^Not everyone who can read this page/)).toBeNull();
  });

  it("read the target from the block attributes", () => {
    expect(
      includeFromAttrs("includeExcerpt", { sourceSpace: "OPS", sourceTitle: "Runbook", name: "" }),
    ).toEqual({
      pageId: null,
      sourceSpace: "OPS",
      sourceTitle: "Runbook",
      excerpt: true,
      name: null,
    });
  });
});

describe("roadmap in the read view", () => {
  it("draws the timeline and offers it as a list", async () => {
    await read([
      {
        type: "roadmap",
        attrs: {
          roadmap: {
            title: "Plan",
            start: "2027-01-01",
            end: "2027-03-31",
            lanes: [
              {
                title: "Core",
                color: "blue",
                bars: [
                  {
                    title: "Order",
                    description: "",
                    start: "2027-01-10",
                    end: "2027-02-10",
                    row: 0,
                    pageId: null,
                  },
                ],
              },
            ],
            markers: [],
          },
        },
      },
    ]);
    expect(screen.getByRole("img", { name: "Plan" })).toBeTruthy();
    expect(screen.getByText("Show as list")).toBeTruthy();
    expect(screen.getByText(/Imported roadmap/)).toBeTruthy();
  });
});
