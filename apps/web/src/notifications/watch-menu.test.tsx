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
    let current: unknown = { own: null, effective: null };
    const api = mockApi({
      [`GET /api/v1/items/${ITEM}/watch`]: () => ({ body: current }),
      [`PUT /api/v1/items/${ITEM}/watch`]: (request) => {
        current = {
          own: { ...(request.body as object), keepMentions: true, automatic: false },
          effective: { ...(request.body as object), keepMentions: true, source: "target" },
        };
        return { body: current };
      },
    });
    await renderWithProviders(<WatchMenu target={{ type: "item", id: ITEM }} name="Runbook" />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Watching options for Runbook: not watched" }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: "Watch" }));
    await screen.findByText("You now watch Runbook.");
    expect(api.requests.find((request) => request.method === "PUT")?.body).toEqual({ state: "watching" });

    await userEvent.click(
      await screen.findByRole("button", { name: "Watching options for Runbook: watched" }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: "Mute…" }));
    const keep = await screen.findByRole("checkbox", {
      name: "Still notify me about mentions, tasks assigned to me, pages shared with me and access requests I can decide",
    });
    expect(keep.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Mute" }));
    await waitFor(() =>
      expect(api.requests.filter((request) => request.method === "PUT").at(-1)?.body).toEqual({
        state: "muted",
        keepMentions: true,
      }),
    );
    expect(await screen.findByRole("button", { name: "Watching options for Runbook: muted" })).toBeTruthy();
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
    await userEvent.click(
      await screen.findByRole("button", { name: "Watching options for Runbook: watched" }),
    );
    expect(await screen.findByText("You watch this through its space.")).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: "Stop watching" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "PUT")?.body).toEqual({
        state: "notWatching",
      }),
    );
  });
});
