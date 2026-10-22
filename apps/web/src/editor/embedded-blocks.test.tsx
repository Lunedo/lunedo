import { defaultEmbedServices } from "@lunedo/editor-schema";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { PageReadView } from "./read-view.js";

const ORGANIZATION = "01929b1e-0000-7000-8000-0000000000aa";
const PAGE = "01929b1e-0000-7000-8000-000000000001";
const FILE = "01929b1e-0000-7000-8000-000000000002";
const SECRET_FILE = "01929b1e-0000-7000-8000-000000000003";
const BOARD = "01929b1e-0000-7000-8000-000000000004";
const SECRET_BOARD = "01929b1e-0000-7000-8000-000000000005";

vi.mock("../shell/shell-context.js", () => ({ useCurrentOrganizationId: () => ORGANIZATION }));

const observers: { callback: IntersectionObserverCallback; element: Element | null }[] = [];

class FakeObserver {
  readonly entry: { callback: IntersectionObserverCallback; element: Element | null };
  constructor(callback: IntersectionObserverCallback) {
    this.entry = { callback, element: null };
    observers.push(this.entry);
  }
  observe(element: Element) {
    this.entry.element = element;
  }
  disconnect() {
    this.entry.element = null;
  }
}

function scrollIntoView() {
  act(() => {
    for (const observer of [...observers]) {
      if (observer.element) {
        observer.callback(
          [{ isIntersecting: true, target: observer.element } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      }
    }
  });
}

function phone(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

let api: ReturnType<typeof mockApi>;

function routes(services = defaultEmbedServices) {
  api = mockApi({
    "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
    [`GET /api/v1/organizations/${ORGANIZATION}/embed-services`]: () => ({
      body: { services, available: defaultEmbedServices, narrowed: services !== defaultEmbedServices },
    }),
    [`GET /api/v1/attachments/${FILE}`]: () => ({
      body: {
        id: FILE,
        itemId: PAGE,
        name: "rack.png",
        size: 10,
        contentType: "image/png",
        preview: "image",
        inline: true,
        version: 1,
        versions: 1,
        uploadedBy: null,
        uploadedAt: "2026-10-17T08:00:00.000Z",
        createdAt: "2026-10-17T08:00:00.000Z",
      },
    }),
    [`GET /api/v1/attachments/${SECRET_FILE}`]: () => problem(404, "notFound"),
    [`GET /api/v1/whiteboards/${BOARD}/reference`]: () => ({
      body: {
        itemId: BOARD,
        title: "Network 2027",
        href: `/spaces/IT/whiteboards/${BOARD}/network-2027`,
        preview: true,
      },
    }),
    [`GET /api/v1/whiteboards/${SECRET_BOARD}/reference`]: () => problem(404, "notFound"),
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

function visible(element: Element | null | undefined): boolean {
  return Boolean(element) && !element?.closest("[hidden]");
}

const requested = (path: string) => api.requests.some((request) => request.path.startsWith(path));

beforeEach(() => {
  const happy = (globalThis as { happyDOM?: { settings: { disableIframePageLoading: boolean } } }).happyDOM;
  if (happy) happy.settings.disableIframePageLoading = true;
  vi.unstubAllGlobals();
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  phone(false);
  routes();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("embeds in the read view", () => {
  const youtube = { type: "embed", attrs: { url: "https://youtu.be/dQw4w9WgXcQ", title: "Login video" } };

  it("loads an allowed embed in a sandboxed frame only once it scrolls into view", async () => {
    await read([youtube]);
    await screen.findByText("Embedded from YouTube");
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByText(/loads from the service when you scroll/)).toBeTruthy();
    scrollIntoView();
    const frame = await screen.findByTitle("Login video");
    expect(frame.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(frame.getAttribute("sandbox")).toBe(
      "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation",
    );
    expect(frame.getAttribute("allow")).toContain("fullscreen");
    expect(screen.getByRole("link", { name: "Login video" }).getAttribute("href")).toBe(
      "https://youtu.be/dQw4w9WgXcQ",
    );
  });

  it("sends only the instance address to YouTube and no referrer to other services", async () => {
    await read([
      youtube,
      { type: "embed", attrs: { url: "https://vimeo.com/76979871", title: "Vimeo video" } },
      {
        type: "embed",
        attrs: { url: "https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184", title: "Loom video" },
      },
    ]);
    await screen.findByText("Embedded from Vimeo");
    scrollIntoView();
    expect((await screen.findByTitle("Login video")).getAttribute("referrerpolicy")).toBe("strict-origin");
    expect(screen.getByTitle("Vimeo video").getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(screen.getByTitle("Loom video").getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("sends no referrer when an instance rule leaves the policy out", async () => {
    routes([
      {
        id: "videos",
        name: "Videos",
        rules: [{ pattern: "https://videos.example.org/w/{id}", embed: "https://videos.example.org/e/{id}" }],
      },
    ]);
    await read([{ type: "embed", attrs: { url: "https://videos.example.org/w/8", title: "Own video" } }]);
    await screen.findByText("Embedded from Videos");
    scrollIntoView();
    expect((await screen.findByTitle("Own video")).getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("shows an address that is not on the allowlist as a link with a hint", async () => {
    await read([{ type: "embed", attrs: { url: "https://videos.example.net/w/8812" } }]);
    expect(await screen.findByText(/Not on the embed allowlist/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "https://videos.example.net/w/8812" })).toBeTruthy();
    scrollIntoView();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("shows embeds of services the organization removed from its list as links", async () => {
    routes(defaultEmbedServices.filter((service) => service.id !== "youtube"));
    await read([youtube]);
    expect(await screen.findByText(/Not on the embed allowlist/)).toBeTruthy();
    scrollIntoView();
    expect(document.querySelector("iframe")).toBeNull();
  });
});

describe("tabs in the read view", () => {
  const tabs = {
    type: "tabs",
    content: ["Windows", "macOS", "Linux"].map((title) => ({
      type: "tab",
      attrs: { title },
      content: [{ type: "paragraph", content: [{ type: "text", text: `${title} steps` }] }],
    })),
  };

  it("shows the first tab and switches with the mouse and the keyboard", async () => {
    const user = userEvent.setup();
    await read([tabs]);
    const list = await screen.findByRole("tablist");
    const [windows, macos, linux] = within(list).getAllByRole("tab");
    expect(windows?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Windows" }).textContent).toContain("Windows steps");
    expect(visible(screen.getByText("macOS steps").closest("[role=tabpanel]"))).toBe(false);
    await user.click(macos as HTMLElement);
    expect(macos?.getAttribute("aria-selected")).toBe("true");
    expect(visible(screen.getByRole("tabpanel", { name: "macOS" }))).toBe(true);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(linux);
    expect(screen.getByRole("tabpanel", { name: "Linux" }).textContent).toContain("Linux steps");
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(windows);
    await user.keyboard("{End}");
    expect(linux?.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Home}");
    expect(windows?.getAttribute("aria-selected")).toBe("true");
    expect(windows?.getAttribute("tabindex")).toBe("0");
    expect(linux?.getAttribute("tabindex")).toBe("-1");
  });

  it("becomes an accordion on phones", async () => {
    phone(true);
    const user = userEvent.setup();
    await read([tabs]);
    const container = document.querySelector(".ld-tabs") as HTMLElement;
    await waitFor(() => expect(container.dataset.mode).toBe("accordion"));
    const macos = screen.getByRole("button", { name: "macOS" });
    expect(macos?.getAttribute("aria-expanded")).toBe("false");
    await user.click(macos);
    expect(macos?.getAttribute("aria-expanded")).toBe("true");
    expect(visible(screen.getByText("macOS steps"))).toBe(true);
    expect(visible(screen.getByText("Windows steps"))).toBe(true);
    await user.click(screen.getByRole("button", { name: "Windows" }));
    expect(visible(screen.getByText("Windows steps").closest("[role=tabpanel]"))).toBe(false);
  });
});

describe("file previews in the read view", () => {
  it("loads the preview lazily", async () => {
    await read([
      { type: "file", attrs: { attachmentId: FILE, name: "rack.png", preview: true, height: 300 } },
    ]);
    await screen.findByRole("link", { name: "rack.png" });
    expect(requested(`/api/v1/attachments/${FILE}`)).toBe(false);
    scrollIntoView();
    const image = await screen.findByRole("img", { name: "rack.png" });
    expect(image.getAttribute("src")).toContain(`/api/v1/attachments/${FILE}/content`);
    expect(
      (document.querySelector(".ld-file-preview-box") as HTMLElement).style.getPropertyValue(
        "--preview-height",
      ),
    ).toBe("300px");
  });

  it("shows nothing to readers who cannot open the file", async () => {
    await read([
      { type: "file", attrs: { attachmentId: SECRET_FILE, name: "salaries.xlsx", preview: true } },
      { type: "paragraph", content: [{ type: "text", text: "After" }] },
    ]);
    await screen.findByText("After");
    scrollIntoView();
    await waitFor(() => expect(visible(screen.queryByText("salaries.xlsx"))).toBe(false));
  });
});

describe("whiteboard blocks in the read view", () => {
  it("show the preview and title and open the whiteboard", async () => {
    await read([{ type: "whiteboard", attrs: { whiteboardId: BOARD } }]);
    const link = await screen.findByRole("link", { name: /Network 2027/ });
    expect(link?.getAttribute("href")).toBe(`/spaces/IT/whiteboards/${BOARD}/network-2027`);
    expect(link.querySelector("img")?.getAttribute("src")).toContain(`/api/v1/whiteboards/${BOARD}/preview`);
  });

  it("show nothing to readers who cannot see the whiteboard", async () => {
    await read([
      { type: "whiteboard", attrs: { whiteboardId: SECRET_BOARD } },
      { type: "paragraph", content: [{ type: "text", text: "After" }] },
    ]);
    await screen.findByText("After");
    await waitFor(() => expect(requested(`/api/v1/whiteboards/${SECRET_BOARD}/reference`)).toBe(true));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/Restricted/)).toBeNull();
  });
});
