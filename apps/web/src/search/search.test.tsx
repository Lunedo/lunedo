import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../app.js";
import { initI18n } from "../i18n/index.js";
import { mockApi, type RecordedRequest } from "../testing/render.js";
import { fromSearchParams, noFilters, toSearchParams } from "./search-params.js";

const ORGANIZATION = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f";
const SPACE = "01929b1e-0000-7000-8000-000000000010";
const OTHER_SPACE = "01929b1e-0000-7000-8000-000000000011";
const AUTHOR = "01929b1e-0000-7000-8000-000000000012";

function hit(id: string, title: string, spaceId = SPACE) {
  return {
    type: "page",
    id,
    itemId: id,
    title,
    heading: "",
    anchor: null,
    excerpt: [
      { text: "Restart the ", highlighted: false },
      { text: title.split(" ")[0] ?? "", highlighted: true },
    ],
    space: {
      id: spaceId,
      key: spaceId === SPACE ? "OPS" : "SEC",
      name: spaceId === SPACE ? "Operations" : "Security",
      personal: false,
    },
    sharedWithYou: false,
    path: [],
    labels: [],
    status: null,
    author: null,
    archived: false,
    updatedAt: "2026-10-14T08:00:00.000Z",
  };
}

function response(results: ReturnType<typeof hit>[], extra: Record<string, unknown> = {}) {
  return {
    results,
    total: results.length,
    nextCursor: null,
    facets: {
      types: [{ value: "page", count: results.length }],
      spaces: [
        { id: SPACE, key: "OPS", name: "Operations", personal: false, count: 2 },
        { id: OTHER_SPACE, key: "SEC", name: "Security", personal: false, count: 1 },
      ],
      labels: [],
      authors: [{ id: AUTHOR, name: "Ada Author", count: 1 }],
      statuses: [],
      languages: [{ value: "en", count: results.length }],
      updated: [{ value: "year", count: results.length }],
    },
    index: { building: false },
    ...extra,
  };
}

const ids = (n: number) => `01929b1e-0000-7000-8000-0000000001${String(n).padStart(2, "0")}`;

