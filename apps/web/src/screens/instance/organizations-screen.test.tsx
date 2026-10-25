import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../../app.js";
import { initI18n } from "../../i18n/index.js";
import { mockApi } from "../../testing/render.js";

const OLIVIA = {
  id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
  email: "olivia@example.org",
  name: "Olivia Owner",
};
const ORGANIZATION = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
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
  window.history.replaceState(null, "", "/");
});

function api() {
  return mockApi({
    "GET /api/v1/instance/info": () => ({
      body: {
        name: "Example Wiki",
        setupComplete: true,
        language: "en",
        accentColor: "petrol",
        passwordMinLength: 12,
        selfRegistration: false,
        organization: null,
      },
    }),
    "GET /api/v1/auth/session": () => ({
      body: { sessionKind: "full", account: OLIVIA, methods: ["password"], recentlyAuthenticated: true },
    }),
    "GET /api/v1/organizations": () => ({ body: { items: [], nextCursor: null } }),
    "GET /api/v1/account/permissions": () => ({
      body: {
        instance: ["instance.organizations.view", "instance.organizations.manage"],
        organization: [],
        grantableAreas: { instance: {}, organization: {} },
      },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
    "GET /api/v1/instance/organizations": () => ({
      body: {
        items: [
          {
            id: ORGANIZATION,
            name: "Platform Team",
            slug: "platform",
            owners: [{ id: OLIVIA.id, name: OLIVIA.name }],
            memberCount: 3,
            domains: [],
            language: "en",
            timeZone: "Europe/Vienna",
            createdAt: "2026-10-01T09:00:00.000Z",
          },
        ],
        nextCursor: null,
      },
    }),
  });
}

describe("the organizations page", () => {
  it("leaves the identifier out of the list and copies the ID from the row menu", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    api();
    window.history.replaceState(null, "", "/settings/instance/organizations");
    const i18n = await initI18n(["en"]);
    render(<App i18n={i18n} queryClient={createQueryClient()} />);
    const table = await screen.findByRole("table", { name: "Organizations" });
    expect(await within(table).findByText("Platform Team")).toBeTruthy();
    expect(within(table).queryByText("platform")).toBeNull();
    await userEvent.click(within(table).getByRole("button", { name: "Actions for Platform Team" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy ID" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ORGANIZATION));
    expect(await screen.findByText("ID copied")).toBeTruthy();
  });
});
