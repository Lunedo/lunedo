import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../app.js";
import { initI18n } from "../i18n/index.js";
import { mockApi, type RecordedRequest } from "../testing/render.js";

const OLIVIA = {
  id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
  email: "olivia@example.org",
  name: "Olivia Owner",
};
const NOTIFICATION = "01929b1e-0000-7000-8000-0000000000aa";
const PAGE = "01929b1e-0000-7000-8000-0000000000bb";
const TOKEN = `${OLIVIA.id}.mentions.${"a".repeat(43)}`;

type Handler = (request: RecordedRequest) => { status?: number; body?: unknown };

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

function api(overrides: Record<string, Handler> = {}, signedIn = true) {
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
    "GET /api/v1/auth/session": () =>
      signedIn
        ? {
            body: {
              sessionKind: "full",
              account: OLIVIA,
              methods: ["password"],
              recentlyAuthenticated: true,
            },
          }
        : { status: 401, body: { type: "x", title: "x", status: 401, code: "unauthenticated" } },
    "GET /api/v1/organizations": () => ({ body: { items: [], nextCursor: null } }),
    "GET /api/v1/account/permissions": () => ({
      body: { instance: [], organization: [], grantableAreas: { instance: {}, organization: {} } },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 1, capped: false } }),
    ...overrides,
  });
}

async function open(path: string) {
  window.history.replaceState(null, "", path);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

describe("the unsubscribe link", () => {
  it("says what it turns off and turns it off without signing in", async () => {
    const { requests } = api(
      {
        [`GET /api/v1/notifications/unsubscribe/${TOKEN}`]: () => ({
          body: { scope: "event", event: "mentions", off: false },
        }),
        [`POST /api/v1/notifications/unsubscribe/${TOKEN}`]: () => ({
          body: { scope: "event", event: "mentions", off: true },
        }),
      },
      false,
    );
    await open(`/unsubscribe/${TOKEN}`);
    expect(await screen.findByText(/You get e-mails about/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Stop these e-mails" }));
    expect(await screen.findByText(/You no longer get e-mails about/)).toBeTruthy();
    expect(requests.filter((request) => request.method === "POST").map((request) => request.path)).toEqual([
      `/api/v1/notifications/unsubscribe/${TOKEN}`,
    ]);
  });

  it("explains a link that is not valid", async () => {
    api(
      {
        "GET /api/v1/notifications/unsubscribe/forged": () => ({
          status: 400,
          body: {
            type: "urn:lunedo:problem:invalidToken",
            title: "The link or code is not valid",
            status: 400,
            code: "invalidToken",
          },
        }),
      },
      false,
    );
    await open("/unsubscribe/forged");
    expect(await screen.findByText("Checking the unsubscribe link failed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop these e-mails" })).toBeNull();
  });
});

describe("a notification link from an e-mail", () => {
  it("marks the notification as read and opens what it is about", async () => {
    const { requests } = api({
      [`GET /api/v1/notifications/${NOTIFICATION}`]: () => ({
        body: {
          id: NOTIFICATION,
          type: "content.mentioned",
          organizationId: null,
          target: { type: "item", id: PAGE, number: 1040 },
          actor: null,
          actorCount: 1,
          params: { itemTitle: "Runbook", itemKind: "page", spaceKey: "OPS", commentId: null },
          count: 1,
          createdAt: "2026-10-15T08:00:00.000Z",
          updatedAt: "2026-10-15T08:00:00.000Z",
          readAt: null,
        },
      }),
      [`POST /api/v1/notifications/${NOTIFICATION}/read`]: () => ({ status: 204 }),
    });
    await open(`/notifications/${NOTIFICATION}`);
    await waitFor(() => expect(window.location.pathname).toBe("/spaces/OPS/pages/1040/runbook"));
    expect(requests.some((request) => request.path === `/api/v1/notifications/${NOTIFICATION}/read`)).toBe(
      true,
    );
  });

  it("says that a notification is gone instead of showing what it was about", async () => {
    api({
      [`GET /api/v1/notifications/${NOTIFICATION}`]: () => ({
        status: 404,
        body: { type: "urn:lunedo:problem:notFound", title: "Not found", status: 404, code: "notFound" },
      }),
    });
    await open(`/notifications/${NOTIFICATION}`);
    expect(await screen.findByText("This notification is no longer available")).toBeTruthy();
  });
});
