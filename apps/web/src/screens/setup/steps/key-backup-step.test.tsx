import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createFormatter, defaultFormatSettings } from "../../../format/format.js";
import { initI18n } from "../../../i18n/index.js";
import { PreferencesProvider } from "../../../preferences/preferences-provider.js";
import { mockApi, renderWithProviders } from "../../../testing/render.js";
import {
  type EmergencyKit,
  emergencyKitFileName,
  emergencyKitText,
  KeyBackupStep,
} from "./key-backup-step.js";

const downloads = vi.hoisted(() => [] as { name: string; text: string }[]);
vi.mock("../../../components/download.js", () => ({
  downloadText: (name: string, text: string) => downloads.push({ name, text }),
}));

const KIT: EmergencyKit = {
  instanceUrl: "https://wiki.example.org:8443",
  createdAt: "2026-10-24T12:00:00.000Z",
  recoveryCodes: ["aaaa-1111-bbbb-2222", "cccc-3333-dddd-4444"],
  masterKeys: "1:MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
  backupKey: "1:QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWY=",
};

function renderStep(downloaded: boolean) {
  const onDone = vi.fn(async () => undefined);
  const result = renderWithProviders(
    <PreferencesProvider>
      <KeyBackupStep
        completed={false}
        details={{ downloaded, provider: "file" }}
        back={null}
        onDone={onDone}
        refresh={async () => undefined}
      />
    </PreferencesProvider>,
  );
  return { onDone, result };
}

describe("the emergency kit", () => {
  let de: Awaited<ReturnType<typeof initI18n>>;

  beforeAll(async () => {
    de = await initI18n(["de"]);
  });

  it("names the host and holds address, codes and both keys with what each is for", () => {
    const t = de.getFixedT("de");
    const format = createFormatter({ ...defaultFormatSettings, language: "de", timeZone: "Europe/Vienna" });
    expect(emergencyKitFileName(t, KIT)).toBe("lunedo-notfall-kit-wiki.example.org-8443.txt");
    const text = emergencyKitText(t, format, KIT);
    expect(text).toContain("https://wiki.example.org:8443");
    expect(text).toContain("aaaa-1111-bbbb-2222\ncccc-3333-dddd-4444");
    expect(text).toMatch(/^LUNEDO_MASTER_KEYS=1:MDEy.*=$/m);
    expect(text).toMatch(/^LUNEDO_BACKUP_KEY=1:QUJD.*=$/m);
    expect(text).toContain("Wiederherstellungscodes des Owners");
    expect(text).toContain("Nötig, um eine Sicherung wiederherzustellen.");
  });
});

describe("KeyBackupStep", () => {
  it("keeps Continue usable and points to the download while the kit is not downloaded", async () => {
    mockApi({});
    const { onDone, result } = renderStep(false);
    await result;
    const next = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    await userEvent.click(next);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Download emergency kit" }));
    expect(screen.getByText(/Download the emergency kit first/)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("downloads one file, shows codes and keys, and lets the kit be copied and saved again", async () => {
    downloads.length = 0;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mockApi({ "POST /api/v1/setup/steps/keyBackup/download": () => ({ body: KIT }) });
    const { result } = renderStep(false);
    await result;
    await userEvent.click(screen.getByRole("button", { name: "Download emergency kit" }));
    const box = await screen.findByRole("figure", { name: "Lunedo emergency kit" });
    expect(box.textContent).toContain("aaaa-1111-bbbb-2222");
    expect(box.textContent).toContain("LUNEDO_BACKUP_KEY");
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.name).toBe("lunedo-emergency-kit-wiki.example.org-8443.txt");

    await userEvent.click(screen.getByRole("button", { name: "Copy emergency kit" }));
    expect(writeText).toHaveBeenCalledWith(downloads[0]?.text);
    await userEvent.click(screen.getByRole("button", { name: "Save again" }));
    expect(downloads).toHaveLength(2);
    expect(downloads[1]).toEqual(downloads[0]);
  });

  it("asks to confirm that the kit is stored before it continues", async () => {
    const { requests } = mockApi({ "POST /api/v1/setup/steps/keyBackup/confirm": () => ({ body: {} }) });
    const { onDone, result } = renderStep(true);
    await result;
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(document.activeElement).toBe(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/Confirm that you stored the emergency kit/)).toBeTruthy();
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(0);
    await userEvent.click(screen.getByRole("checkbox", { name: /I stored the emergency kit/ }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
