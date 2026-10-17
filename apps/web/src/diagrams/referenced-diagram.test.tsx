import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageReadView } from "../editor/read-view.js";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";

const PAGE = "01929b1e-0000-7000-8000-000000000001";
const SOURCE = "01929b1e-0000-7000-8000-000000000002";
const DIAGRAM = "01929b1e-0000-7000-8000-000000000003";
const PREVIEW = "01929b1e-0000-7000-8000-000000000004";
const BLOCK = "01929b1e-0000-7000-8000-000000000005";

async function read(attrs: Record<string, unknown>) {
  await renderWithProviders(
    <PreferencesProvider>
      <PageReadView
        document={{ type: "doc", content: [{ type: "drawioReference", attrs: { id: BLOCK, ...attrs } }] }}
        references={{ people: {}, pages: {} }}
        pageId={PAGE}
      />
    </PreferencesProvider>,
  );
}

function routes(response: () => { status?: number; body?: unknown }) {
  mockApi({
    "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
    [`GET /api/v1/pages/${SOURCE}/diagrams/${DIAGRAM}`]: response,
  });
}

describe("draw.io diagrams of other pages", () => {
  it("show the current image with a link to the page that holds it", async () => {
    routes(() => ({
      body: {
        pageId: SOURCE,
        title: "Netzplan Linz",
        path: `/spaces/NET/pages/${SOURCE}/netzplan-linz`,
        found: true,
        previewId: PREVIEW,
        previewVersion: 4,
      },
    }));
    await read({ pageId: SOURCE, diagramId: DIAGRAM, name: "Netzplan" });
    const image = await screen.findByRole("img", { name: "draw.io diagram" });
    expect(image.getAttribute("src")).toContain(`/api/v1/attachments/${PREVIEW}/content`);
    expect(image.getAttribute("src")).toContain("version=4");
    expect(screen.getByRole("link", { name: "From Netzplan Linz" }).getAttribute("href")).toBe(
      `/spaces/NET/pages/${SOURCE}/netzplan-linz`,
    );
    expect(screen.getByRole("button", { name: "Edit on its page" })).toBeTruthy();
  });

  it("show restricted content without the title to readers who cannot see the page", async () => {
    routes(() => problem(404, "notFound"));
    await read({ pageId: SOURCE, diagramId: DIAGRAM, name: "Netzplan" });
    expect(await screen.findByText("Restricted content")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Netzplan");
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit on its page" })).toBeNull();
  });

  it("say when the diagram was removed from its page", async () => {
    routes(() => ({
      body: {
        pageId: SOURCE,
        title: "Netzplan Linz",
        path: `/spaces/NET/pages/${SOURCE}/netzplan-linz`,
        found: false,
        previewId: null,
        previewVersion: null,
      },
    }));
    await read({ pageId: SOURCE, diagramId: DIAGRAM, name: "Netzplan" });
    expect(await screen.findByText("The draw.io diagram was removed from its page.")).toBeTruthy();
  });

  it("name an included diagram whose page was not imported", async () => {
    routes(() => problem(500, "internal"));
    await read({ name: "Netzplan" });
    expect(
      await screen.findByText("The draw.io diagram Netzplan is on a page that was not part of the import."),
    ).toBeTruthy();
  });
});
