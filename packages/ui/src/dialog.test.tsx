import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button.js";
import { ConfirmDialog, Dialog, Drawer } from "./dialog.js";
import { Input } from "./field.js";
import { Menu } from "./overlays.js";
import { focusWhenShown, useOpener } from "./return-focus.js";
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
  it("returns the focus to the element that opened it", async () => {
    renderUi(<DialogProbe />);
    const trigger = screen.getByRole("button", { name: "Invite people" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Invite people" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

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

describe("ConfirmDialog for an irreversible action", () => {
  it("requires the name to be typed, marks a mismatch and moves focus to it", async () => {
    const onConfirm = vi.fn();
    renderUi(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete Editors?"
        confirmLabel="Delete group"
        cancelLabel="Keep group"
        destructive
        typedConfirmation={{
          value: "Editors",
          label: "Type Editors to confirm",
          mismatch: "Type the name exactly as shown.",
        }}
        onConfirm={onConfirm}
      />,
    );
    const buttons = within(screen.getByRole("dialog")).getAllByRole("button", { name: /group/ });
    expect(buttons.map((button) => button.textContent)).toEqual(["Delete group", "Keep group"]);
    await userEvent.click(screen.getByRole("button", { name: "Delete group" }));
    expect(onConfirm).not.toHaveBeenCalled();
    const input = screen.getByLabelText("Type Editors to confirm");
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Type the name exactly as shown.")).toBeDefined();
    await userEvent.type(input, "Editors");
    await userEvent.click(screen.getByRole("button", { name: "Delete group" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe("dialog width", () => {
  it("lets the dialog shrink below its content on narrow screens", () => {
    renderUi(
      <Dialog open onOpenChange={() => undefined} title="Create role">
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Create role" }).className).toContain("min-w-0");
  });
});

describe("initial focus", () => {
  const closeButton = () => screen.getByRole("button", { name: "Close" });

  it("goes to the first field and never to the close button", async () => {
    renderUi(
      <Dialog
        open
        onOpenChange={() => undefined}
        title="Add a running topic"
        footer={<Button>Add topic</Button>}
      >
        <Input aria-label="Title" />
        <Input aria-label="Notes" />
      </Dialog>,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Title")));
    expect(document.activeElement).not.toBe(closeButton());
  });

  it("goes to the first control of the content when there is no field", async () => {
    renderUi(
      <Dialog open onOpenChange={() => undefined} title="Restore version 1?">
        <Button>Keep current page</Button>
        <Button>Restore version 1</Button>
      </Dialog>,
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep current page" })),
    );
  });

  it("goes to the dialog itself when it holds nothing to operate", async () => {
    renderUi(
      <Dialog open onOpenChange={() => undefined} title="Notice">
        <p>Nothing to do here.</p>
      </Dialog>,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "Notice" })));
    expect(document.activeElement).not.toBe(closeButton());
  });

  it("goes to the safe action of a destructive confirmation and to the field of a typed one", async () => {
    const { unmount } = renderUi(
      <ConfirmDialog
        open
        onOpenChange={() => undefined}
        title="Remove Anna?"
        confirmLabel="Remove"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => undefined}
      />,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" })));
    unmount();
    renderUi(
      <ConfirmDialog
        open
        onOpenChange={() => undefined}
        title="Delete Editors?"
        confirmLabel="Delete group"
        cancelLabel="Keep group"
        destructive
        typedConfirmation={{ value: "Editors", label: "Type Editors", mismatch: "No match." }}
        onConfirm={() => undefined}
      />,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Type Editors")));
  });

  it("goes into the content of a drawer instead of its close button", async () => {
    renderUi(
      <Drawer open onOpenChange={() => undefined} title="Preview" side="right" size="panel">
        <a href="/file">Download</a>
      </Drawer>,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("link", { name: "Download" })));
  });
});

describe("returning focus", () => {
  function MenuProbe({ onOpened }: { onOpened?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Menu
          trigger={<Button>More actions</Button>}
          items={[
            {
              label: "Move…",
              onSelect: () => {
                setOpen(true);
                onOpened?.();
              },
            },
          ]}
        />
        <Dialog open={open} onOpenChange={setOpen} title="Move page">
          <Input aria-label="Place below" />
        </Dialog>
      </>
    );
  }

  it("goes back to the menu button when the dialog was opened from a menu", async () => {
    renderUi(<MenuProbe />);
    const trigger = screen.getByRole("button", { name: "More actions" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Move…" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Place below")));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("goes to the main heading when the opening element no longer exists", async () => {
    function Probe() {
      const [open, setOpen] = useState(false);
      const [gone, setGone] = useState(false);
      return (
        <main>
          <h1>Platform Team</h1>
          {gone ? null : <Button onClick={() => setOpen(true)}>Move to trash</Button>}
          <Dialog open={open} onOpenChange={setOpen} title="Move to trash?">
            <Button
              onClick={() => {
                setGone(true);
                setOpen(false);
              }}
            >
              Confirm
            </Button>
          </Dialog>
        </main>
      );
    }
    renderUi(<Probe />);
    await userEvent.click(screen.getByRole("button", { name: "Move to trash" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Platform Team" })),
    );
  });
});

describe("returning focus from panels and replaced controls", () => {
  function PanelProbe() {
    const [open, setOpen] = useState(false);
    return (
      <main>
        <h1>For you</h1>
        <Button onClick={() => setOpen(true)}>Notifications</Button>
        {open ? <Panel onClose={() => setOpen(false)} /> : null}
      </main>
    );
  }

  function Panel({ onClose }: { onClose: () => void }) {
    const restore = useOpener();
    return (
      <aside>
        <Button
          onClick={() => {
            onClose();
            restore();
          }}
        >
          Close notifications
        </Button>
      </aside>
    );
  }

  it("goes back to the element that opened a panel", async () => {
    renderUi(<PanelProbe />);
    const bell = screen.getByRole("button", { name: "Notifications" });
    await userEvent.click(bell);
    await userEvent.click(screen.getByRole("button", { name: "Close notifications" }));
    expect(document.activeElement).toBe(bell);
  });

  it("goes to a control once it is shown in place of the one that was used", async () => {
    function Probe() {
      const [saved, setSaved] = useState(false);
      return saved ? (
        <Button key="saved">Save changes</Button>
      ) : (
        <Button
          key="new"
          onClick={() => {
            setSaved(true);
            focusWhenShown(() => screen.queryByRole("button", { name: "Save changes" }));
          }}
        >
          Show banner
        </Button>
      );
    }
    renderUi(<Probe />);
    await userEvent.click(screen.getByRole("button", { name: "Show banner" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save changes" })),
    );
  });
});
