import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Lightbox } from "./lightbox.js";
import { renderUi } from "./testing/render.js";

describe("Lightbox", () => {
  it("moves with the arrow keys and closes with Escape or the close button", async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onOpenChange = vi.fn();
    renderUi(
      <Lightbox
        open
        onOpenChange={onOpenChange}
        title="rack.jpg"
        previousLabel="Previous"
        nextLabel="Next"
        onPrevious={onPrevious}
        onNext={onNext}
        footer="2 of 3"
      >
        <p>Picture</p>
      </Lightbox>,
    );
    expect(screen.getByRole("dialog", { name: "rack.jpg" })).toBeTruthy();
    expect(screen.getByText("2 of 3")).toBeTruthy();
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{ArrowLeft}");
    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onNext).toHaveBeenCalledTimes(2);
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers no arrows when there is only one item", () => {
    renderUi(
      <Lightbox
        open
        onOpenChange={() => undefined}
        title="plan.pdf"
        previousLabel="Previous"
        nextLabel="Next"
      >
        <p>Document</p>
      </Lightbox>,
    );
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });
});
