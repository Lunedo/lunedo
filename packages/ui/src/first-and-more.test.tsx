import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FirstAndMore } from "./first-and-more.js";
import { renderUi } from "./testing/render.js";

const values = [
  { id: "a", label: "Nordwind Logistik", icon: <span data-testid="home" /> },
  { id: "b", label: "Second" },
  { id: "c", label: "Third" },
];

describe("FirstAndMore", () => {
  it("shows the first value with its icon and the rest behind +n in a popover", async () => {
    const rowClick = vi.fn();
    renderUi(
      // biome-ignore lint/a11y/noStaticElementInteractions: the row of a table stands for a clickable row
      <div onClick={rowClick} onKeyDown={rowClick}>
        <FirstAndMore
          values={values}
          title="Organizations of Max"
          moreLabel={(count) => `Show ${count} more`}
        />
      </div>,
    );
    expect(screen.getByText("Nordwind Logistik")).toBeTruthy();
    expect(screen.getByTestId("home")).toBeTruthy();
    expect(screen.queryByText("Second")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    const popover = await screen.findByRole("dialog", { name: "Organizations of Max" });
    expect(within(popover).getByText("Second")).toBeTruthy();
    expect(within(popover).getByText("Third")).toBeTruthy();
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("shows only the value without +n, and the empty content without values", () => {
    const { rerender } = renderUi(
      <FirstAndMore values={values.slice(0, 1)} title="Groups" moreLabel={() => "more"} />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<FirstAndMore values={[]} title="Groups" moreLabel={() => "more"} empty={<span>None</span>} />);
    expect(screen.getByText("None")).toBeTruthy();
  });
});
