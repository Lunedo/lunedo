import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { FOLLOW_PATH, PageReadView } from "./read-view.js";

const PAGE = "01929b1e-0000-7000-8000-000000000001";
const SECRET = "01929b1e-0000-7000-8000-000000000002";
const SPACE = "01929b1e-0000-7000-8000-000000000003";
const PERSON = "01929b1e-0000-7000-8000-000000000004";

const text = (value: string) => ({ type: "text", text: value });

const document = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [text("Set up a new device")] },
    { type: "heading", attrs: { level: 2 }, content: [text("Set up a new device")] },
    { type: "tableOfContents", attrs: { maxLevel: 3 } },
    {
      type: "paragraph",
      content: [
        text("<script>alert(1)</script> "),
        { type: "pageLink", attrs: { pageId: PAGE, spaceId: null, title: null } },
        text(" "),
        { type: "pageLink", attrs: { pageId: SECRET, spaceId: null, title: "Salary bands" } },
        text(" "),
        { type: "pageLink", attrs: { pageId: null, spaceId: SPACE, title: "Glossary" } },
        text(" "),
        { type: "mention", attrs: { id: PERSON } },
        text(" "),
        {
          type: "text",
          text: "evil",
          marks: [{ type: "link", attrs: { href: 'https://example.org/a"onmouseover="x' } }],
        },
      ],
    },
    {
      type: "columns",
      content: [
        { type: "column", attrs: { width: 30 }, content: [{ type: "paragraph", content: [text("Left")] }] },
        { type: "column", attrs: { width: 70 }, content: [{ type: "paragraph", content: [text("Right")] }] },
      ],
    },
  ],
};

const references = {
  people: { [PERSON]: "Anna Berger" },
  pages: {
    [PAGE]: { title: "Device naming", spaceKey: "ITOPS", kind: "page", accessible: true },
    [SECRET]: { title: "", spaceKey: "", kind: "page", accessible: false },
  },
};

beforeEach(() => {
  mockApi({ "GET /api/v1/auth/session": () => problem(401, "notSignedIn") });
});

describe("page read view", () => {
  it("renders the stored snapshot with escaped text, heading ids and resolved links", async () => {
    await renderWithProviders(
      <PreferencesProvider>
        <PageReadView document={document} references={references} pageId={PAGE} />
      </PreferencesProvider>,
    );
    const container = screen.getByText("Left").closest(".ph-read-view") as HTMLElement;
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
    const headings = container.querySelectorAll("h2");
    expect(headings[0]?.id).toBe("set-up-a-new-device");
    expect(headings[1]?.id).toBe("set-up-a-new-device-2");
    expect(container.querySelector('nav.ph-toc a[href="#set-up-a-new-device-2"]')).not.toBeNull();
    const link = screen.getByText("Device naming");
    expect(link.getAttribute("href")).toBe(`/spaces/ITOPS/pages/${PAGE}/device-naming`);
    expect(container.textContent).not.toContain("Salary bands");
    expect(container.querySelector('[data-access="none"]')?.textContent).toBe("No access");
    const missing = screen.getByText("Glossary");
    expect(missing.getAttribute("data-missing")).toBe("true");
    expect(missing.getAttribute("href")).toBe(`${FOLLOW_PATH}?space=${SPACE}&title=Glossary`);
    expect(container.textContent).toContain("@Anna Berger");
    expect(container.querySelector("[onmouseover]")).toBeNull();
    const column = screen.getByText("Left").closest(".ph-column") as HTMLElement;
    expect(column.style.getPropertyValue("--column-width")).toBe("30%");
  });

  it("explains a stored document it cannot show", async () => {
    await renderWithProviders(
      <PreferencesProvider>
        <PageReadView
          document={{ type: "doc", content: [{ type: "iframe" }] }}
          references={{ people: {}, pages: {} }}
          pageId={PAGE}
        />
      </PreferencesProvider>,
    );
    expect(screen.getByRole("alert").textContent).toContain("cannot be shown");
  });
});
