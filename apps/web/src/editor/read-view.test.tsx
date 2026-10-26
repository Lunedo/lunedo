import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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
    [PAGE]: { number: 1001, title: "Device naming", spaceKey: "ITOPS", kind: "page", accessible: true },
    [SECRET]: { number: null, title: "", spaceKey: "", kind: "page", accessible: false },
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
    const container = screen.getByText("Left").closest(".ld-read-view") as HTMLElement;
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
    const headings = container.querySelectorAll("h2");
    expect(headings[0]?.id).toBe("set-up-a-new-device");
    expect(headings[1]?.id).toBe("set-up-a-new-device-2");
    expect(container.querySelector('nav.ld-toc a[href="#set-up-a-new-device-2"]')).not.toBeNull();
    const link = screen.getByText("Device naming");
    expect(link.getAttribute("href")).toBe("/spaces/ITOPS/pages/1001/device-naming");
    expect(container.textContent).not.toContain("Salary bands");
    expect(container.querySelector('[data-access="none"]')?.textContent).toBe("No access");
    const missing = screen.getByText("Glossary");
    expect(missing.getAttribute("data-missing")).toBe("true");
    expect(missing.getAttribute("href")).toBe(`${FOLLOW_PATH}?space=${SPACE}&title=Glossary`);
    expect(container.textContent).toContain("@Anna Berger");
    expect(container.querySelector("[onmouseover]")).toBeNull();
    const column = screen.getByText("Left").closest(".ld-column") as HTMLElement;
    expect(column.style.getPropertyValue("--column-width")).toBe("30%");
  });

  it("renders a link stored with an old item address as the current address of the target", async () => {
    await renderWithProviders(
      <PreferencesProvider>
        <PageReadView
          document={{
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "naming rules",
                    marks: [{ type: "link", attrs: { href: `/spaces/OLD/pages/${PAGE}/old-title#rules` } }],
                  },
                  text(" and "),
                  {
                    type: "text",
                    text: "absolute",
                    marks: [
                      {
                        type: "link",
                        attrs: { href: `${globalThis.location.origin}/spaces/OLD/pages/${PAGE}/x#top` },
                      },
                    ],
                  },
                  text(" and "),
                  {
                    type: "text",
                    text: "pay scale",
                    marks: [{ type: "link", attrs: { href: `/spaces/HR/pages/${SECRET}/salary-bands` } }],
                  },
                ],
              },
            ],
          }}
          references={references}
          pageId={PAGE}
        />
      </PreferencesProvider>,
    );
    const link = screen.getByRole("link", { name: "naming rules" });
    expect(link.getAttribute("href")).toBe("/spaces/ITOPS/pages/1001/device-naming#rules");
    expect(screen.getByRole("link", { name: "absolute" }).getAttribute("href")).toBe(
      "/spaces/ITOPS/pages/1001/device-naming#top",
    );
    const paragraph = link.closest("p") as HTMLElement;
    expect(paragraph.textContent).toBe("naming rules and absolute and pay scale");
    expect(paragraph.querySelectorAll("a")).toHaveLength(2);
  });

  it("shows the display version of an image and opens the original in a new tab", async () => {
    await renderWithProviders(
      <PreferencesProvider>
        <PageReadView
          document={{
            type: "doc",
            content: [{ type: "image", attrs: { attachmentId: SECRET, alt: "Rack" } }],
          }}
          references={references}
          pageId={PAGE}
        />
      </PreferencesProvider>,
    );
    const image = screen.getByRole("img", { name: "Rack" });
    expect(image.getAttribute("src")).toBe(`/api/v1/attachments/${SECRET}/content?size=display`);
    const full = screen.getByRole("link", { name: "Rack" });
    expect(full.getAttribute("href")).toBe(`/api/v1/attachments/${SECRET}/content`);
    expect(full.getAttribute("target")).toBe("_blank");
    expect(full.getAttribute("title")).toBe("Open full size");
    const opened = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    full.dispatchEvent(opened);
    expect(opened.defaultPrevented).toBe(false);
    expect(window.location.pathname).not.toContain("/api/v1/attachments");
  });

  it("shows an image above the pixel limit as a file that opens in full size", async () => {
    await renderWithProviders(
      <PreferencesProvider>
        <PageReadView
          document={{
            type: "doc",
            content: [{ type: "image", attrs: { attachmentId: SECRET, alt: "Floor scan" } }],
          }}
          references={{ ...references, tooLargeImages: [SECRET] }}
          pageId={PAGE}
        />
      </PreferencesProvider>,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Floor scan")).toBeTruthy();
    expect(screen.getByText("This image is too large to show here.")).toBeTruthy();
    const open = screen.getByRole("link", { name: "Open full size" });
    expect(open.getAttribute("href")).toBe(`/api/v1/attachments/${SECRET}/content`);
    expect(open.getAttribute("target")).toBe("_blank");
  });

  it("keeps the checkbox and its focus when a task changes its status", async () => {
    const task = "01929b1e-0000-7000-8000-000000000005";
    const checklist = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { id: task, assignee: PERSON },
              content: [{ type: "paragraph", content: [text("Renew the certificate")] }],
            },
          ],
        },
      ],
    };
    function Checklist() {
      const [statuses, setStatuses] = useState<ReadonlyMap<string, boolean>>(new Map());
      return (
        <PageReadView
          document={checklist}
          references={references}
          pageId={PAGE}
          collaboration={{
            taskStatuses: statuses,
            canToggleTask: () => true,
            onToggleTask: (id, done) => setStatuses(new Map([[id, done]])),
          }}
        />
      );
    }
    await renderWithProviders(
      <PreferencesProvider>
        <Checklist />
      </PreferencesProvider>,
    );
    const box = screen.getByRole("checkbox", { name: /^Mark as done: Renew the certificate/ });
    await userEvent.click(box);
    expect(screen.getByRole("checkbox", { name: /^Mark as open: Renew the certificate/ })).toBe(box);
    expect((box as HTMLInputElement).checked).toBe(true);
    expect(globalThis.document.activeElement).toBe(box);
    expect(box.closest(".ld-task-item")?.getAttribute("data-checked")).toBe("true");
    await userEvent.keyboard(" ");
    expect(screen.getByRole("checkbox", { name: /^Mark as done: Renew the certificate/ })).toBe(box);
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(box.closest(".ld-task-item")?.getAttribute("data-checked")).toBe("false");
  });

  it("shows the status of a task a person cannot change", async () => {
    const task = "01929b1e-0000-7000-8000-000000000006";
    await renderWithProviders(
      <PreferencesProvider>
        <PageReadView
          document={{
            type: "doc",
            content: [
              {
                type: "taskList",
                content: [
                  {
                    type: "taskItem",
                    attrs: { id: task },
                    content: [{ type: "paragraph", content: [text("Order the badges")] }],
                  },
                ],
              },
            ],
          }}
          references={references}
          pageId={PAGE}
          collaboration={{ taskStatuses: new Map([[task, true]]), canToggleTask: () => false }}
        />
      </PreferencesProvider>,
    );
    const box = screen.getByRole("checkbox", { name: "Done" });
    expect((box as HTMLInputElement).checked).toBe(true);
    expect((box as HTMLInputElement).disabled).toBe(true);
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
