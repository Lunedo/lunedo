import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Stepper } from "./stepper.js";
import { renderUi } from "./testing/render.js";

const STEPS = [0.875, 0.9375, 1, 1.125, 1.25];

function TextSize({ initial = 1 }: { initial?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <Stepper
      label="Text size"
      value={value}
      onValueChange={setValue}
      steps={STEPS}
      defaultValue={1}
      formatValue={(size) => `${size * 100} %`}
    />
  );
}

describe("Stepper", () => {
  it("steps through the values and offers the default only when it differs", async () => {
    renderUi(<TextSize />);
    const group = screen.getByRole("group", { name: "Text size" });
    expect(group).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("100 %");
    expect(screen.queryByRole("button", { name: "Default" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Increase" }));
    await userEvent.click(screen.getByRole("button", { name: "Increase" }));
    expect(screen.getByRole("status").textContent).toBe("125 %");
    const increase = screen.getByRole("button", { name: "Increase" });
    expect(increase.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(increase);
    await userEvent.click(increase);
    expect(screen.getByRole("status").textContent).toBe("125 %");

    await userEvent.click(screen.getByRole("button", { name: "Default" }));
    expect(screen.getByRole("status").textContent).toBe("100 %");
    expect(screen.queryByRole("button", { name: "Default" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Decrease" }));
  });

  it("stops at the smallest value and works with the keyboard", async () => {
    renderUi(<TextSize initial={0.9375} />);
    screen.getByRole("button", { name: "Decrease" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("status").textContent).toBe("87.5 %");
    expect(screen.getByRole("button", { name: "Decrease" }).getAttribute("aria-disabled")).toBe("true");
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("status").textContent).toBe("87.5 %");
  });
});
