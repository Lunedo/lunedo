import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button.js";
import { ConfirmDialog, Dialog, Drawer } from "./dialog.js";
import { Input } from "./field.js";
import { renderUi } from "./testing/render.js";

function DialogProbe({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Invite people</Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          onOpenChange?.(next);
        }}
        title="Invite people"
        description="Invitations expire after 7 days."
        footer={<Button variant="primary">Send</Button>}
      >
        <Input aria-label="E-mail addresses" />
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("opens as a labelled modal from the keyboard, keeps focus inside and closes with Escape", async () => {
    const onOpenChange = vi.fn();
    renderUi(<DialogProbe onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole("button", { name: "Invite people" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "Invite people" });
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("closes through its labelled close button", async () => {
    renderUi(<DialogProbe />);
    await userEvent.click(screen.getByRole("button", { name: "Invite people" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

function ConfirmProbe({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [open, setOpen] = useState(true);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title="Remove Anna?"
      description="Anna loses access to Platform Team."
      confirmLabel="Remove"
      cancelLabel="Cancel"
      destructive
      onConfirm={onConfirm}
    />
  );
}

describe("ConfirmDialog", () => {
  it("stays open and busy while confirming, then closes", async () => {
    let finish: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    renderUi(<ConfirmProbe onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    const confirm = screen.getByRole("button", { name: /Remove/ });
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", true);
    finish();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("stays open when confirming fails", async () => {
    renderUi(<ConfirmProbe onConfirm={() => Promise.reject(new Error("forbidden"))} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Remove" }).hasAttribute("aria-busy")).toBe(false),
    );
    expect(screen.getByRole("dialog", { name: "Remove Anna?" })).toBeDefined();
  });
});

describe("Drawer", () => {
  it("opens from the side with a title", () => {
    renderUi(
      <Drawer open onOpenChange={() => {}} title="Navigation">
        <a href="/">Home</a>
      </Drawer>,
    );
    expect(screen.getByRole("dialog", { name: "Navigation" }).className).toContain("left-0");
  });
});
