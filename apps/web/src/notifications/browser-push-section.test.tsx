import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { BrowserPushSection } from "./browser-push-section.js";

const DEVICE = "01929b1e-0000-7000-8000-0000000000d1";

function section() {
  return (
    <PreferencesProvider>
      <BrowserPushSection />
    </PreferencesProvider>
  );
}

function supportPush(permission: NotificationPermission) {
  const requestPermission = vi.fn(async () => permission);
  vi.stubGlobal("Notification", { requestPermission });
  vi.stubGlobal("PushManager", class {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: async () => undefined, register: vi.fn(), ready: new Promise(() => undefined) },
  });
  return requestPermission;
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("browser push on the personal settings", () => {
  it("says that it is off for the instance and offers nothing to turn on", async () => {
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      "GET /api/v1/account/push": () => ({ body: { enabled: false, publicKey: null, devices: [] } }),
    });
    await renderWithProviders(section());
    expect(
      await screen.findByText("Turned off for this instance. Instance administrators can turn it on."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Turn on for this device" })).toBeNull();
  });

  it("asks the browser only when turned on and explains a refusal", async () => {
    const requestPermission = supportPush("denied");
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      "GET /api/v1/account/push": () => ({ body: { enabled: true, publicKey: "BPub", devices: [] } }),
    });
    await renderWithProviders(section());
    const turnOn = await screen.findByRole("button", { name: "Turn on for this device" });
    expect(requestPermission).not.toHaveBeenCalled();
    await userEvent.click(turnOn);
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(
      await screen.findByText(
        "Your browser blocked notifications for Pagehall. Allow notifications in the site settings of your browser, then try again.",
      ),
    ).toBeTruthy();
  });

  it("lists devices and removes one after naming the effect", async () => {
    supportPush("granted");
    let devices = [
      {
        id: DEVICE,
        browser: "Firefox",
        operatingSystem: "Linux",
        createdAt: "2026-10-01T09:00:00.000Z",
        lastDeliveredAt: null,
        current: false,
      },
    ];
    const { requests } = mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      "GET /api/v1/account/push": () => ({ body: { enabled: true, publicKey: "BPub", devices } }),
      [`DELETE /api/v1/account/push/devices/${DEVICE}`]: () => {
        devices = [];
        return { status: 204 };
      },
    });
    await renderWithProviders(section());
    await userEvent.click(await screen.findByRole("button", { name: "Remove Firefox on Linux" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove Firefox on Linux?" });
    expect(within(dialog).getByText(/stops receiving browser push/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove device" }));
    expect(requests.some((request) => request.method === "DELETE")).toBe(true);
    expect(await screen.findByRole("button", { name: "Turn on for this device" })).toBeTruthy();
    expect(screen.queryByText("Firefox on Linux")).toBeNull();
  });
});
