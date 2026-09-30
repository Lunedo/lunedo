import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Rail, RailButton } from "./rail.js";

describe("Rail", () => {
  it("renders a labelled navigation with accessible buttons", async () => {
    const onClick = vi.fn();
    render(
      <Rail label="Main" logo={<span>logo</span>} footer={<RailButton label="Settings" icon="S" />}>
        <RailButton label="Create" icon="+" variant="primary" onClick={onClick} />
        <RailButton label="Search" icon="Q" current />
      </Rail>,
    );

    expect(screen.getByRole("navigation", { name: "Main" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Search" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Settings" }).getAttribute("aria-current")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("uses only theme classes for the primary variant", () => {
    render(<RailButton label="Create" icon="+" variant="primary" />);
    const className = screen.getByRole("button").className;
    expect(className).toContain("bg-accent");
    expect(className).not.toMatch(/#|rgb|\[/);
  });
});
