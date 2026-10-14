import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../app.js";
import { initI18n } from "../i18n/index.js";
import { createAppRouter } from "../router.js";
import { mockApi } from "../testing/render.js";
import { EDIT_PAGE_EVENT } from "./builtin.js";
import { commands, navigationItems, type ShellContext, shortcuts } from "./extensions.js";

const ORGANIZATION = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f";

function recordingContext(
  navigated: { to: string; params: Record<string, string> | undefined }[],
): ShellContext {
  return {
    organizationId: ORGANIZATION,
    can: () => true,
    navigate: (to, params) => navigated.push({ to, params }),
    openCommandPalette: () => undefined,
    openSearch: () => undefined,
    openShortcuts: () => undefined,
    toggleNotifications: () => undefined,
    toggleSidebar: () => undefined,
    signOut: () => undefined,
  };
}

describe("navigation targets", () => {
  it("exist for every shortcut, command and navigation entry, wherever the person is", async () => {
    await import("./builtin.js");
    mockApi({});
    const navigated: { to: string; params: Record<string, string> | undefined }[] = [];
    const context = recordingContext(navigated);
    for (const shortcut of shortcuts.list()) shortcut.run(context);
    for (const command of commands.list()) command.run(context);
    for (const item of navigationItems.list()) {
      navigated.push({ to: item.to, params: { organizationId: ORGANIZATION } });
    }
    expect(navigated.length).toBeGreaterThan(10);

    for (const location of [
      "/",
      "/spaces/ENG/meetings",
      "/spaces/ENG/pages/01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f",
    ]) {
      window.history.replaceState(null, "", location);
      const router = createAppRouter(createQueryClient());
      await router.load().catch(() => undefined);
      for (const target of navigated) {
        const built = router.buildLocation({ to: target.to as never, params: target.params as never });
        const [, , found] = router.getMatchedRoutes(built.pathname);
        expect(found, `${target.to} from ${location}`).toBeDefined();
        const routeSegments = (found?.fullPath ?? "").split("/").filter(Boolean);
        const required = routeSegments.filter((segment: string) => !segment.startsWith("{-")).length;
        const actual = built.pathname.split("/").filter(Boolean).length;
        expect(
          actual,
          `${target.to} from ${location} is longer than the route it reaches`,
        ).toBeGreaterThanOrEqual(required);
        expect(
          actual,
          `${target.to} from ${location} is longer than the route it reaches`,
        ).toBeLessThanOrEqual(routeSegments.length);
        expect(built.pathname, `${target.to} from ${location}`).not.toContain("$");
        expect(built.pathname.startsWith("/spaces/"), `${target.to} from ${location}`).toBe(
          target.to.startsWith("/spaces/"),
        );
      }
    }
    window.history.replaceState(null, "", "/");
  });
});

describe("single-key shortcuts", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
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
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  async function renderShell() {
    mockApi({
      "GET /api/v1/instance/info": () => ({
        body: {
          name: "Example Wiki",
          setupComplete: true,
          language: "en",
          accentColor: "petrol",
          passwordMinLength: 12,
          selfRegistration: false,
          organization: { id: ORGANIZATION, name: "Platform Team", logoRef: null, accentColor: "violet" },
        },
      }),
      "GET /api/v1/auth/session": () => ({
        body: {
          sessionKind: "full",
          account: {
            id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
            email: "olivia@example.org",
            name: "Olivia Owner",
          },
          methods: ["password"],
          recentlyAuthenticated: true,
        },
      }),
      "GET /api/v1/organizations": () => ({
        body: {
          items: [
            {
              id: ORGANIZATION,
              name: "Platform Team",
              slug: "platform-team",
              logoRef: null,
              language: "en",
              timeZone: "UTC",
              accentColor: "violet",
              createdAt: "2026-10-01T08:00:00.000Z",
              membershipKind: "member",
            },
          ],
          nextCursor: null,
        },
      }),
      "GET /api/v1/account/permissions": () => ({
        body: { instance: [], organization: ["organization.view", "organization.audit.view"] },
      }),
      "GET /api/v1/account/preferences": () => ({ body: [] }),
      "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
    });
    window.history.replaceState(null, "", "/settings/preferences");
    const i18n = await initI18n(["en"]);
    render(<App i18n={i18n} queryClient={createQueryClient()} />);
    await screen.findByRole("button", { name: /Notifications/ });
  }

  it("run from the page but stay silent while the focus is in a text field or an editor", async () => {
    await renderShell();
    const edit = vi.fn();
    globalThis.addEventListener(EDIT_PAGE_EVENT, edit);

    await userEvent.keyboard("e");
    expect(edit).toHaveBeenCalledTimes(1);

    const field = document.createElement("input");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const textbox = document.createElement("div");
    textbox.setAttribute("role", "textbox");
    textbox.tabIndex = 0;
    document.body.append(field, editor, textbox);
    for (const element of [field, editor, textbox]) {
      element.focus();
      await userEvent.keyboard("e");
      await userEvent.keyboard("ga");
    }
    expect(edit).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/settings/preferences");
    globalThis.removeEventListener(EDIT_PAGE_EVENT, edit);
  });
});
