import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderWithProviders } from "../testing/render.js";
import { WatchMenu } from "./watch-menu.js";

const ITEM = "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a40";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("watch menu", () => {
  it("watches an item and mutes it with mentions kept by default", async () => {
    const api = mockApi({
      [`GET /api/v1/items/${ITEM}/watch`]: () => ({ body: { own: null, effective: null } }),
      [`PUT /api/v1/items/${ITEM}/watch`]: (request) => ({
        body: {
          own: { ...(request.body as object), keepMentions: true, automatic: false },
          effective: { ...(request.body as object), keepMentions: true, source: "target" },
        },
      }),
    });
    await renderWithProviders(<WatchMenu target={{ type: "item", id: ITEM }} name="Runbook" />);
    await userEvent.click(screen.getByRole("button", { name: "Watching options for Runbook" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Watch" }));
    await screen.findByText("You now watch Runbook.");
    expect(api.requests.find((request) => request.method === "PUT")?.body).toEqual({ state: "watching" });

    await userEvent.click(screen.getByRole("button", { name: "Watching options for Runbook" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Mute…" }));
    const keep = await screen.findByRole("checkbox", {
      name: "Still notify me about mentions and tasks assigned to me",
    });
    expect(keep.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Mute" }));
    await waitFor(() =>
      expect(api.requests.filter((request) => request.method === "PUT").at(-1)?.body).toEqual({
        state: "muted",
        keepMentions: true,
      }),
    );
  });

  it("names the space or series a state comes from and stops watching only this item", async () => {
    const api = mockApi({
      [`GET /api/v1/items/${ITEM}/watch`]: () => ({
        body: { own: null, effective: { state: "watching", keepMentions: true, source: "space" } },
      }),
      [`PUT /api/v1/items/${ITEM}/watch`]: () => ({
        body: { own: { state: "notWatching", keepMentions: true, automatic: false }, effective: null },
      }),
    });
    await renderWithProviders(<WatchMenu target={{ type: "item", id: ITEM }} name="Runbook" />);
    await waitFor(() => expect(api.requests.length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole("button", { name: "Watching options for Runbook" }));
    expect(await screen.findByText("You watch this through its space.")).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: "Stop watching" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "PUT")?.body).toEqual({
        state: "notWatching",
      }),
    );
  });
});