function shellRoutes(search: (request: RecordedRequest) => { status?: number; body?: unknown }) {
  return {
    "GET /api/v1/instance/info": () => ({
      body: {
        name: "Example Wiki",
        setupComplete: true,
        language: "en",
        accentColor: "petrol",
        passwordMinLength: 12,
        selfRegistration: false,
        organization: { id: ORGANIZATION, name: "Platform Team", logoRef: null, accentColor: "violet" },
      },
    }),
    "GET /api/v1/auth/session": () => ({
      body: {
        sessionKind: "full",
        account: {
          id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
          email: "olivia@example.org",
          name: "Olivia Owner",
        },
        methods: ["password"],
        recentlyAuthenticated: true,
      },
    }),
    "GET /api/v1/organizations": () => ({
      body: {
        items: [
          {
            id: ORGANIZATION,
            name: "Platform Team",
            slug: "platform-team",
            logoRef: null,
            language: "en",
            timeZone: "UTC",
            accentColor: "violet",
            createdAt: "2026-10-01T08:00:00.000Z",
            membershipKind: "member",
          },
        ],
        nextCursor: null,
      },
    }),
    "GET /api/v1/account/permissions": () => ({
      body: { instance: [], organization: ["organization.view", "organization.search"] },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
    "GET /api/v1/recent": () => ({
      body: [
        {
          id: ids(90),
          kind: "page",
          title: "Network overview",
          spaceId: SPACE,
          spaceKey: "OPS",
          spaceName: "Operations",
          viewedAt: "2026-10-14T08:00:00.000Z",
        },
      ],
    }),
    [`GET /api/v1/organizations/${ORGANIZATION}/search/recent`]: () => ({
      body: [
        {
          id: ids(80),
          query: "tls certificate",
          filters: { ...noFilters },
          searchedAt: "2026-10-14T08:00:00.000Z",
        },
      ],
    }),
    [`DELETE /api/v1/organizations/${ORGANIZATION}/search/recent`]: () => ({ status: 204 }),
    [`POST /api/v1/organizations/${ORGANIZATION}/search/recent`]: () => ({ status: 204 }),
    [`GET /api/v1/organizations/${ORGANIZATION}/search/saved`]: () => ({ body: [] }),
    "GET /api/v1/people": () => ({ body: { items: [], nextCursor: null } }),
    "GET /api/v1/spaces": () => ({ body: { items: [], nextCursor: null } }),
    [`GET /api/v1/organizations/${ORGANIZATION}/search`]: search,
  };
}

async function renderApp(
  path: string,
  search: (request: RecordedRequest) => { status?: number; body?: unknown },
) {
  const api = mockApi(shellRoutes(search));
  window.history.replaceState(null, "", path);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
  await screen.findByRole("button", { name: /Notifications/ });
  return api;
}

function queryOf(request: RecordedRequest): URLSearchParams {
  return new URL(request.path, "http://localhost").searchParams;
}

describe("search parameters in the address", () => {
  it("survive the round trip and drop values that are not valid", () => {
    const filters = {
      ...noFilters,
      spaceIds: [SPACE],
      types: ["page" as const, "comment" as const],
      labels: ["runbook"],
      authorIds: [AUTHOR],
      languages: ["de"],
      updated: "month" as const,
      includeArchived: true,
      sort: "newest" as const,
    };
    expect(fromSearchParams(toSearchParams("vpn -legacy", filters))).toEqual({
      query: "vpn -legacy",
      filters,
    });
    expect(toSearchParams("", noFilters)).toEqual({});
    expect(
      fromSearchParams({ q: "x", spaces: `${SPACE},not-an-id`, types: "page,folder", languages: "de,xx" })
        .filters,
    ).toMatchObject({ spaceIds: [SPACE], types: ["page"], languages: ["de"] });
  });
});

describe("quick search", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        removeEventListener() {}
        close() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.history.replaceState(null, "", "/");
  });

  it("shows recent searches and recently viewed items before typing, and clears recent searches", async () => {
    const api = await renderApp("/settings/preferences", () => ({ body: response([]) }));
    await userEvent.keyboard("/");
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    expect(await within(dialog).findByRole("option", { name: "tls certificate" })).toBeTruthy();
    expect(within(dialog).getByRole("option", { name: /Network overview/ })).toBeTruthy();
    expect(within(dialog).getByRole("combobox").getAttribute("placeholder")).toBe(
      "Search pages, blog posts, comments, people and spaces",
    );
    await userEvent.click(within(dialog).getByRole("option", { name: "Clear recent searches" }));
    await waitFor(() =>
      expect(
        api.requests.some(
          (request) => request.method === "DELETE" && request.path.endsWith("/search/recent"),
        ),
      ).toBe(true),
    );
  });

  it("never lets an older answer replace the results of a newer query", async () => {
    const pending = new Map<string, () => void>();
    const api = await renderApp("/settings/preferences", (request) => {
      const q = queryOf(request).get("q") ?? "";
      return { body: response(q === "gate" ? [hit(ids(1), "Gate list")] : [hit(ids(2), "Gateway restart")]) };
    });
    const answer = api.fetch.getMockImplementation();
    api.fetch.mockImplementation(async (resource: Request | string, init?: RequestInit) => {
      const url = resource instanceof Request ? resource.url : String(resource);
      if (url.includes("mode=quick") && url.includes("q=gate&")) {
        await new Promise<void>((resolve) => pending.set("gate", resolve));
      }
      return answer?.(resource, init) as Promise<Response>;
    });
    await userEvent.keyboard("/");
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    const input = within(dialog).getByRole("combobox");
    await userEvent.type(input, "gate");
    await waitFor(() => expect(pending.has("gate")).toBe(true));
    await userEvent.type(input, "way");
    expect(await within(dialog).findByRole("option", { name: /Gateway restart/ })).toBeTruthy();
    pending.get("gate")?.();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(dialog).queryByRole("option", { name: /Gate list/ })).toBeNull();
    expect(within(dialog).getByRole("option", { name: /Gateway restart/ })).toBeTruthy();
  });

  it("works by keyboard: arrows move, Enter opens, Ctrl+Enter opens a new tab, Escape closes", async () => {
    const opened = vi.fn();
    vi.stubGlobal("open", opened);
    await renderApp("/settings/preferences", () => ({
      body: response([hit(ids(3), "Gateway restart"), hit(ids(4), "Gateway overview")]),
    }));
    await userEvent.keyboard("/");
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    expect(within(dialog).getByRole("listbox")).toBeTruthy();
    await userEvent.type(within(dialog).getByRole("combobox"), "gateway");
    const first = await within(dialog).findByRole("option", { name: /Gateway restart/ });
    await waitFor(() => expect(first.getAttribute("aria-selected")).toBe("true"));
    await userEvent.keyboard("{ArrowDown}");
    expect(
      within(dialog)
        .getByRole("option", { name: /Gateway overview/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(opened).toHaveBeenCalledWith(`/spaces/OPS/pages/${ids(4)}/gateway-overview`, "_blank", "noopener");
    expect(screen.getByRole("dialog", { name: "Search" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
    await userEvent.keyboard("/");
    await userEvent.type(
      within(await screen.findByRole("dialog", { name: "Search" })).getByRole("combobox"),
      "gateway",
    );
    await within(screen.getByRole("dialog", { name: "Search" })).findByRole("option", {
      name: /Gateway restart/,
    });
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(window.location.pathname).toBe(`/spaces/OPS/pages/${ids(3)}/gateway-restart`));
  });
});

describe("the search page", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        removeEventListener() {}
        close() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("reads query and filters from the address and writes changed filters back", async () => {
    const api = await renderApp(`/search?q=gateway&spaces=${SPACE}&updated=week&sort=newest`, () => ({
      body: response([hit(ids(5), "Gateway restart")]),
    }));
    expect(await screen.findByText("1 result")).toBeTruthy();
    const sent = queryOf(
      api.requests.find((request) =>
        request.path.startsWith(`/api/v1/organizations/${ORGANIZATION}/search?`),
      ) as RecordedRequest,
    );
    expect(sent.get("q")).toBe("gateway");
    expect(sent.get("spaceIds")).toBe(SPACE);
    expect(sent.get("sort")).toBe("newest");
    expect(Date.now() - Date.parse(sent.get("updatedAfter") ?? "")).toBeGreaterThan(6 * 86_400_000);
    const filters = screen.getByRole("complementary", { name: "Filters" });
    expect(
      within(filters)
        .getByRole("checkbox", { name: /Operations/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    await userEvent.click(within(filters).getByRole("checkbox", { name: /Security/ }));
    await waitFor(() =>
      expect(new URL(window.location.href).searchParams.get("spaces")).toBe(`${SPACE},${OTHER_SPACE}`),
    );
    expect(new URL(window.location.href).searchParams.get("sort")).toBe("newest");
  });

  it("explains the first use and offers ways out when nothing is found", async () => {
    await renderApp("/search", () => ({ body: response([]) }));
    expect(await screen.findByText("Search pages, blog posts and comments")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "tls certificate" })).toBeTruthy();
    window.history.replaceState(null, "", "/");
  });

  it("names the query, shows the spelling suggestion when the API sends one, and clears filters", async () => {
    await renderApp(`/search?q=gatwy&labels=runbook`, (request) =>
      queryOf(request).get("labels")
        ? { body: response([], { suggestion: "gateway" }) }
        : { body: response([hit(ids(6), "Gateway restart")]) },
    );
    expect(await screen.findByText("No results for “gatwy” with these filters")).toBeTruthy();
    expect(screen.getByRole("link", { name: "gateway" })).toBeTruthy();
    const results = screen.getByRole("region", { name: "Results" });
    expect(within(results).getByRole("button", { name: "Include archived content" })).toBeTruthy();
    await userEvent.click(within(results).getByRole("button", { name: "Clear 1 filter" }));
    expect(await screen.findByText("1 result")).toBeTruthy();
    expect(new URL(window.location.href).searchParams.get("labels")).toBeNull();
  });
});
