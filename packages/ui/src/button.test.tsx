import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MoreHorizontal, Plus } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { Button, ButtonGroup, IconButton } from "./button.js";
import { renderUi } from "./testing/render.js";

describe("Button", () => {
  it("fills only the primary variant", () => {
    renderUi(
      <>
        <Button variant="primary">Save</Button>
        <Button>Cancel</Button>
        <Button variant="outline">Copy link</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Save" }).className).toContain("bg-accent");
    for (const name of ["Cancel", "Copy link"]) {
      const className = screen.getByRole("button", { name }).className;
      expect(className, name).not.toContain("bg-accent");
      expect(className, name).toContain("border-control-border");
    }
    expect(screen.getByRole("button", { name: "Cancel" }).className).toContain("bg-control");
  });

  it("gives icon buttons a visible boundary on hover and focus", () => {
    renderUi(<IconButton label="More" icon={MoreHorizontal} />);
    const className = screen.getByRole("button", { name: "More" }).className;
    expect(className).toContain("hover:border-control-border");
    expect(className).toContain("focus-visible:border-control-border");
    expect(className).toContain("text-text-muted");
  });

  it("is a non-submitting button unless asked otherwise", () => {
    renderUi(<Button>Plain</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });

  it("stays focusable while busy, announces loading and ignores clicks", async () => {
    const onClick = vi.fn();
    renderUi(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: /Save/ });
    expect(button).toHaveProperty("disabled", false);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.textContent).toContain("Loading");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("marks the disabled state with fill and cursor instead of opacity", () => {
    renderUi(<Button disabled>Give role</Button>);
    const className = screen.getByRole("button", { name: "Give role" }).className;
    expect(className).toContain("disabled:bg-surface-sunken");
    expect(className).toContain("disabled:cursor-not-allowed");
    expect(className).not.toContain("opacity-60");
  });

  it("renders a link through asChild", () => {
    renderUi(
      <Button asChild variant="primary">
        <a href="/members">Members</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Members" });
    expect(link.className).toContain("bg-accent");
  });

  it("groups related actions in a labelled group", () => {
    renderUi(
      <ButtonGroup label="Sharing">
        <Button>Share</Button>
        <Button>Copy link</Button>
      </ButtonGroup>,
    );
    expect(screen.getByRole("group", { name: "Sharing" })).toBeDefined();
  });
});

describe("IconButton", () => {
  it("has an accessible name and shows a badge", async () => {
    const onClick = vi.fn();
    renderUi(<IconButton label="Create" icon={Plus} badge={3} onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Create" });
    expect(button.textContent).toBe("3");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("extends its hit area to the minimum target size", () => {
    renderUi(<IconButton label="More" icon={MoreHorizontal} size="sm" />);
    expect(screen.getByRole("button", { name: "More" }).className).toContain("after:size-hit");
  });
});
