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
const ORGANIZATION = {
  id: "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f",
  name: "Platform Team",
  slug: "platform-team",
  logoRef: null,
  language: "en",
  timeZone: "Europe/Vienna",
  accentColor: "petrol",
  createdAt: "2026-10-01T08:00:00.000Z",
  membershipKind: "member",
};
const GROUP = "01929b1e-0000-7000-8000-0000000000aa";
const LENA = "01929b1e-0000-7000-8000-00000000000b";

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

function groupApi() {
  let members = [{ accountId: LENA, name: "Lena Höfer", expiresAt: "2026-12-31T22:59:59.000Z" }];
  const mock = mockApi({
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
    "GET /api/v1/organizations": () => ({ body: { items: [ORGANIZATION], nextCursor: null } }),
    [`GET /api/v1/organizations/${ORGANIZATION.id}`]: () => ({ body: ORGANIZATION }),
    "GET /api/v1/account/permissions": () => ({
      body: {
        instance: [],
        organization: [
          "organization.view",
          "organization.members.view",
          "organization.members.manage",
          "organization.groups.view",
        ],
        grantableAreas: { instance: {}, organization: {} },
      },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0, capped: false } }),
    [`GET /api/v1/groups/${GROUP}`]: () => ({
      body: {
        id: GROUP,
        organizationId: ORGANIZATION.id,
        name: "Editors",
        description: "",
        managedBy: null,
        managers: [],
      },
    }),
    [`GET /api/v1/groups/${GROUP}/members`]: () => ({ body: { items: members, nextCursor: null } }),
    [`DELETE /api/v1/groups/${GROUP}/members/${LENA}`]: () => {
      members = [];
      return { status: 204 };
    },
    [`POST /api/v1/groups/${GROUP}/members`]: () => {
      members = [{ accountId: LENA, name: "Lena Höfer", expiresAt: "2026-12-31T22:59:59.000Z" }];
      return { status: 204 };
    },
    [`DELETE /api/v1/groups/${GROUP}`]: () => ({ status: 204 }),
  });
  return mock;
}

async function renderGroup() {
  window.history.replaceState(null, "", `/settings/organizations/${ORGANIZATION.id}/groups/${GROUP}`);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
  await screen.findByRole("heading", { name: "Editors", level: 1 });
}

describe("group detail", () => {
  it("removes a member at once and adds the member back with the same end date on undo", async () => {
    const { requests } = groupApi();
    await renderGroup();
    await userEvent.click(await screen.findByRole("button", { name: "Remove from group" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText("Lena Höfer was removed from the group.")).toBeTruthy();
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(requests.find((request) => request.method === "POST")?.body).toEqual({
        accountId: LENA,
        expiresAt: "2026-12-31T22:59:59.000Z",
      }),
    );
  });

  it("deletes the group from the danger zone only after its name is typed", async () => {
    const { requests } = groupApi();
    await renderGroup();
    const zone = screen.getByRole("region", { name: "Danger zone" });
    await userEvent.click(within(zone).getByRole("button", { name: "Delete group" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Editors?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete group" }));
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Type Editors to confirm"));
    expect(requests.some((request) => request.method === "DELETE" && request.path.endsWith(GROUP))).toBe(
      false,
    );
    await userEvent.type(within(dialog).getByLabelText("Type Editors to confirm"), "Editors");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete group" }));
    await waitFor(() =>
      expect(requests.some((request) => request.method === "DELETE" && request.path.endsWith(GROUP))).toBe(
        true,
      ),
    );
  });
});
