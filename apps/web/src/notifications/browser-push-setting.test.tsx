import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../api/organization-queries.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { BrowserPushSetting } from "./browser-push-setting.js";

function entry(value: boolean): SettingEntry {
  return {
    key: "notifications.browserPush",
    value,
    defaultValue: false,
    source: value ? "instance" : "default",
    lockedBy: null,
    locked: false,
    lockable: false,
    levelsBelow: [],
    editable: true,
    maximum: null,
    levels: [{ level: "instance", value: value ? true : null, locked: false, effective: true }],
  } as SettingEntry;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser push for the instance", () => {
  it("explains where messages go before it turns on, and turns off at once", async () => {
    const { requests } = mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      "PUT /api/v1/instance/settings/notifications.browserPush": () => ({ status: 204 }),
    });
    await renderWithProviders(<BrowserPushSetting settings={[entry(false)]} editable />);
    await userEvent.click(screen.getByRole("switch", { name: "Browser push for this instance" }));
    const dialog = await screen.findByRole("dialog", { name: "Turn on browser push?" });
    expect(within(dialog).getByText(/They leave this server/)).toBeTruthy();
    expect(requests.filter((request) => request.method === "PUT")).toEqual([]);

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(requests.filter((request) => request.method === "PUT")).toEqual([]);

    await userEvent.click(screen.getByRole("switch", { name: "Browser push for this instance" }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Turn on browser push" }),
    );
    expect(requests.find((request) => request.method === "PUT")?.body).toEqual({ value: true });
  });

  it("turns off without asking", async () => {
    const { requests } = mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      "PUT /api/v1/instance/settings/notifications.browserPush": () => ({ status: 204 }),
    });
    await renderWithProviders(<BrowserPushSetting settings={[entry(true)]} editable />);
    await userEvent.click(screen.getByRole("switch", { name: "Browser push for this instance" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await vi.waitFor(() =>
      expect(requests.find((request) => request.method === "PUT")?.body).toEqual({ value: false }),
    );
  });
});
