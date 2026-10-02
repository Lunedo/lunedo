import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { formatDuration, joinDuration, splitDuration } from "./duration.js";
import { DurationInput, isDurationWithin } from "./duration-input.js";
import { Field } from "./field.js";
import { UiProvider } from "./labels.js";
import { renderUi, testLabels } from "./testing/render.js";

describe("duration helpers", () => {
  it("split minutes into the largest unit that fits exactly", () => {
    expect(splitDuration(43200)).toEqual({ amount: 30, unit: "days" });
    expect(splitDuration(720)).toEqual({ amount: 12, unit: "hours" });
    expect(splitDuration(90)).toEqual({ amount: 90, unit: "minutes" });
    expect(splitDuration(90, ["hours", "days"])).toEqual({ amount: 2, unit: "hours" });
    expect(joinDuration({ amount: 7, unit: "days" })).toBe(10080);
  });

  it("format durations readably in the given language", () => {
    expect(formatDuration(43200, "en")).toBe("30 days");
    expect(formatDuration(43200, "de")).toBe("30 Tage");
    expect(formatDuration(1, "en")).toBe("1 minute");
    expect(formatDuration(1530, "en")).toBe("1 day, 1 hour, 30 minutes");
    expect(formatDuration(0, "en")).toBe("0 minutes");
  });

  it("check a range", () => {
    expect(isDurationWithin(60, 1, 120)).toBe(true);
    expect(isDurationWithin(200, 1, 120)).toBe(false);
    expect(isDurationWithin(null, 1, 120)).toBe(false);
  });
});

describe("DurationInput", () => {
  it("shows the value in a readable unit and commits on blur and Enter", async () => {
    const onCommit = vi.fn();
    const onValueChange = vi.fn();
    renderUi(
      <Field label="Session length">
        <DurationInput value={43200} onValueChange={onValueChange} onCommit={onCommit} locale="en" />
      </Field>,
    );
    const input = screen.getByLabelText("Session length") as HTMLInputElement;
    expect(input.value).toBe("30");
    expect(screen.getByRole("combobox", { name: "Unit" }).textContent).toContain("Days");

    await userEvent.clear(input);
    await userEvent.type(input, "7");
    expect(onValueChange).toHaveBeenLastCalledWith(10080);
    expect(onCommit).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(onCommit).toHaveBeenLastCalledWith(10080);
    await userEvent.tab();
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it("offers quick choices and marks the current one", async () => {
    const onCommit = vi.fn();
    renderUi(
      <DurationInput
        aria-label="Lifetime"
        value={1440}
        onCommit={onCommit}
        quickChoices={[1440, 10080, 43200]}
        units={["days"]}
        locale="en"
      />,
    );
    expect(screen.getByRole("button", { name: "1 day" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Days")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "30 days" }));
    expect(onCommit).toHaveBeenLastCalledWith(43200);
    expect((screen.getByRole("textbox", { name: "Lifetime" }) as HTMLInputElement).value).toBe("30");
    expect(screen.getByRole("button", { name: "30 days" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("marks values outside the range and text that is not a whole number as invalid", async () => {
    const onValueChange = vi.fn();
    renderUi(
      <DurationInput
        aria-label="Lifetime"
        value={60}
        onValueChange={onValueChange}
        min={5}
        max={120}
        units={["minutes"]}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Lifetime" });
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    await userEvent.clear(input);
    await userEvent.type(input, "500");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    await userEvent.clear(input);
    await userEvent.type(input, "1.5");
    expect(onValueChange).toHaveBeenLastCalledWith(null);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("follows a new value from outside", () => {
    const { rerender } = renderUi(<DurationInput aria-label="Lifetime" value={60} />);
    rerender(
      <UiProvider labels={testLabels}>
        <DurationInput aria-label="Lifetime" value={1440} />
      </UiProvider>,
    );
    expect((screen.getByRole("textbox", { name: "Lifetime" }) as HTMLInputElement).value).toBe("1");
  });
});
