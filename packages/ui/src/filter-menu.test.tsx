import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FilterMenu } from "./filter-menu.js";
import { renderUi } from "./testing/render.js";

const options = [
  { value: "", label: "All" },
  { value: "it", label: "IT Operations", count: 3 },
  { value: "hr", label: "People", count: 0 },
];

describe("FilterMenu", () => {
  it("shows the chosen value on the chip and marks a filter that is set", () => {
    renderUi(
      <>
        <FilterMenu label="Space" value="" options={options} onValueChange={() => {}} />
        <FilterMenu label="Area" value="it" options={options} onValueChange={() => {}} />
      </>,
    );
    expect(screen.getByRole("button", { name: "Space: All" }).hasAttribute("data-filter-active")).toBe(false);
    expect(
      screen.getByRole("button", { name: "Area: IT Operations" }).hasAttribute("data-filter-active"),
    ).toBe(true);
  });

  it("lists the options with their counts and picks one by keyboard", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    renderUi(<FilterMenu label="Space" value="" options={options} onValueChange={change} />);
    await user.click(screen.getByRole("button", { name: "Space: All" }));
    const choice = screen.getByRole("button", { name: /IT Operations/ });
    expect(choice.textContent).toContain("3");
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    screen.getByRole("button", { name: "All" }).focus();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(change).toHaveBeenCalledWith("it");
  });

  it("searches when the options come from a search", async () => {
    const user = userEvent.setup();
    const search = vi.fn();
    renderUi(
      <FilterMenu
        label="Assigned by"
        value=""
        options={[]}
        onValueChange={() => {}}
        search={{ value: "", onChange: search, placeholder: "Search people" }}
        emptyText="Nobody found"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Assigned by" }));
    await user.type(screen.getByRole("searchbox", { name: "Search people" }), "L");
    expect(search).toHaveBeenCalledWith("L");
    expect(screen.getByText("Nobody found")).toBeTruthy();
  });

  it("toggles several values without closing and shows how many are chosen", async () => {
    const user = userEvent.setup();
    const toggle = vi.fn();
    renderUi(
      <FilterMenu
        multiple
        label="Space"
        selected={["it", "hr"]}
        onToggle={toggle}
        options={[
          { value: "it", label: "IT Operations", group: "Spaces" },
          { value: "hr", label: "People", group: "Spaces" },
          { value: "archived", label: "Include archived", group: "Options" },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Space: 2" }));
    expect(screen.getByText("Options")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "People" }));
    expect(toggle).toHaveBeenCalledWith("hr", false);
    await user.click(screen.getByRole("button", { name: "Include archived" }));
    expect(toggle).toHaveBeenCalledWith("archived", true);
  });
});
