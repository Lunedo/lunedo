import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import type { AuditItem } from "./audit-presentation.js";
import { SecurityActivitySection } from "./security-activity.js";

const ME = "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c";

function signIn(id: string, occurredAt: string, name = "auth.signedIn"): AuditItem {
  return {
    id,
    scopeType: "instance",
    scopeId: "00000000-0000-0000-0000-000000000000",
    sequence: 1,
    name,
    actorType: "account",
    actorId: ME,
    targetType: "account",
    targetId: ME,
    fields: {},
    occurredAt,
    requestId: "6f1c2b0e-5d4a-4c3b-9a2f-1e0d9c8b7a6f",
    clientIp: "198.51.100.7",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
    labelKey: `audit.events.${name}`,
    changeKind: "fields",
    actor: { type: "account", id: ME, name: "Olivia" },
    target: { type: "account", id: ME, name: "Olivia" },
    scope: { type: "account", id: ME, name: "Olivia" },
    changes: [],
    references: {},
  } as AuditItem;
}

async function renderSection() {
  await renderWithProviders(
    <PreferencesProvider>
      <SecurityActivitySection accountId={ME} />
    </PreferencesProvider>,
  );
}

describe("the recent security activity", () => {
  it("lists own events with browser and address and loads older ones", async () => {
    const { requests } = mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`GET /api/v1/accounts/${ME}/security-activity`]: (request) =>
        request.path.includes("cursor=")
          ? {
              body: {
                items: [
                  signIn(
                    "01929b1f-0000-7000-8000-000000000003",
                    "2026-09-28T08:00:00.000Z",
                    "auth.signInFailed",
                  ),
                ],
                nextCursor: null,
              },
            }
          : {
              body: {
                items: [signIn("01929b1f-0000-7000-8000-000000000001", "2026-10-01T08:00:00.000Z")],
                nextCursor: "next",
              },
            },
    });
    await renderSection();
    const list = await screen.findByRole("list", { name: "Recent security activity" });
    expect(within(list).getByText("Signed in")).toBeTruthy();
    expect(within(list).getByText(/Firefox 131 on Windows · 198\.51\.100\.7/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show older events" }));
    expect(await within(list).findByText("Sign-in failed")).toBeTruthy();
    expect(requests.some((request) => request.path.includes("cursor=next"))).toBe(true);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Show older events" })).toBeNull());
  });

  it("says what failed and offers a retry", async () => {
    let failing = true;
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`GET /api/v1/accounts/${ME}/security-activity`]: () =>
        failing ? problem(503, "busy") : { body: { items: [], nextCursor: null } },
    });
    await renderSection();
    expect(
      await screen.findByText("Your recent security activity could not be loaded", {}, { timeout: 5000 }),
    ).toBeTruthy();
    failing = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No security events yet.")).toBeTruthy();
  }, 15_000);
});
