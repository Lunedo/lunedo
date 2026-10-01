import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Plus } from "lucide-react";
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
    expect(screen.getByRole("button", { name: "Cancel" }).className).toContain("bg-transparent");
    expect(screen.getByRole("button", { name: "Copy link" }).className).toContain("border-border");
  });

  it("is a non-submitting button unless asked otherwise", () => {
    renderUi(<Button>Plain</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });

  it("disables itself and announces loading", async () => {
    const onClick = vi.fn();
    renderUi(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: /Save/ });
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.textContent).toContain("Loading");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
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
});
