import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { StaticSiteExport } from "./static-site-export.js";

const SPACE_ID = "01929b1e-0000-7000-8000-0000000000b1";

function routed(ui: ReactNode) {
  const root = createRootRoute({ component: () => ui });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return <RouterProvider router={router} />;
}

const space = { id: SPACE_ID, key: "HELP", audience: "public", exportEnabled: true };

describe("static website download", () => {
  it("starts the website with the address and checks the address on click", async () => {
    const api = mockApi({
      "GET /api/v1/exports": () => ({ body: [] }),
      [`POST /api/v1/spaces/${SPACE_ID}/exports`]: () => ({
        status: 202,
        body: { id: "01929b1e-0000-7000-8000-0000000000e1", state: "queued", format: "site" },
      }),
    });
    await renderWithProviders(routed(<StaticSiteExport space={space} />));
    const field = await screen.findByLabelText("Address of the website");
    await userEvent.type(field, "help.example.org");
    await userEvent.click(screen.getByRole("button", { name: "Download as static website" }));
    expect(await screen.findByText(/Enter a full address that starts with https:\/\//)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(api.requests.some((request) => request.method === "POST")).toBe(false);

    await userEvent.clear(field);
    await userEvent.type(field, "https://help.example.org/");
    await userEvent.click(screen.getByRole("button", { name: "Download as static website" }));
    expect(await screen.findByText(/The website is being built/)).toBeTruthy();
    const posted = api.requests.find((request) => request.method === "POST");
    expect(posted?.body).toEqual({
      format: "site",
      attachments: true,
      comments: false,
      contents: true,
      paper: "a4",
      orientation: "portrait",
      siteUrl: "https://help.example.org/",
    });
  });

  it("explains that only public knowledge bases become a website", async () => {
    mockApi({ "GET /api/v1/exports": () => ({ body: [] }) });
    await renderWithProviders(routed(<StaticSiteExport space={{ ...space, audience: "signedIn" }} />));
    expect(await screen.findByText("Only for public knowledge bases")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the visibility settings" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download as static website" })).toBeNull();
  });

  it("names what failed when the server refuses the website", async () => {
    mockApi({
      "GET /api/v1/exports": () => ({ body: [] }),
      [`POST /api/v1/spaces/${SPACE_ID}/exports`]: () => problem(409, "staticSiteNotPublic"),
    });
    await renderWithProviders(routed(<StaticSiteExport space={space} />));
    await userEvent.click(await screen.findByRole("button", { name: "Download as static website" }));
    expect(await screen.findByText("The website could not be started")).toBeTruthy();
    expect(
      screen.getByText(/Only public knowledge bases can be downloaded as a static website/),
    ).toBeTruthy();
  });
});
