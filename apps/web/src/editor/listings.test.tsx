import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { childPagesFromAttrs, FileTypesField, parseFileTypes } from "./listings.js";
import { PageReadView } from "./read-view.js";

const PAGE = "01929b1e-0000-7000-8000-000000000001";
const SPACE = "01929b1e-0000-7000-8000-000000000002";
const NETWORK = "01929b1e-0000-7000-8000-000000000003";
const FIREWALL = "01929b1e-0000-7000-8000-000000000004";
const BACKUP = "01929b1e-0000-7000-8000-000000000005";
const OTHER = "01929b1e-0000-7000-8000-000000000006";
const FILE = "01929b1e-0000-7000-8000-000000000007";

function item(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    spaceId: SPACE,
    kind: "page",
    title,
    hasChildren: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    contentUpdatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

const children: Record<string, unknown[]> = {
  [PAGE]: [
    item(NETWORK, "Network", { hasChildren: true, contentUpdatedAt: "2026-03-01T00:00:00.000Z" }),
    item(BACKUP, "Backup", { contentUpdatedAt: "2026-02-01T00:00:00.000Z" }),
    item("01929b1e-0000-7000-8000-000000000009", "Folder", { kind: "folder" }),
  ],
  [NETWORK]: [item(FIREWALL, "Firewall")],
};

function routes(extra: Record<string, () => { status?: number; body?: unknown }> = {}) {
  return mockApi({
    "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
    [`GET /api/v1/items/${PAGE}`]: () => ({
      body: { ...item(PAGE, "Runbook"), spaceKey: "OPS", spaceAccess: true },
    }),
    [`GET /api/v1/spaces/${SPACE}/items`]: (request) => {
      const parentId = new URL(request.path, "http://localhost").searchParams.get("parentId") ?? "";
      return { body: { items: children[parentId] ?? [], nextCursor: null } };
    },
    [`GET /api/v1/pages/${PAGE}/attachments`]: () => ({
      body: [
        { id: FILE, name: "handbook.pdf", size: 2_621_440, version: 3 },
        { id: OTHER, name: "budget.xlsx", size: 512, version: 1 },
      ],
    }),
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
  routes();
});

describe("child pages in the read view", () => {
  it("list the child pages of the current page down to the chosen depth, without folders", async () => {
    await read([{ type: "childPages", attrs: { depth: 2 } }]);
    const firewall = await screen.findByRole("link", { name: "Firewall" });
    expect(firewall.getAttribute("href")).toBe(`/spaces/OPS/pages/${FIREWALL}/firewall`);
    const list = firewall.closest("nav.ph-child-pages") as HTMLElement;
    expect(Array.from(list.querySelectorAll("a")).map((link) => link.textContent)).toEqual([
      "Network",
      "Firewall",
      "Backup",
    ]);
    expect(list.textContent).not.toContain("Folder");
  });

  it("stop at one level and sort by title or last change in either direction", async () => {
    await read([
      { type: "childPages", attrs: { depth: 1, sort: "title" } },
      { type: "childPages", attrs: { depth: 1, sort: "modified", reverse: true } },
    ]);
    await waitFor(() => expect(document.querySelectorAll("nav.ph-child-pages a")).toHaveLength(4));
    const [byTitle, byChange] = Array.from(document.querySelectorAll("nav.ph-child-pages")).map((list) =>
      Array.from(list.querySelectorAll("a")).map((link) => link.textContent),
    );
    expect(byTitle).toEqual(["Backup", "Network"]);
    expect(byChange).toEqual(["Network", "Backup"]);
  });

  it("show nothing of a page the reader cannot see", async () => {
    await read([{ type: "childPages", attrs: { pageId: OTHER } }]);
    expect(await screen.findByText("No child pages you can see.")).toBeTruthy();
  });

  it("explain a failed load and offer a retry", async () => {
    routes({ [`GET /api/v1/spaces/${SPACE}/items`]: () => problem(503, "unavailable") });
    await read([{ type: "childPages" }]);
    expect(await screen.findByText("The child pages could not be loaded.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });
});

describe("attachment list in the read view", () => {
  it("lists the attachments of the page with size and version, filtered by file type", async () => {
    await read([{ type: "attachmentList", attrs: { fileTypes: ["pdf"] } }]);
    const link = await screen.findByRole("link", { name: "handbook.pdf" });
    expect(link.getAttribute("href")).toBe(`/api/v1/attachments/${FILE}/content`);
    expect(link.closest("li")?.textContent).toMatch(/2\.5\s?MB, version 3/);
    expect(screen.queryByText("budget.xlsx")).toBeNull();
  });

  it("says when no attachment has one of the file types", async () => {
    await read([{ type: "attachmentList", attrs: { fileTypes: ["docx"] } }]);
    expect(await screen.findByText("No attachments of these file types.")).toBeTruthy();
  });
});

describe("child page settings", () => {
  it("read the settings from attributes and data attributes", () => {
    expect(childPagesFromAttrs({ pageId: PAGE, depth: "all", sort: "title", reverse: "true" })).toEqual({
      pageId: PAGE,
      depth: null,
      sort: "title",
      reverse: true,
    });
    expect(childPagesFromAttrs({ depth: 3, sort: "random" })).toEqual({
      pageId: null,
      depth: 3,
      sort: "tree",
      reverse: false,
    });
  });
});

describe("file types of the attachment list", () => {
  it("accept extensions with or without dot and star, separated by commas or spaces", () => {
    expect(parseFileTypes("*.pdf, .DOCX docx;xlsx")).toEqual(["pdf", "docx", "xlsx"]);
    expect(parseFileTypes("")).toEqual([]);
    expect(parseFileTypes("pdf, report-2024")).toBeNull();
    expect(parseFileTypes(Array.from({ length: 21 }, (_, index) => `t${index}`).join(","))).toBeNull();
  });

  it("save valid input and explain invalid input without changing the setting", async () => {
    const onChange = vi.fn();
    await renderWithProviders(<FileTypesField fileTypes={["pdf"]} onChange={onChange} />);
    const input = screen.getByLabelText("File types");
    await userEvent.clear(input);
    await userEvent.type(input, "pdf, docx{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(["pdf", "docx"]);
    await userEvent.clear(input);
    await userEvent.type(input, "report-2024");
    fireEvent.blur(input);
    expect(await screen.findByText(/Enter up to 20 file extensions/)).toBeTruthy();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("file types field after an error", () => {
  it("clears the error as soon as the input is valid again", async () => {
    await renderWithProviders(<FileTypesField fileTypes={[]} onChange={vi.fn()} />);
    const input = screen.getByLabelText("File types");
    await userEvent.type(input, "a-b");
    fireEvent.blur(input);
    expect(await screen.findByText(/Enter up to 20 file extensions/)).toBeTruthy();
    await userEvent.type(input, "{Backspace}{Backspace}");
    expect(screen.queryByText(/Enter up to 20 file extensions/)).toBeNull();
  });
});
