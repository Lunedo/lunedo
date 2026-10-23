import { Bell } from "lucide-react";
import { describe, expect, it } from "vitest";
import { settingsArea } from "./settings-layout.js";
import { currentEntry, groupEntries, type SettingsEntry } from "./settings-shell.js";

const entry = (id: string, href: string, group?: string): SettingsEntry => ({
  id,
  label: id,
  icon: Bell,
  href,
  ...(group ? { group } : {}),
});

describe("the settings navigation", () => {
  const entries = [
    entry("notifications", "/settings/notifications"),
    entry("watching", "/settings/notifications/watching"),
    entry("groups", "/settings/organizations/o/groups", "People"),
    entry("general", "/settings/organizations/o/general"),
    entry("roles", "/settings/organizations/o/roles", "People"),
    entry("audit", "/settings/organizations/o/audit-log", "Log"),
  ];

  it("keeps the parent entry active on a detail page and prefers the closest entry", () => {
    expect(currentEntry(entries, "/settings/organizations/o/groups/g1")?.id).toBe("groups");
    expect(currentEntry(entries, "/settings/notifications/watching")?.id).toBe("watching");
    expect(currentEntry(entries, "/settings/notifications/")?.id).toBe("notifications");
    expect(currentEntry(entries, "/settings/notificationsx")).toBeUndefined();
  });

  it("puts entries without a group first and keeps the order of the groups", () => {
    expect(groupEntries(entries).map((group) => [group.label, group.entries.map((item) => item.id)])).toEqual(
      [
        [undefined, ["notifications", "watching", "general"]],
        ["People", ["groups", "roles"]],
        ["Log", ["audit"]],
      ],
    );
  });

  it("tells the area from the address", () => {
    expect(settingsArea("/settings/preferences")).toBe("account");
    expect(settingsArea("/settings/organizations/o/members")).toBe("organization");
    expect(settingsArea("/settings/instance/general")).toBe("instance");
    expect(settingsArea("/settings/instances")).toBe("account");
  });
});
