import { act, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatePicker, TimePicker } from "./date-picker.js";
import { Dialog } from "./dialog.js";
import { renderUi } from "./testing/render.js";

function Form() {
  const [date, setDate] = useState("2030-03-10");
  const [time, setTime] = useState("09:30");
  return (
    <Dialog open onOpenChange={() => {}} title="Series">
      <DatePicker
        value={date}
        onValueChange={setDate}
        formatDate={(day) => day.toISOString()}
        aria-label="First"
      />
      <TimePicker value={time} onValueChange={setTime} aria-label="Start time" />
    </Dialog>
  );
}

describe("date and time in a dialog", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps focus in the next field when it moved there before the date popover finished closing", () => {
    vi.useFakeTimers();
    renderUi(<Form />);
    act(() => {
      vi.runAllTimers();
    });
    fireEvent.click(screen.getByRole("button", { name: /^First: / }));
    act(() => {
      vi.runAllTimers();
    });
    const day = document.querySelector<HTMLElement>('[data-date="2030-03-14"]');
    if (!day) throw new Error("day not shown");
    fireEvent.click(day);
    const time = screen.getByRole("combobox", { name: "Start time" });
    act(() => time.focus());
    fireEvent.change(time, { target: { value: "14:00" } });
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(time);
    expect(screen.getByRole("option", { name: "14:00" })).toBeTruthy();
  });
});
