import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "../../i18n/index.js";
import { PreferencesProvider } from "../../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../../testing/render.js";
import { AnnouncementSettings, validateAnnouncement } from "./announcement-settings.js";

const ORGANIZATION = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f";
const DAY = 86_400_000;

function inRouter(ui: ReactNode) {
  const root = createRootRoute({ component: () => <PreferencesProvider>{ui}</PreferencesProvider> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return <RouterProvider router={router} />;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("announcement validation", () => {
  it("needs a text, a complete link and an end after the start and in the future", async () => {
    const t = (await initI18n(["en"])).getFixedT("en");
    const draft = {
      severity: "information" as const,
      text: " ",
      linkUrl: "javascript:alert(1)",
      linkLabel: "",
      startDate: "2026-10-20",
      startTime: "10:00",
      endDate: "2026-10-19",
      endTime: "10:00",
    };
    const now = Date.parse("2026-10-14T08:00:00.000Z");
    expect(validateAnnouncement(draft, "UTC", now, t).errors).toEqual({
      text: "Enter the text of the banner.",
      linkUrl: "Enter a web address, for example wiki.example.org/maintenance.",
      linkLabel: "Enter the text of the link, or remove the address.",
      end: "Choose an end after the start.",
    });
    expect(
      validateAnnouncement(
        { ...draft, text: "Maintenance", linkUrl: "", startDate: "", startTime: "", endDate: "2026-10-13" },
        "UTC",
        now,
        t,
      ).errors,
    ).toEqual({ end: "Choose an end in the future." });
    const linked = validateAnnouncement(
      { ...draft, text: "Maintenance", linkUrl: "wiki.example.org/maintenance", linkLabel: "Read the plan" },
      "UTC",
      now,
      t,
    );
    expect(linked.errors).toEqual({ end: "Choose an end after the start." });
  });
});

describe("the announcement settings", () => {
  it("validates on save, shows a preview and sets the banner", async () => {
    let saved: Record<string, unknown> | null = null;
    const { requests } = mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`GET /api/v1/organizations/${ORGANIZATION}/announcement`]: () => ({ body: { announcement: saved } }),
      [`PUT /api/v1/organizations/${ORGANIZATION}/announcement`]: (request) => {
        const body = request.body as Record<string, unknown>;
        saved = {
          id: "01929b1e-0000-7000-8000-0000000000f1",
          scope: "organization",
          organizationId: ORGANIZATION,
          version: "01929b1e-0000-7000-8000-0000000000f2",
          ...body,
          startsAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          updatedBy: { id: "01929b1e-0000-7000-8000-0000000000f3", name: "Anna Weber" },
        };
        return { body: saved };
      },
    });
    await renderWithProviders(
      inRouter(
        <AnnouncementSettings
          level="organization"
          organizationId={ORGANIZATION}
          organizationName="Northwind"
          editable
        />,
      ),
    );
    expect(await screen.findByText("No banner is set")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show banner" }));
    expect(await screen.findByText("Enter the text of the banner.")).toBeTruthy();
    expect(requests.some((request) => request.method === "PUT")).toBe(false);

    await userEvent.type(screen.getByRole("textbox", { name: /Text/ }), "Maintenance tonight.");
    await userEvent.click(screen.getByRole("radio", { name: /Warning/ }));
    const preview = screen.getByRole("region", { name: "Organization announcement" });
    expect(within(preview).getByText(/Maintenance tonight\./)).toBeTruthy();
    expect(within(preview).getByText(/· Northwind/)).toBeTruthy();
    expect(screen.getByText("People cannot dismiss this banner. It disappears at its end.")).toBeTruthy();

    expect(document.querySelector('input[type="date"]')).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^End date: / }));
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Show banner" }));
    await waitFor(() => expect(requests.some((request) => request.method === "PUT")).toBe(true));
    expect(requests.find((request) => request.method === "PUT")?.body).toMatchObject({
      severity: "warning",
      text: "Maintenance tonight.",
      link: null,
      startsAt: null,
    });
    expect(await screen.findByText("Banner saved. Open windows show it at once.")).toBeTruthy();
    expect(await screen.findByText(/The banner is shown until/)).toBeTruthy();
  });

  it("removes the banner at once and offers undo", async () => {
    let saved: Record<string, unknown> | null = {
      id: "01929b1e-0000-7000-8000-0000000000f1",
      scope: "instance",
      organizationId: null,
      version: "01929b1e-0000-7000-8000-0000000000f2",
      severity: "information",
      text: "Welcome to the new wiki.",
      link: null,
      startsAt: new Date(Date.now() - DAY).toISOString(),
      endsAt: new Date(Date.now() + DAY).toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: null,
    };
    const previous = saved;
    const { requests } = mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      "GET /api/v1/instance/announcement": () => ({ body: { announcement: saved } }),
      "DELETE /api/v1/instance/announcement": () => {
        saved = null;
        return { status: 204 };
      },
      "PUT /api/v1/instance/announcement": () => {
        saved = previous;
        return { body: previous };
      },
    });
    await renderWithProviders(
      inRouter(<AnnouncementSettings level="instance" editable beforeDangerZone={<p>Chat channels</p>} />),
    );
    const danger = await screen.findByRole("region", { name: "Danger zone" });
    expect(
      screen.getByText("Chat channels").compareDocumentPosition(danger) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const zone = await screen.findByRole("region", { name: "Danger zone" });
    await userEvent.click(within(zone).getByRole("button", { name: "Remove banner" }));
    expect(await screen.findByText("Banner removed.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() =>
      expect(requests.find((request) => request.method === "PUT")?.body).toMatchObject({
        text: "Welcome to the new wiki.",
        severity: "information",
      }),
    );
  });

  it("shows the banner read-only to people who may only view settings", async () => {
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      "GET /api/v1/instance/announcement": () => ({ body: { announcement: null } }),
    });
    await renderWithProviders(inRouter(<AnnouncementSettings level="instance" editable={false} />));
    expect(
      await screen.findByText("You can view the banner. Changing it needs permission to manage settings."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show banner" })).toBeNull();
  });
});
