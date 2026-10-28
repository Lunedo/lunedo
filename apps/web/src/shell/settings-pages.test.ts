import { describe, expect, it } from "vitest";
import "./builtin.js";
import { navigationItems } from "./extensions.js";
import { settingsPage, settingsPages } from "./settings-pages.js";

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

describe("settingsPages", () => {
  it("is what the settings navigation registers", () => {
    const registered = navigationItems
      .list()
      .map(({ id, order, section, labelKey, groupKey }) => ({
        id,
        order,
        section,
        labelKey,
        ...(groupKey ? { groupKey } : {}),
      }))
      .sort(byId);
    expect(registered).toEqual([...settingsPages].sort(byId));
  });

  it("has unique IDs and refuses unknown ones", () => {
    expect(new Set(settingsPages.map((page) => page.id)).size).toBe(settingsPages.length);
    expect(settingsPage("instance.general").labelKey).toBe("navigation.general");
    expect(() => settingsPage("instance.unknown")).toThrow("Unknown settings page instance.unknown");
  });
});
