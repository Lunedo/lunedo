import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Bell, House } from "lucide-react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { Rail, RailButton, RailLink } from "./rail.js";
import { Sidebar, SidebarGroup, SidebarHeader, SidebarItem } from "./sidebar.js";
import { renderUi } from "./testing/render.js";

function RouterLink(props: ComponentProps<"a">) {
  return <a {...props} />;
}

describe("Rail", () => {
  it("renders a labelled navigation with accessible buttons", async () => {
    const onClick = vi.fn();
    renderUi(
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
    renderUi(<RailButton label="Create" icon="+" variant="primary" />);
    const className = screen.getByRole("button").className;
    expect(className).toContain("bg-accent");
    expect(className).not.toMatch(/#|rgb|\[/);
  });

  it("shows a badge and renders links", () => {
    renderUi(
      <ul>
        <RailButton label="Notifications, 3 unread" icon={<Bell />} badge={3} />
        <RailLink label="For you" icon={<House />} href="/" current />
        <RailButton label="Members" icon={<House />} asChild>
          <RouterLink href="/members" />
        </RailButton>
      </ul>,
    );
    expect(screen.getByRole("button", { name: "Notifications, 3 unread" }).textContent).toBe("3");
    expect(screen.getByRole("link", { name: "For you" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Members" }).getAttribute("href")).toBe("/members");
  });
});

describe("Sidebar", () => {
  it("groups items and marks the current one", () => {
    renderUi(
      <Sidebar label="Settings">
        <SidebarHeader>Settings</SidebarHeader>
        <SidebarGroup label="My account">
          <SidebarItem icon={House} label="Preferences" href="/settings/preferences" current />
          <SidebarItem icon={House} label="Security" asChild>
            <RouterLink href="/settings/security" />
          </SidebarItem>
        </SidebarGroup>
      </Sidebar>,
    );
    expect(screen.getByRole("navigation", { name: "Settings" })).toBeDefined();
    expect(screen.getByRole("list", { name: "My account" })).toBeDefined();
    const current = screen.getByRole("link", { name: "Preferences" });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.className).toContain("bg-accent");
    expect(current.className).toContain("text-on-accent");
    expect(current.querySelector("svg")?.getAttribute("class")).toContain("text-on-accent");
    const other = screen.getByRole("link", { name: "Security" });
    expect(other.getAttribute("href")).toBe("/settings/security");
    expect(other.className).not.toContain("bg-accent");
  });

  it("lists ungrouped items first and separates groups with a heading line", () => {
    renderUi(
      <Sidebar label="Organization settings">
        <SidebarHeader eyebrow="Settings">Organization</SidebarHeader>
        <SidebarGroup>
          <SidebarItem label="General" href="/general" />
        </SidebarGroup>
        <SidebarGroup label="People and access" variant="divided">
          <SidebarItem label="Members" href="/members" />
        </SidebarGroup>
      </Sidebar>,
    );
    expect(screen.getByText("Settings")).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "Organization" })).toBeDefined();
    const lists = screen.getAllByRole("list");
    expect(within(lists[0] as HTMLElement).getByRole("link", { name: "General" })).toBeDefined();
    const group = screen.getByRole("list", { name: "People and access" });
    expect(within(group).getByRole("link", { name: "Members" })).toBeDefined();
    const heading = screen.getByRole("heading", { level: 3, name: "People and access" });
    expect(heading.className).toContain("text-2xs");
    expect(heading.className).toContain("font-bold");
    expect(heading.className).toContain("uppercase");
    expect(heading.parentElement?.className).toContain("border-t");
  });

  it("hides itself when collapsed", () => {
    renderUi(
      <Sidebar label="Settings" collapsed>
        <SidebarHeader>Settings</SidebarHeader>
      </Sidebar>,
    );
    expect(screen.getByRole("navigation", { hidden: true }).className).toContain("hidden");
  });
});
