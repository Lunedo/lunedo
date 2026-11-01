import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, renderWithProviders } from "../testing/render.js";
import { SpaceAccessRequests } from "./access-requests.js";

const SPACE = "01929b1e-0000-7000-8000-0000000000a1";
const REQUEST = "01929b1e-0000-7000-8000-0000000000a2";
const PAGE = "01929b1e-0000-7000-8000-0000000000a3";

function entry(status: string) {
  return {
    id: REQUEST,
    requester: { id: "01929b1e-0000-7000-8000-0000000000a4", name: "Felix Gruber", email: null },
    target: "page",
    spaceId: SPACE,
    spaceName: "People",
    itemId: PAGE,
    itemTitle: "Salary bands 2027",
    message: "For the onboarding in November",
    status,
    role: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: "2026-10-05T08:00:00.000Z",
  };
}

describe("access requests in the space settings", () => {
  it("show the same row as the notification and decline right there", async () => {
    let open = true;
    const api = mockApi({
      [`GET /api/v1/spaces/${SPACE}/access-requests`]: () => ({ body: open ? [entry("open")] : [] }),
      [`POST /api/v1/access-requests/${REQUEST}/decide`]: () => {
        open = false;
        return { body: entry("declined") };
      },
    });
    await renderWithProviders(
      <PreferencesProvider>
        <SpaceAccessRequests spaceId={SPACE} />
      </PreferencesProvider>,
    );
    const row = await screen.findByRole("listitem");
    expect(within(row).getByText(/Felix Gruber asks for access to/)).toBeTruthy();
    expect(within(row).getByText(/“For the onboarding in November”/)).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Give access" })).toBeTruthy();
    await userEvent.click(within(row).getByRole("button", { name: "Decline" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.path.endsWith("/decide"))?.body).toEqual({
        approve: false,
      }),
    );
    expect(await screen.findByText("No open access requests.")).toBeTruthy();
  });

  it("offer only page roles for a page", async () => {
    mockApi({ [`GET /api/v1/spaces/${SPACE}/access-requests`]: () => ({ body: [entry("open")] }) });
    await renderWithProviders(
      <PreferencesProvider>
        <SpaceAccessRequests spaceId={SPACE} />
      </PreferencesProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Give access" }));
    expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual([
      "Can read",
      "Can comment",
      "Can edit",
    ]);
  });
});
