import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DatePicker, monthGrid, parseIsoDate, timeOptions } from "./date-picker.js";
import { Field } from "./field.js";
import { renderUi } from "./testing/render.js";

const format = (date: Date) => date.toISOString().slice(0, 10).split("-").reverse().join(".");

describe("DatePicker", () => {
  it("starts the weeks on the chosen day", () => {
    const october = parseIsoDate("2026-10-01");
    if (!october) throw new Error("invalid date");
    expect(monthGrid(october, "monday")[0]?.toISOString().slice(0, 10)).toBe("2026-09-28");
    expect(monthGrid(october, "sunday")[0]?.toISOString().slice(0, 10)).toBe("2026-09-27");
  });

  it("shows the date in the given format and picks a day with the keyboard", async () => {
    const change = vi.fn();
    renderUi(
      <DatePicker
        value="2026-10-14"
        onValueChange={change}
        formatDate={format}
        locale="en"
        aria-label="From"
      />,
    );
    const trigger = screen.getByRole("button", { name: "From: 14.10.2026" });
    expect(trigger.textContent).toContain("14.10.2026");
    await userEvent.click(trigger);
    expect(screen.getByRole("table", { name: "October 2026" })).toBeTruthy();
    expect(document.activeElement?.getAttribute("data-date")).toBe("2026-10-14");
    await userEvent.keyboard("{ArrowRight}{ArrowDown}{Enter}");
    expect(change).toHaveBeenCalledWith("2026-10-22");
  });

  it("keeps the field label on the button without attributes a button may not carry", () => {
    renderUi(
      <Field label="Publish on" required>
        <DatePicker value="" onValueChange={() => {}} formatDate={format} locale="en" />
      </Field>,
    );
    const trigger = screen.getByRole("button", { name: /Publish on/ });
    expect(trigger.hasAttribute("aria-required")).toBe(false);
  });

  it("moves between months and keeps days outside the allowed range unavailable", async () => {
    const change = vi.fn();
    renderUi(
      <DatePicker
        value="2026-10-14"
        onValueChange={change}
        formatDate={format}
        locale="en"
        min="2026-10-10"
        clearable
        aria-label="Until"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Until: 14.10.2026" }));
    const before = document.querySelector<HTMLButtonElement>('[data-date="2026-10-09"]');
    expect(before?.disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("table", { name: "November 2026" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(change).toHaveBeenCalledWith("");
  });

  it("offers times in steps of a quarter of an hour in the chosen clock", () => {
    expect(timeOptions("en", false).slice(0, 2)).toEqual([
      { value: "00:00", label: "00:00" },
      { value: "00:15", label: "00:15" },
    ]);
    expect(timeOptions("en", true).find((option) => option.value === "14:30")?.label).toBe("2:30 PM");
  });
});
