import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select } from "./controls.js";
import { Sidebar, SidebarGroup, SidebarItem } from "./sidebar.js";
import { renderUi } from "./testing/render.js";
import { TruncatedText } from "./truncated-text.js";

function overflow(width: number) {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TruncatedText", () => {
  it("shows the full text in a tooltip when it is cut off", async () => {
    overflow(180);
    renderUi(<TruncatedText text="Benachrichtigungseinstellungen der Organisation" />);
    await userEvent.hover(screen.getByText("Benachrichtigungseinstellungen der Organisation"));
    expect(await screen.findByRole("tooltip")).toBeTruthy();
  });

  it("adds no tooltip when the text fits", async () => {
    overflow(100);
    renderUi(<TruncatedText text="Members" />);
    await userEvent.hover(screen.getByText("Members"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("is used by sidebar items", async () => {
    overflow(180);
    renderUi(
      <Sidebar label="Settings">
        <SidebarGroup label="Organization">
          <SidebarItem label="Benachrichtigungseinstellungen" href="#notifications" />
        </SidebarGroup>
      </Sidebar>,
    );
    await userEvent.hover(screen.getByText("Benachrichtigungseinstellungen"));
    expect((await screen.findByRole("tooltip")).textContent).toContain("Benachrichtigungseinstellungen");
  });

  it("is used by select values", async () => {
    overflow(180);
    renderUi(
      <Select
        aria-label="Date format"
        value="long"
        onValueChange={() => {}}
        options={[{ value: "long", label: "Automatisch (Mittwoch, 1. Oktober 2026)" }]}
      />,
    );
    await userEvent.hover(screen.getByRole("combobox", { name: "Date format" }));
    expect((await screen.findByRole("tooltip")).textContent).toContain("Automatisch");
  });
});
