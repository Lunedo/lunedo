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

  it("overrides an inherited number and saves it", async () => {
    const onChange = vi.fn(async () => undefined);
    await renderList([entry({})], onChange);
    expect(screen.getByText("Inactive guests")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Override" }));
    const input = screen.getByRole("textbox", { name: "Inactive guests" });
    await userEvent.clear(input);
    await userEvent.type(input, "500");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter a whole number from 1 to 365.");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, "14");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("organizations.guestInactivityDays", { value: 14 }),
    );
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

    await userEvent.click(screen.getByRole("button", { name: "More options for Self-registration" }));
    expect(screen.queryByRole("menuitem", { name: "Lock for members" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "More options for Language" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Lock for members" }));
    expect(onChange).toHaveBeenCalledWith("locale.language", { locked: true });
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

  it("only shows values to people who may not change them", async () => {
    await renderList([entry({})], vi.fn(), false);
    expect(screen.queryByRole("button", { name: "Override" })).toBeNull();
    expect(screen.getByText("30 days")).toBeTruthy();
  });
});
