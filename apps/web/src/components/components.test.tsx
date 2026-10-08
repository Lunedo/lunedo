import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../api/organization-queries.js";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { AccessImpact } from "./access-impact.js";
import { inheritedValue, SettingSource } from "./setting-source.js";
import { SettingsList } from "./settings-list.js";

function entry(patch: Partial<SettingEntry>): SettingEntry {
  return {
    key: "organizations.guestInactivityDays",
    value: 30,
    defaultValue: 30,
    source: "default",
    lockedBy: null,
    locked: false,
    lockable: true,
    levelsBelow: [],
    editable: true,
    levels: [
      { level: "instance", value: null, locked: false, effective: true },
      { level: "organization", value: null, locked: false, effective: true },
    ],
    ...patch,
  } as SettingEntry;
}

beforeEach(() => {
  mockApi({ "GET /api/v1/auth/session": () => problem(401, "notSignedIn") });
});

describe("AccessImpact", () => {
  it("names the people who gain access and counts the rest", async () => {
    const people = Array.from({ length: 11 }, (_, index) => `Person ${index + 1}`);
    await renderWithProviders(<AccessImpact change="gains" people={people} what="They join Engineering." />);
    expect(screen.getByText("Who gains access")).toBeTruthy();
    const list = screen.getByRole("list", { name: "People who gain access" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(9);
    expect(within(list).getByText("and 3 more people")).toBeTruthy();
  });

  it("speaks of everyone when a role goes to all members", async () => {
    await renderWithProviders(
      <AccessImpact
        change="loses"
        people={[]}
        everyone="All 40 members of Platform Team"
        what="They lose Editors."
      />,
      "de",
    );
    expect(screen.getByText("Wer Zugriff verliert")).toBeTruthy();
    expect(screen.getByText("All 40 members of Platform Team")).toBeTruthy();
    expect(screen.queryByText("Derzeit niemand.")).toBeNull();
  });
});

describe("SettingSource", () => {
  it("names the level a value is inherited from", async () => {
    const inherited = entry({
      source: "instance",
      value: 60,
      levels: [
        { level: "instance", value: 60, locked: false, effective: true },
        { level: "organization", value: null, locked: false, effective: true },
      ],
    });
    expect(inheritedValue(inherited, "organization")).toBe(60);
    await renderWithProviders(
      <SettingSource
        entry={inherited}
        level="organization"
        organizationName="Platform Team"
        formatValue={(value) => `${value} days`}
      />,
    );
    expect(screen.getByText("Instance default: 60 days")).toBeTruthy();
  });

  it("shows a lock from a higher level instead of the source", async () => {
    await renderWithProviders(
      <SettingSource
        entry={entry({ lockedBy: "instance", source: "instance" })}
        level="organization"
        formatValue={String}
      />,
    );
    expect(screen.getByText("Locked by the instance")).toBeTruthy();
  });

  it("marks values set at the current level", async () => {
    await renderWithProviders(
      <SettingSource
        entry={entry({ source: "organization", value: 14 })}
        level="organization"
        organizationName="Platform Team"
        formatValue={String}
      />,
    );
    expect(screen.getByText("Set for Platform Team")).toBeTruthy();
  });
});

describe("SettingsList", () => {
  function renderList(entries: SettingEntry[], onChange = vi.fn(async () => undefined), canManage = true) {
    return renderWithProviders(
      <PreferencesProvider>
        <SettingsList
          settings={entries}
          keys={entries.map((item) => item.key)}
          level="organization"
          organizationName="Platform Team"
          canManage={() => canManage}
          onChange={onChange}
        />
      </PreferencesProvider>,
    );
  }

  it("follows an inherited duration and overrides it from the common values", async () => {
    const onChange = vi.fn(async () => undefined);
    await renderList([entry({})], onChange);
    const select = screen.getByRole("combobox", { name: "Inactive guests" });
    expect(select.textContent).toContain("30 days");
    expect(select.hasAttribute("data-muted")).toBe(true);
    expect(screen.queryByRole("button", { name: "Override" })).toBeNull();
    await userEvent.click(select);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "30 daysDefault",
      "90 days",
      "180 days",
      "Custom…",
    ]);
    await userEvent.click(screen.getByRole("option", { name: "90 days" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("organizations.guestInactivityDays", { value: 90 }),
    );
  });

  it("sets a custom duration within the range of the setting", async () => {
    const onChange = vi.fn(async () => undefined);
    await renderList([entry({})], onChange);
    await userEvent.click(screen.getByRole("combobox", { name: "Inactive guests" }));
    await userEvent.click(screen.getByRole("option", { name: "Custom…" }));
    const dialog = await screen.findByRole("dialog", { name: "Inactive guests" });
    const amount = await waitFor(() => dialog.querySelector("input") as HTMLInputElement);
    await userEvent.clear(amount);
    await userEvent.type(amount, "500{Enter}");
    expect(screen.getByRole("alert").textContent).toBe("Choose a duration from 1 day to 365 days.");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.clear(amount);
    await userEvent.type(amount, "14{Enter}");
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("organizations.guestInactivityDays", { value: 14 }),
    );
  });

  it("shows minute settings readably and offers common values", async () => {
    const onChange = vi.fn(async () => undefined);
    await renderList(
      [
        entry({
          key: "auth.sessionLifetimeMinutes",
          value: 10_080,
          defaultValue: 10_080,
          source: "organization",
        }),
      ],
      onChange,
    );
    const select = screen.getByRole("combobox", { name: "Maximum session length" });
    expect(select.textContent).toContain("7 days");
    await userEvent.click(select);
    await userEvent.click(screen.getByRole("option", { name: "30 days" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("auth.sessionLifetimeMinutes", { value: 43_200 }),
    );
  });

  it("keeps the number of versions within the maximum of the instance", async () => {
    const onChange = vi.fn(async () => undefined);
    await renderList(
      [
        entry({
          key: "files.keepVersions",
          value: 50,
          defaultValue: 50,
          maximum: 500,
        } as Partial<SettingEntry>),
      ],
      onChange,
    );
    expect(screen.queryByRole("checkbox", { name: "No limit" })).toBeNull();
    const input = screen.getByRole("textbox", { name: "Versions of a file to keep" });
    await userEvent.type(input, "600{Enter}");
    expect(screen.getByRole("alert").textContent).toBe(
      "Enter a whole number from 1 to 500. The instance allows at most 500.",
    );
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, "120{Enter}");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("files.keepVersions", { value: 120 }));
  });

  it("offers no limit only when the instance allows it", async () => {
    const onChange = vi.fn(async () => undefined);
    await renderList(
      [
        entry({
          key: "files.keepVersions",
          value: 50,
          defaultValue: 50,
          maximum: "unlimited",
        } as Partial<SettingEntry>),
      ],
      onChange,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "No limit" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("files.keepVersions", { value: "unlimited" }));
  });

  it("names an unset maximum token lifetime", async () => {
    await renderList([entry({ key: "apiTokens.maxLifetimeDays", value: null, defaultValue: null })]);
    expect(screen.getByText("Default: No limit")).toBeTruthy();
  });

  it("lets a maximum token lifetime be set and removed", async () => {
    const onChange = vi.fn(async () => undefined);
    await renderList(
      [
        entry({
          key: "apiTokens.maxLifetimeDays",
          value: 90,
          defaultValue: null,
          source: "organization",
          levelsBelow: [],
          levels: [
            { level: "instance", value: null, locked: false, effective: true },
            { level: "organization", value: 90, locked: false, effective: true },
          ],
        }),
      ],
      onChange,
    );
    const select = screen.getByRole("combobox", { name: "Maximum lifetime of API tokens" });
    expect(select.textContent).toContain("90 days");
    await userEvent.click(select);
    await userEvent.click(screen.getByRole("option", { name: "365 days" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("apiTokens.maxLifetimeDays", { value: 365 }));
  });

  it("toggles booleans directly and offers a lock only when lower levels exist", async () => {
    const onChange = vi.fn(async () => undefined);
    await renderList(
      [
        entry({ key: "organizations.selfRegistration", value: false, defaultValue: false, levelsBelow: [] }),
        entry({ key: "locale.language", value: "en", defaultValue: "en", levelsBelow: ["user"] }),
      ],
      onChange,
    );
    await userEvent.click(screen.getByRole("switch", { name: "Self-registration" }));
    expect(onChange).toHaveBeenCalledWith("organizations.selfRegistration", { value: true });
    expect(await screen.findByText("Saved")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "More options for Self-registration" }));
    expect(screen.queryByRole("menuitem", { name: "Lock for members" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "More options for Language" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Lock for members" }));
    expect(onChange).not.toHaveBeenCalledWith("locale.language", { locked: true });
    const confirm = await screen.findByRole("dialog", { name: "Lock Language?" });
    expect(
      within(confirm).getByText(/All members of Platform Team will use English for Language/),
    ).toBeTruthy();
    await userEvent.click(within(confirm).getByRole("button", { name: "Lock for members" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("locale.language", { locked: true }));
  });

  it("saves a text setting when it loses focus and offers a retry when saving fails", async () => {
    let fail = true;
    const onChange = vi.fn(async (): Promise<undefined> => {
      if (fail) throw Object.assign(new Error("busy"), { code: "busy" });
      return undefined;
    });
    await renderList(
      [entry({ key: "instance.name", value: "Docs", defaultValue: "Pagehall", source: "organization" })],
      onChange,
    );
    const input = screen.getByRole("textbox", { name: "Instance name" });
    await userEvent.clear(input);
    await userEvent.type(input, "Handbook");
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledWith("instance.name", { value: "Handbook" });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/The server gave an unexpected answer/);
    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("explains every level of a setting", async () => {
    await renderList([
      entry({
        source: "organization",
        value: 14,
        levels: [
          { level: "instance", value: 60, locked: false, effective: true },
          { level: "organization", value: 14, locked: false, effective: true },
        ],
      }),
    ]);
    await userEvent.click(screen.getByRole("button", { name: "More options for Inactive guests" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Where does this value come from?" }));
    const dialog = screen.getByRole("dialog", { name: "Where Inactive guests comes from" });
    expect(within(dialog).getByText("60 days")).toBeTruthy();
    expect(within(dialog).getByText("14 days")).toBeTruthy();
    expect(within(dialog).getByText("The value 14 days comes from the organization.")).toBeTruthy();
  });

  it("says why a switch cannot be changed", async () => {
    await renderList(
      [
        entry({
          key: "organizations.selfRegistration",
          value: false,
          defaultValue: false,
          lockedBy: "instance",
          source: "instance",
        }),
      ],
      vi.fn(),
    );
    const locked = screen.getByRole("switch", { name: "Self-registration" });
    expect(locked.getAttribute("aria-disabled")).toBe("true");
    const description = document.getElementById(locked.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toBe("The instance locked this setting, so it cannot be changed here.");
  });

  it("names missing permissions as the reason a switch is disabled", async () => {
    await renderList(
      [entry({ key: "organizations.selfRegistration", value: false, defaultValue: false })],
      vi.fn(),
      false,
    );
    const toggle = screen.getByRole("switch", { name: "Self-registration" });
    const description = document.getElementById(toggle.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toBe("Your roles do not allow you to change this setting.");
  });

  it("only shows values to people who may not change them", async () => {
    await renderList([entry({})], vi.fn(), false);
    expect(screen.queryByRole("button", { name: "Override" })).toBeNull();
    expect((screen.getByRole("combobox", { name: "Inactive guests" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("marks the inherited option as the default and overrides it by choosing another", async () => {
    const onChange = vi.fn(async () => undefined);
    await renderList(
      [
        entry({
          key: "locale.timeFormat",
          value: "24h",
          defaultValue: "24h",
          source: "instance",
          levels: [
            { level: "instance", value: "24h", locked: false, effective: true },
            { level: "organization", value: null, locked: false, effective: true },
          ],
        }),
      ],
      onChange,
    );
    const select = screen.getByRole("combobox", { name: "Time format" });
    expect(select.textContent).toContain("24-hour");
    expect(select.hasAttribute("data-muted")).toBe(true);
    await userEvent.click(select);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "24-hour (14:30)Default",
      "12-hour (2:30 PM)",
    ]);
    await userEvent.click(screen.getByRole("option", { name: /^12-hour/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("locale.timeFormat", { value: "12h" }));
  });

  it("follows the default again when the marked option is chosen, and resets from the menu", async () => {
    const onChange = vi.fn(async () => undefined);
    await renderList(
      [
        entry({
          key: "locale.timeFormat",
          value: "12h",
          defaultValue: "24h",
          source: "organization",
          levels: [
            { level: "instance", value: "24h", locked: false, effective: true },
            { level: "organization", value: "12h", locked: false, effective: true },
          ],
        }),
      ],
      onChange,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Time format" }));
    await userEvent.click(screen.getByRole("option", { name: /^24-hour/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("locale.timeFormat", { clear: true }));
    onChange.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "More options for Time format" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Reset to default" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("locale.timeFormat", { clear: true }));
  });
});
