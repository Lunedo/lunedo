import type { SetupStepDetails } from "@lunedo/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../../../preferences/preferences-provider.js";
import { mockApi, renderWithProviders } from "../../../testing/render.js";
import { SystemCheckStep } from "./system-check-step.js";

const CHECK = { status: "ok" as const, cause: null, fixCommand: null, docs: "admin/system-check.md" };

function checks(untrusted = false): SetupStepDetails<"systemCheck">["checks"] {
  return {
    database: { ...CHECK, cause: null, version: "16.4", migrationsUpToDate: true },
    clock: { ...CHECK, cause: null, offsetMs: 0, toleranceMs: 5000 },
    fileStorage: {
      ...CHECK,
      cause: null,
      path: "/var/lib/lunedo/files",
      exists: true,
      writable: true,
      freeBytes: 974_438_215_680,
      minimumFreeBytes: 1024 ** 3,
      processUid: 1000,
      processGid: 1000,
      ownerUid: 1000,
      ownerGid: 1000,
    },
    instanceUrl: { ...CHECK, cause: null, configured: true, url: "http://localhost:8080", source: "setting" },
    reachability: { ...CHECK, status: "info", cause: "loopback", url: "http://localhost:8080" },
    https: {
      ...CHECK,
      status: "warning",
      cause: "instanceUrlNotHttps",
      docs: "admin/reverse-proxy.md#tls-and-the-instance-address",
      instanceUrl: false,
      request: false,
    },
    clientAddress: untrusted
      ? {
          ...CHECK,
          status: "warning",
          cause: "untrustedProxy",
          docs: "admin/reverse-proxy.md#forwarded-headers-and-lunedo_trusted_proxies",
        }
      : CHECK,
  };
}

async function renderStep(language: string, refresh = vi.fn(async () => undefined), untrusted = false) {
  mockApi({});
  await renderWithProviders(
    <PreferencesProvider>
      <SystemCheckStep
        completed={false}
        details={{ checks: checks(untrusted) }}
        back={null}
        onDone={async () => undefined}
        refresh={refresh}
      />
    </PreferencesProvider>,
    language,
  );
  return refresh;
}

describe("the system check", () => {
  it("shows one row per check, explains a warning in its row and checks everything again at once", async () => {
    const refresh = await renderStep("en");
    const rows = within(screen.getByRole("list", { name: "System check" })).getAllByRole("listitem");
    expect(rows).toHaveLength(6);
    expect(rows.find((row) => row.textContent?.startsWith("Client address"))?.textContent).toContain(
      "Client addresses are read correctly",
    );
    const address = rows.find((row) => row.textContent?.startsWith("Address"));
    expect(address?.textContent).toContain("Local address, cannot be checked from outside");
    expect(address?.textContent).toContain("Info");
    const https = rows.find((row) => row.textContent?.startsWith("HTTPS"));
    expect(https?.textContent).toContain("does not start with https://");
    expect(within(https as HTMLElement).getByRole("link", { name: /How to set up HTTPS/ })).toBeTruthy();
    expect(screen.queryByText(/check failed/i)).toBeNull();
    const again = screen.getAllByRole("button", { name: "Check again" });
    expect(again).toHaveLength(1);
    await userEvent.click(again[0] as HTMLElement);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("warns when requests carry a forwarded address from a proxy that is not trusted and links to the proxy docs", async () => {
    await renderStep("en", undefined, true);
    const row = within(screen.getByRole("list", { name: "System check" }))
      .getAllByRole("listitem")
      .find((item) => item.textContent?.startsWith("Client address")) as HTMLElement;
    expect(row.textContent).toContain("not in LUNEDO_TRUSTED_PROXIES");
    expect(row.textContent).toContain("Warning");
    expect(within(row).getByRole("link").getAttribute("href")).toContain(
      "reverse-proxy/#forwarded-headers-and-lunedo_trusted_proxies",
    );
  });

  it("writes sizes in the language of the setup", async () => {
    await renderStep("de");
    expect(screen.getByText("Beschreibbar, 907,5 GB frei")).toBeTruthy();
  });
});
