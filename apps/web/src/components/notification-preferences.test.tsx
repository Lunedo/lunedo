import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../api/organization-queries.js";
import { renderWithProviders } from "../testing/render.js";
import { NotificationPreferences, notificationRows } from "./notification-preferences.js";

function entry(
  key: string,
  defaultValue: unknown,
  values: { organization?: unknown; user?: unknown } = {},
): SettingEntry {
  const levels = [
    { level: "instance" as const, value: null, locked: false, effective: true },
    { level: "organization" as const, value: values.organization ?? null, locked: false, effective: true },
    { level: "user" as const, value: values.user ?? null, locked: false, effective: true },
  ];
  const source =
    values.user !== undefined ? "user" : values.organization !== undefined ? "organization" : "default";
  return {
    key,
    value: values.user ?? values.organization ?? defaultValue,
    defaultValue,
    source,
    lockedBy: null,
    locked: false,
    lockable: true,
    levelsBelow: [],
    editable: true,
    maximum: null,
    levels,
  } as SettingEntry;
}

const settings = [
  entry("notifications.mentions.inApp", true),
  entry("notifications.mentions.email", "immediately", { organization: "off" }),
  entry("notifications.changes.inApp", true, { user: false }),
  entry("notifications.changes.email", "off"),
  entry("notifications.apiTokenExpiring.inApp", true),
  entry("notifications.apiTokenExpiring.email", "immediately"),
];

describe("notification preferences", () => {
  it("group events by task and keep administration events apart", () => {
    expect(notificationRows(settings, "content").map((row) => row.event.id)).toEqual(["mentions", "changes"]);
    expect(notificationRows(settings, "administration").map((row) => row.event.id)).toEqual([
      "apiTokenExpiring",
    ]);
  });

  it("show where each row comes from and reset only the person's own values", async () => {
    const onChange = vi.fn(async () => undefined);
    await renderWithProviders(
      <NotificationPreferences
        settings={settings}
        loading={false}
        level="user"
        organizationName="Northwind"
        editable
        emailMethod="smtp"
        onChange={onChange}
      />,
    );
    const table = screen.getByRole("table", { name: "Events" });
    const mentions = within(table).getByText("Mentions of me").closest("tr") as HTMLElement;
    expect(within(mentions).getByText("Default of Northwind")).toBeTruthy();
    expect(within(mentions).queryByRole("button", { name: /Reset/ })).toBeNull();
    expect(within(mentions).getByRole("combobox", { name: "Mentions of me: E-mail" }).textContent).toContain(
      "Off",
    );

    const changes = within(table).getByText("Changes to content I watch").closest("tr") as HTMLElement;
    expect(within(changes).getByText("Set by you")).toBeTruthy();
    expect(
      within(changes)
        .getByRole("switch", { name: "Changes to content I watch: In the app" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    await userEvent.click(
      within(changes).getByRole("button", { name: "Reset Changes to content I watch to the default" }),
    );
    expect(onChange).toHaveBeenCalledWith("notifications.changes.inApp", undefined);
    expect(onChange).not.toHaveBeenCalledWith("notifications.changes.email", undefined);

    await userEvent.click(within(mentions).getByRole("switch", { name: "Mentions of me: In the app" }));
    expect(onChange).toHaveBeenCalledWith("notifications.mentions.inApp", false);
    expect(screen.queryByText("E-mail is not set up")).toBeNull();
  });

  it("say that e-mail waits for a mail server", async () => {
    await renderWithProviders(
      <NotificationPreferences
        settings={settings}
        loading={false}
        level="user"
        editable
        emailMethod={null}
        onChange={async () => undefined}
      />,
    );
    expect(screen.getByText("E-mail is not set up")).toBeTruthy();
    expect(screen.getByText(/Notifications stay in the app/)).toBeTruthy();
  });
});
