import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MoreHorizontal, Trash } from "lucide-react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button, IconButton } from "./button.js";
import { CommandPalette } from "./command-palette.js";
import { SegmentedControl, Slider } from "./controls.js";
import { Menu, Popover, Tabs } from "./overlays.js";
import { renderUi } from "./testing/render.js";
import { useToast } from "./toast.js";

describe("Menu", () => {
  it("opens from the keyboard and runs the chosen item", async () => {
    const edit = vi.fn();
    const remove = vi.fn();
    renderUi(
      <Menu
        trigger={<IconButton label="Actions for Lena" icon={MoreHorizontal} tooltip={false} />}
        items={[
          { type: "label", label: "Lena Hofer" },
          { label: "Edit", onSelect: edit },
          { type: "separator" },
          { label: "Remove", icon: Trash, onSelect: remove, danger: true },
        ]}
      />,
    );
    screen.getByRole("button", { name: "Actions for Lena" }).focus();
    await userEvent.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    expect(menu).toBeDefined();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(edit).not.toHaveBeenCalled();
  });
});

describe("Popover", () => {
  it("shows its content when the trigger is used", async () => {
    renderUi(
      <Popover trigger={<Button>Details</Button>} label="Details">
        <p>Last synchronized 14 minutes ago.</p>
      </Popover>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(await screen.findByText("Last synchronized 14 minutes ago.")).toBeDefined();
  });
});

function TabsProbe() {
  const [value, setValue] = useState("all");
  return (
    <Tabs
      value={value}
      onValueChange={setValue}
      label="Member types"
      tabs={[
        { value: "all", label: "All", count: 7 },
        { value: "guests", label: "Guests", count: 1 },
      ]}
    >
      <p>Panel {value}</p>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("move with the arrow keys and show the active panel", async () => {
    renderUi(<TabsProbe />);
    expect(screen.getByRole("tablist", { name: "Member types" })).toBeDefined();
    screen.getByRole("tab", { name: /All/ }).focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Guests/ }).getAttribute("aria-selected")).toBe("true"),
    );
    expect(screen.getByRole("tabpanel").textContent).toBe("Panel guests");
  });
});

describe("CommandPalette", () => {
  it("selects the first entry when results arrive late, until the person moves with the arrows", async () => {
    const more = { id: "more", label: "Search all results", onSelect: () => {} };
    const hit = { id: "hit", label: "Restart the gateway", onSelect: () => {} };
    const palette = (items: { id: string; label: string; onSelect: () => void }[]) => (
      <CommandPalette
        open
        onOpenChange={() => {}}
        label="Search"
        placeholder="Search"
        emptyText="No results"
        filter={false}
        groups={[{ heading: "Results", items }]}
      />
    );
    const view = renderUi(palette([more]));
    await userEvent.type(screen.getByRole("combobox"), "gate");
    view.rerender(palette([hit, more]));
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Restart the gateway" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    await userEvent.keyboard("{ArrowDown}");
    view.rerender(palette([hit, { id: "other", label: "Network overview", onSelect: () => {} }, more]));
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Search all results" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
  });

  it("filters while typing and runs the selected entry", async () => {
    const members = vi.fn();
    const security = vi.fn();
    const onOpenChange = vi.fn();
    renderUi(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        label="Command palette"
        placeholder="Search or jump to"
        emptyText="No results"
        groups={[
          {
            heading: "Go to",
            items: [
              { id: "members", label: "Members", onSelect: members, shortcut: ["G", "M"] },
              { id: "security", label: "Security", onSelect: security, keywords: ["passkey"] },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeDefined();
    await userEvent.type(screen.getByRole("combobox"), "passkey");
    expect(screen.queryByRole("option", { name: /Members/ })).toBeNull();
    await userEvent.keyboard("{Enter}");
    expect(security).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(members).not.toHaveBeenCalled();
  });

  it("says when nothing matches", async () => {
    renderUi(
      <CommandPalette
        open
        onOpenChange={() => {}}
        label="Command palette"
        placeholder="Search"
        emptyText="No results"
        groups={[{ heading: "Go to", items: [{ id: "members", label: "Members", onSelect: () => {} }] }]}
      />,
    );
    await userEvent.type(screen.getByRole("combobox"), "zzz");
    expect(await screen.findByText("No results")).toBeDefined();
  });

  it("keeps the order of external results, moves with arrows and opens the selected entry in a new tab", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const newTab = vi.fn();
    renderUi(
      <CommandPalette
        open
        onOpenChange={() => {}}
        label="Search"
        placeholder="Search"
        emptyText="No results"
        filter={false}
        onOpenInNewTab={newTab}
        groups={[
          {
            heading: "Pages",
            items: [
              { id: "b", label: "Zebra", description: "Second line", href: "/b", onSelect: first },
              { id: "a", label: "Alpha", href: "/a", onSelect: second },
            ],
          },
        ]}
      />,
    );
    const list = screen.getByRole("listbox");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "ZebraSecond line",
      "Alpha",
    ]);
    await userEvent.type(screen.getByRole("combobox"), "x");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Zebra/ }).getAttribute("aria-selected")).toBe("true"),
    );
    await userEvent.keyboard("{ArrowDown}{Control>}{Enter}{/Control}");
    expect(newTab).toHaveBeenCalledWith(expect.objectContaining({ id: "a", href: "/a" }));
    expect(second).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(second).toHaveBeenCalledOnce();
    expect(list).toBeDefined();
  });
});

