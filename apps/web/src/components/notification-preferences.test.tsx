import { cleanup, screen, within } from "@testing-library/react";
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
    stricterOnly: null,
    minimum: null,
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
  entry("notifications.mentions.push", true),
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

  it("show where each channel comes from and reset only the channel set here", async () => {
    const onChange = vi.fn(async () => undefined);
    await renderWithProviders(
      <NotificationPreferences
        settings={settings}
        loading={false}
        level="user"
        organizationName="Northwind"
        editable
        emailMethod="smtp"
        browserPush={false}
        onChange={onChange}
      />,
    );
    const table = screen.getByRole("list", { name: "Events" });
    const mentions = within(table).getByText("Mentions of me").closest("li") as HTMLElement;
    expect(within(mentions).queryByText(/Default/)).toBeNull();
    expect(within(mentions).queryByText("Own value")).toBeNull();
    expect(within(mentions).queryByRole("button", { name: /Reset/ })).toBeNull();
    expect(within(mentions).getByRole("combobox", { name: "Mentions of me: E-mail" }).textContent).toContain(
      "Off",
    );

    const changes = within(table).getByText("Changes to content I watch").closest("li") as HTMLElement;
    expect(within(changes).getAllByText("Own value")).toHaveLength(1);
    expect(within(changes).queryByText(/Default/)).toBeNull();
    expect(within(changes).getAllByRole("button", { name: /^Reset/ })).toHaveLength(1);
    expect(
      within(changes)
        .getByRole("switch", { name: "Changes to content I watch: In the app" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    await userEvent.click(
      within(changes).getByRole("button", {
        name: "Reset In the app for Changes to content I watch to the inherited value",
      }),
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
        browserPush={false}
        onChange={async () => undefined}
      />,
    );
    expect(screen.getByText("E-mail is not set up")).toBeTruthy();
    expect(screen.getByText(/Notifications stay in the app/)).toBeTruthy();
  });

  it("show the browser push column only while push is on for the instance", async () => {
    const onChange = vi.fn(async () => undefined);
    await renderWithProviders(
      <NotificationPreferences
        settings={settings}
        loading={false}
        level="user"
        editable
        emailMethod="smtp"
        browserPush={false}
        onChange={onChange}
      />,
    );
    expect(screen.queryByRole("switch", { name: "Mentions of me: Browser push" })).toBeNull();
    cleanup();

    await renderWithProviders(
      <NotificationPreferences
        settings={settings}
        loading={false}
        level="user"
        editable
        emailMethod="smtp"
        browserPush
        onChange={onChange}
      />,
    );
    const push = screen.getByRole("switch", { name: "Mentions of me: Browser push" });
    expect(push.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(push);
    expect(onChange).toHaveBeenCalledWith("notifications.mentions.push", false);
    expect(screen.queryByRole("switch", { name: "Changes to content I watch: Browser push" })).toBeNull();
  });
});
