import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { SpaceContext, type SpaceContextValue } from "../spaces/space-context.js";
import type { SpaceWithRole } from "../spaces/space-queries.js";
import { mockApi, renderWithProviders } from "../testing/render.js";
import { PortalAccountsScreen } from "./settings/portal-accounts-screen.js";

const SPACE_ID = "01929b1e-0000-7000-8000-0000000000b1";
const READER = "01929b1e-0000-7000-8000-0000000000c1";

afterEach(() => {
  vi.unstubAllGlobals();
});

function inSpace(ui: ReactNode, audience: "portal" | "signedIn" = "portal") {
  const context: SpaceContextValue = {
    space: {
      id: SPACE_ID,
      key: "KUNDEN",
      type: "knowledgeBase",
      audience,
      name: "Kundenhilfe",
      role: "admin",
      archived: false,
    } as SpaceWithRole,
    canEdit: true,
    openMove: () => undefined,
    openCopy: () => undefined,
    openCreate: () => undefined,
  };
  const root = createRootRoute({
    component: () => (
      <PreferencesProvider>
        <SpaceContext value={context}>{ui}</SpaceContext>
      </PreferencesProvider>
    ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return <RouterProvider router={router} />;
}

const LIST = {
  accounts: [
    {
      id: READER,
      name: "Klara Kundin",
      email: "klara@example.org",
      state: "active",
      expiresAt: null,
      createdAt: "2026-10-01T08:00:00.000Z",
      lastSignInAt: null,
      otherOrganizations: false,
    },
  ],
  invitations: [],
};

describe("portal accounts of a knowledge base", () => {
  it("validates the invitation before sending it and lists the readers", async () => {
    const api = mockApi({
      [`GET /api/v1/spaces/${SPACE_ID}/portal-accounts`]: () => ({ body: LIST }),
      [`POST /api/v1/spaces/${SPACE_ID}/portal-accounts`]: () => ({
        status: 201,
        body: {
          id: READER,
          email: "neu@example.org",
          membershipExpiresAt: null,
          expiresAt: "2026-10-27T08:00:00.000Z",
        },
      }),
    });
    await renderWithProviders(inSpace(<PortalAccountsScreen />));
    expect(await screen.findByText("Klara Kundin")).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Invite reader" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("E-mail address"), "kein-mail");
    await user.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    expect(await within(dialog).findByText(/Enter an e-mail address/)).toBeTruthy();
    expect(api.requests.some((request) => request.method === "POST")).toBe(false);
    await user.clear(within(dialog).getByLabelText("E-mail address"));
    await user.type(within(dialog).getByLabelText("E-mail address"), "neu@example.org");
    await user.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "POST")?.body).toEqual({
        email: "neu@example.org",
        expiresAt: null,
      }),
    );
  });

  it("explains that only knowledge bases for portal accounts take readers", async () => {
    mockApi({
      [`GET /api/v1/spaces/${SPACE_ID}/portal-accounts`]: () => ({ body: { accounts: [], invitations: [] } }),
    });
    await renderWithProviders(inSpace(<PortalAccountsScreen />, "signedIn"));
    expect(await screen.findByText("This knowledge base is not for portal accounts")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Invite reader" })).toBeNull();
  });
});