function ChoiceProbe() {
  const [mode, setMode] = useState("system");
  const [size, setSize] = useState(1);
  return (
    <>
      <SegmentedControl
        label="Color mode"
        value={mode}
        onValueChange={setMode}
        options={[
          { value: "system", label: "Automatic" },
          { value: "dark", label: "Dark" },
        ]}
      />
      <Slider
        label="Text size"
        value={size}
        onValueChange={setSize}
        steps={[0.875, 0.9375, 1, 1.125, 1.25]}
        formatValue={(value) => `${Math.round(value * 100)} %`}
      />
      <output>
        {mode} {size}
      </output>
    </>
  );
}

describe("SegmentedControl and Slider", () => {
  it("choose values with pointer and keyboard", async () => {
    renderUi(<ChoiceProbe />);
    expect(screen.getByRole("radiogroup", { name: "Color mode" })).toBeDefined();
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(screen.getByRole("radio", { name: "Dark" }).className).toContain("aria-checked:bg-accent");
    expect(screen.getByRole("radio", { name: "Dark" }).className).toContain("aria-checked:text-on-accent");
    const thumb = screen.getByRole("slider", { name: "Text size" });
    expect(thumb.getAttribute("aria-valuetext")).toBe("100 %");
    thumb.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("status").textContent).toBe("dark 1.125");
  });
});

function ToastProbe() {
  const { toast } = useToast();
  return <Button onClick={() => toast({ title: "Token created", variant: "success" })}>Create</Button>;
}

function FailureProbe({ retry }: { retry: () => void }) {
  const { toast } = useToast();
  return (
    <Button
      onClick={() =>
        toast({
          title: "The role was not saved",
          description: "Pagehall cannot be reached.",
          variant: "error",
          action: { label: "Retry", onSelect: retry },
        })
      }
    >
      Save
    </Button>
  );
}

describe("Toast", () => {
  it("offers a retry for a failure", async () => {
    const retry = vi.fn();
    renderUi(<FailureProbe retry={retry} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Pagehall cannot be reached.")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("shows a message", async () => {
    renderUi(<ToastProbe />);
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Token created")).toBeDefined();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeDefined();
  });
});

function UndoProbe({ onUndo }: { onUndo: () => void }) {
  const { toast } = useToast();
  return <Button onClick={() => toast({ title: "Rule removed", undo: { onUndo } })}>Remove</Button>;
}

describe("Undo toast", () => {
  it("offers undo with a visible countdown that pauses while hovered", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const onUndo = vi.fn();
      renderUi(<UndoProbe onUndo={onUndo} />);
      await userEvent.click(screen.getByRole("button", { name: "Remove" }));
      expect(await screen.findByText("10 s")).toBeDefined();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByText("7 s")).toBeDefined();
      await userEvent.hover(screen.getByText("Rule removed"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByText("7 s")).toBeDefined();
      await userEvent.click(screen.getByRole("button", { name: "Undo" }));
      expect(onUndo).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps errors until they are closed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderUi(<FailureProbe retry={() => {}} />);
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      await screen.findByText("Pagehall cannot be reached.");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(screen.getByText("Pagehall cannot be reached.")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SegmentedControl that does not fit", () => {
  it("becomes a select with every option", async () => {
    const scrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return this.className.includes("w-max") ? 420 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute("data-segmented") ? 300 : 0;
      },
    });
    try {
      renderUi(<ChoiceProbe />);
      expect(screen.queryByRole("radiogroup", { name: "Color mode" })).toBeNull();
      const select = screen.getByRole("combobox", { name: "Color mode" });
      expect(select.textContent).toContain("Automatic");
    } finally {
      if (scrollWidth) Object.defineProperty(HTMLElement.prototype, "scrollWidth", scrollWidth);
      if (clientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidth);
    }
  });
});
