import { render, screen, within } from "@testing-library/react";
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
const LUKAS = "01929b1e-0000-7000-8000-00000000a002";
const SPACE = "01929b1e-0000-7000-8000-0000000000a1";
const PAGE = "01929b1e-0000-7000-8000-0000000000b2";
const ARCHIVE = "01929b1e-0000-7000-8000-0000000000a3";

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
  mockApi({
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
        organization: ["organization.view", "organization.access.view"],
        grantableAreas: { instance: {}, organization: {} },
      },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
    "GET /api/v1/people": () => ({
      body: {
        items: [{ id: LUKAS, name: "Lukas Hofer", email: "lukas@example.org", type: "standard" }],
        nextCursor: null,
      },
    }),
    [`GET /api/v1/organizations/${ORGANIZATION.id}/people/${LUKAS}/access`]: () => ({
      body: {
        accountId: LUKAS,
        name: "Lukas Hofer",
        email: "lukas@example.org",
        entries: [
          {
            kind: "space",
            spaceId: SPACE,
            spaceName: "IT Operations",
            spaceKey: "ITOPS",
            itemId: null,
            itemTitle: null,
            role: "reader",
            count: 1,
            reasons: [
              { type: "spaceRole", role: "reader", via: { type: "group", groupId: SPACE, name: "Support" } },
            ],
          },
          {
            kind: "share",
            spaceId: SPACE,
            spaceName: "IT Operations",
            spaceKey: "ITOPS",
            itemId: PAGE,
            itemTitle: "VPN access",
            role: "editor",
            count: 2,
            reasons: [
              { type: "share", role: "editor", itemId: PAGE, itemTitle: "VPN access", inherited: false },
            ],
          },
          {
            kind: "restrictedPages",
            spaceId: SPACE,
            spaceName: "IT Operations",
            spaceKey: "ITOPS",
            itemId: null,
            itemTitle: null,
            role: null,
            count: 3,
            reasons: [],
            inactive: null,
          },
          {
            kind: "space",
            spaceId: ARCHIVE,
            spaceName: "Archive",
            spaceKey: "ARCH",
            itemId: null,
            itemTitle: null,
            role: "editor",
            count: 1,
            reasons: [
              { type: "spaceRole", role: "editor", via: { type: "account" }, inactive: "membershipEnded" },
            ],
            inactive: "membershipEnded",
          },
        ],
      },
    }),
  });
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("the access overview of an organization", () => {
  it("shows what a person can do and why, counting restricted pages without titles", async () => {
    window.history.replaceState(null, "", `/settings/organizations/${ORGANIZATION.id}/access`);
    const i18n = await initI18n(["en"]);
    render(<App i18n={i18n} queryClient={createQueryClient()} />);
    const all = await screen.findByRole("link", { name: "Export everyone as CSV" });
    expect(all.getAttribute("href")).toBe(`/api/v1/organizations/${ORGANIZATION.id}/access-overview`);
    await userEvent.click(screen.getByRole("combobox", { name: "Person" }));
    await userEvent.click(await screen.findByRole("option", { name: /Lukas Hofer/ }));
    const section = await screen.findByRole("region", { name: "What can Lukas Hofer do?" });
    expect(within(section).getAllByText("whole space")).toHaveLength(2);
    expect(within(section).getByRole("link", { name: "VPN access" })).toBeTruthy();
    expect(within(section).getByText("3 shared restricted pages you cannot read")).toBeTruthy();
    await userEvent.click(within(section).getAllByRole("button", { name: "Why?" })[0] as HTMLElement);
    expect(within(section).getByText("Can read in the space through the group Support")).toBeTruthy();
    const inactive = within(section).getByText("Archive").closest("li") as HTMLElement;
    expect(within(inactive).getByText("No effect")).toBeTruthy();
    expect(
      within(inactive).getByText(
        "Their membership in the organization ended. The entry applies again if they become a member again.",
      ),
    ).toBeTruthy();
    await userEvent.click(within(inactive).getByRole("button", { name: "Why?" }));
    expect(
      within(inactive).getByText(
        /given to them directly\. No effect: their membership in the organization ended\./,
      ),
    ).toBeTruthy();
    expect(within(section).getByRole("link", { name: "Export as CSV" }).getAttribute("href")).toBe(
      `/api/v1/organizations/${ORGANIZATION.id}/access-overview?accountId=${LUKAS}`,
    );
  });
});
