import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useNavigationFocus } from "./navigation-focus.js";

function Frame() {
  useNavigationFocus();
  return <Outlet />;
}

function setup(nextScreenReady: Promise<void> = Promise.resolve()) {
  const root = createRootRoute({ component: Frame });
  const first = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => (
      <main>
        <h1>Start</h1>
        <button type="button">Go</button>
      </main>
    ),
  });
  const second = createRoute({
    getParentRoute: () => root,
    path: "/next",
    loader: () => nextScreenReady,
    component: () => (
      <main>
        <h1>Next screen</h1>
      </main>
    ),
  });
  return createRouter({
    routeTree: root.addChildren([first, second]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

describe("focus after navigation", () => {
  it("leaves the focus alone on the first screen", async () => {
    render(<RouterProvider router={setup()} />);
    await screen.findByRole("heading", { name: "Start" });
    expect(document.activeElement).toBe(document.body);
  });

  it("moves the focus to the main heading of the new screen when the focused element is gone", async () => {
    const router = setup();
    render(<RouterProvider router={router} />);
    const button = await screen.findByRole("button", { name: "Go" });
    button.focus();
    await act(async () => router.history.push("/next"));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Next screen" })),
    );
  });

  it("waits for the new screen instead of focusing the heading of the screen that is still shown", async () => {
    let finishLoading = () => {};
    const router = setup(
      new Promise<void>((resolve) => {
        finishLoading = resolve;
      }),
    );
    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { name: "Start" });
    await act(async () => {
      router.history.push("/next");
    });
    expect(screen.getByRole("heading", { name: "Start" })).toBeTruthy();
    await act(async () => finishLoading());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Next screen" })),
    );
  });
});
