import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../../testing/render.js";
import { FollowBlogButton } from "./follow-blog.js";
import { FollowedBlogs } from "./followed-blogs.js";

const SPACE = "01929b1e-0000-7000-8000-0000000000a1";

function inRouter(ui: ReactNode) {
  const root = createRootRoute({ component: () => <PreferencesProvider>{ui}</PreferencesProvider> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return <RouterProvider router={router} />;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("following a blog", () => {
  it("follows and stops following, with undo", async () => {
    let following = false;
    const { requests } = mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`GET /api/v1/spaces/${SPACE}/blog/subscription`]: () => ({ body: { following } }),
      [`PUT /api/v1/spaces/${SPACE}/blog/subscription`]: () => {
        following = true;
        return { status: 204 };
      },
      [`DELETE /api/v1/spaces/${SPACE}/blog/subscription`]: () => {
        following = false;
        return { status: 204 };
      },
    });
    await renderWithProviders(<FollowBlogButton spaceId={SPACE} spaceName="IT Operations" />);
    const follow = await screen.findByRole("button", { name: "Follow blog" });
    expect(follow.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(follow);
    expect(
      await screen.findByText(
        "You follow the blog of IT Operations. New posts appear in your notifications.",
      ),
    ).toBeTruthy();
    const pressed = await screen.findByRole("button", { name: "Following" });
    expect(pressed.getAttribute("aria-pressed")).toBe("true");

    await userEvent.click(pressed);
    expect(await screen.findByText("You no longer follow the blog of IT Operations.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() => expect(following).toBe(true));
    expect(await screen.findByRole("button", { name: "Following" })).toBeTruthy();
    expect(requests.filter((request) => request.method === "PUT")).toHaveLength(2);
  });

  it("says what failed when following does not work", async () => {
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`GET /api/v1/spaces/${SPACE}/blog/subscription`]: () => ({ body: { following: false } }),
      [`PUT /api/v1/spaces/${SPACE}/blog/subscription`]: () => problem(503, "unavailable"),
    });
    await renderWithProviders(<FollowBlogButton spaceId={SPACE} spaceName="IT Operations" />);
    await userEvent.click(await screen.findByRole("button", { name: "Follow blog" }));
    expect(
      await screen.findByText("The blog could not be followed. Check your connection and try again."),
    ).toBeTruthy();
    expect((await screen.findByRole("button", { name: "Follow blog" })).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });
});

describe("followed blogs in personal settings", () => {
  it("lists readable blogs and removes the others after a confirmation", async () => {
    let unavailable = 1;
    const { requests } = mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      "GET /api/v1/account/followed-blogs": () => ({
        body: {
          items: [
            {
              spaceId: SPACE,
              spaceKey: "ITOPS",
              spaceName: "IT Operations",
              personal: false,
              followedAt: "2026-10-01T08:00:00.000Z",
            },
          ],
          unavailable,
        },
      }),
      "DELETE /api/v1/account/followed-blogs/unavailable": () => {
        unavailable = 0;
        return { body: { removed: 1 } };
      },
    });
    await renderWithProviders(inRouter(<FollowedBlogs />));
    const list = await screen.findByRole("list", { name: "Followed blogs" });
    expect(within(list).getByRole("link", { name: "IT Operations" }).getAttribute("href")).toBe(
      "/spaces/ITOPS/blog",
    );
    expect(screen.getByText(/You follow 1 blog of a space you cannot open at the moment/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Stop following 1 blog" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/when your access returns/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Stop following 1 blog" }));
    await waitFor(() =>
      expect(requests.some((request) => request.path === "/api/v1/account/followed-blogs/unavailable")).toBe(
        true,
      ),
    );
    await waitFor(() => expect(screen.queryByText(/cannot open at the moment/)).toBeNull());
  });
});
