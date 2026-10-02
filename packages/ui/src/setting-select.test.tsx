import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DurationSelect, SettingSelect } from "./setting-select.js";
import { renderUi } from "./testing/render.js";

const TIME_FORMATS = [
  { value: "24h", label: "24-hour", example: "14:30" },
  { value: "12h", label: "12-hour", example: "2:30 PM" },
];

describe("SettingSelect", () => {
  it("shows an inherited value muted and marks the default option once", async () => {
    const onValueChange = vi.fn();
    const onFollowDefault = vi.fn();
    renderUi(
      <SettingSelect
        aria-label="Time format"
        value="24h"
        inheritedValue="24h"
        inherited
        options={TIME_FORMATS}
        onValueChange={onValueChange}
        onFollowDefault={onFollowDefault}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Time format" });
    expect(select.textContent).toBe("24-hour (14:30)");
    expect(select.hasAttribute("data-muted")).toBe(true);
    await userEvent.click(select);
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "24-hour (14:30)Default",
      "12-hour (2:30 PM)",
    ]);
    await userEvent.click(screen.getByRole("option", { name: /^12-hour/ }));
    expect(onValueChange).toHaveBeenCalledWith("12h");
    expect(onFollowDefault).not.toHaveBeenCalled();
  });

  it("follows the default again when the marked option is chosen", async () => {
    const onValueChange = vi.fn();
    const onFollowDefault = vi.fn();
    renderUi(
      <SettingSelect
        aria-label="Time format"
        value="12h"
        inheritedValue="24h"
        inherited={false}
        options={TIME_FORMATS}
        onValueChange={onValueChange}
        onFollowDefault={onFollowDefault}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Time format" }).hasAttribute("data-muted")).toBe(false);
    await userEvent.click(screen.getByRole("combobox", { name: "Time format" }));
    await userEvent.click(screen.getByRole("option", { name: /^24-hour/ }));
    expect(onFollowDefault).toHaveBeenCalledOnce();
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe("DurationSelect", () => {
  it("offers the common values once, the default marked, and shows a custom value readably", async () => {
    const onValueChange = vi.fn();
    renderUi(
      <DurationSelect
        aria-label="Session length"
        value={7 * 1440}
        inheritedValue={14 * 1440}
        choices={[7 * 1440, 14 * 1440, 30 * 1440]}
        min={60}
        max={365 * 1440}
        locale="en"
        onValueChange={onValueChange}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Session length" });
    expect(select.textContent).toBe("7 days");
    await userEvent.click(select);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "7 days",
      "14 daysDefault",
      "30 days",
      "Custom…",
    ]);
    await userEvent.click(screen.getByRole("option", { name: "Custom…" }));
    const dialog = await screen.findByRole("dialog", { name: "Session length" });
    const amount = await waitFor(() => dialog.querySelector("input") as HTMLInputElement);
    await userEvent.clear(amount);
    await userEvent.type(amount, "500");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert").textContent).toBe("Choose a duration from 1 hour to 365 days.");
    await userEvent.clear(amount);
    await userEvent.type(amount, "45{Enter}");
    expect(onValueChange).toHaveBeenCalledWith(45 * 1440);
  });

  it("shows a stored custom value and an optional value for no limit", async () => {
    renderUi(
      <DurationSelect
        aria-label="Maximum lifetime"
        value={null}
        inheritedValue={null}
        inherited
        choices={[30 * 1440]}
        locale="en"
        noLimitLabel="No limit"
        onValueChange={() => {}}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Maximum lifetime" });
    expect(select.textContent).toBe("No limit");
    await userEvent.click(select);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "No limitDefault",
      "30 days",
      "Custom…",
    ]);
  });
});
