import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstanceMovedScreen, movedAddress } from "../../shell/instance-moved.js";
import { mockApi, renderWithProviders } from "../../testing/render.js";
import { cleanAddress, InstanceAddressRow } from "./instance-address.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cleanAddress", () => {
  it("keeps the origin and drops a trailing slash, refuses paths and other schemes", () => {
    expect(cleanAddress(" https://wiki.example.org/ ")).toBe("https://wiki.example.org");
    expect(cleanAddress("https://wiki.example.org/wiki")).toBeNull();
    expect(cleanAddress("ftp://wiki.example.org")).toBeNull();
    expect(cleanAddress("wiki.example.org")).toBeNull();
  });
});

describe("InstanceAddressRow", () => {
  it("shows an address from the server environment as read-only and says where it comes from", async () => {
    mockApi({
      "GET /api/v1/instance/address": () => ({
        body: { url: "https://wiki.example.org", source: "environment" },
      }),
    });
    await renderWithProviders(<InstanceAddressRow canManage />);
    expect(await screen.findByText("https://wiki.example.org")).toBeTruthy();
    expect(screen.getByText(/Set in the server environment/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("saves only with Save, names the effects and moves this browser to the new address", async () => {
    const { requests } = mockApi({
      "GET /api/v1/instance/address": () => ({ body: { url: "https://old.example.org", source: "setting" } }),
      "PUT /api/v1/instance/address": () => ({ body: { url: "https://wiki.example.org", endedSessions: 3 } }),
    });
    const navigate = vi.fn();
    await renderWithProviders(<InstanceAddressRow canManage navigate={navigate} />);
    const input = await screen.findByDisplayValue("https://old.example.org");
    await userEvent.clear(input);
    await userEvent.type(input, "https://wiki.example.org/wiki");
    expect(requests.some((request) => request.method === "PUT")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/without a path/)).toBeTruthy();
    await userEvent.clear(input);
    await userEvent.type(input, "https://wiki.example.org/");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("dialog", { name: "Move Lunedo to https://wiki.example.org?" });
    expect(within(dialog).getByText(/Passkeys registered under the old address stop working/)).toBeTruthy();
    expect(within(dialog).getByText(/Redirect and reply URLs at every identity provider/)).toBeTruthy();
    expect(within(dialog).getByText(/All open sessions end, also yours/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Move to new address" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("https://wiki.example.org/sign-in"));
    expect(requests.find((request) => request.method === "PUT")?.body).toEqual({
      url: "https://wiki.example.org",
    });
  });

  it("keeps the current address on Cancel", async () => {
    const { requests } = mockApi({
      "GET /api/v1/instance/address": () => ({ body: { url: "https://old.example.org", source: "setting" } }),
    });
    await renderWithProviders(<InstanceAddressRow canManage />);
    const input = await screen.findByDisplayValue("https://old.example.org");
    await userEvent.type(input, "x");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect((input as HTMLInputElement).value).toBe("https://old.example.org");
    expect(requests.some((request) => request.method === "PUT")).toBe(false);
  });
});

describe("a page open under an old address", () => {
  it("is recognized only when the instance has another origin", () => {
    expect(movedAddress("https://wiki.example.org", "https://old.example.org")).toBe(
      "https://wiki.example.org",
    );
    expect(movedAddress("https://wiki.example.org", "https://wiki.example.org")).toBeNull();
    expect(movedAddress(null, "https://old.example.org")).toBeNull();
  });

  it("explains the move and links to the same page at the new address", async () => {
    await renderWithProviders(<InstanceMovedScreen url="https://wiki.example.org" />);
    expect(screen.getByText("Lunedo has moved")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open https://wiki.example.org" });
    expect(link.getAttribute("href")).toBe(`https://wiki.example.org${window.location.pathname}`);
  });
});
