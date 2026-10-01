import { screen, waitFor } from "@testing-library/react";
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

describe("Toast", () => {
  it("shows a message", async () => {
    renderUi(<ToastProbe />);
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Token created")).toBeDefined();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeDefined();
  });
});
