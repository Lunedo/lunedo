import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeyRound, Shield, Users } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "./button.js";
import { RadioGroup, Select } from "./controls.js";
import { Avatar, avatarColor, Badge, EmptyState, initialsOf, Notice, Spinner } from "./feedback.js";
import { Field } from "./field.js";
import {
  BackLink,
  DangerAction,
  DangerZone,
  List,
  ListRow,
  PageHeader,
  Section,
  SettingRow,
} from "./layout.js";
import { renderUi } from "./testing/render.js";

function RouterLink(props: ComponentProps<"a">) {
  return <a {...props} />;
}

describe("PageHeader", () => {
  it("shows breadcrumbs, the section icon, the organization context and actions", () => {
    renderUi(
      <PageHeader
        title="Members"
        description="People in Platform Team."
        icon={Users}
        context="Platform Team"
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Members" }]}
        actions={<Button variant="primary">Invite people</Button>}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Members" })).toBeDefined();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumbs" });
    expect(within(crumbs).getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
    expect(within(crumbs).getByText("Members").getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Platform Team")).toBeDefined();
    expect(document.querySelector("header .bg-accent-soft svg")).not.toBeNull();
  });

  it("leaves out the icon tile on settings pages and shows the save status next to the title", () => {
    renderUi(<PageHeader title="Preferences" icon={Users} variant="settings" status={<span>Saved</span>} />);
    expect(document.querySelector("header .bg-accent-soft")).toBeNull();
    expect(document.querySelector("header svg")).toBeNull();
    const title = screen.getByRole("heading", { level: 1, name: "Preferences" });
    expect(title.parentElement?.textContent).toBe("PreferencesSaved");
  });
});

describe("Section, SettingRow and List", () => {
  it("label their content", () => {
    renderUi(
      <Section title="Sign-in" icon={Shield}>
        <SettingRow
          label="Session length"
          description="How long people stay signed in."
          meta="Set for Platform Team"
          control={<Button>Override</Button>}
        />
        <List label="Tokens">
          <ListRow icon={KeyRound} title="Backup script" description="Expires 31 Dec 2026" />
        </List>
      </Section>,
    );
    expect(screen.getByRole("region", { name: "Sign-in" })).toBeDefined();
    expect(within(screen.getByRole("list", { name: "Tokens" })).getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("Section headers", () => {
  it("draw a flat section with hairlines between rows and no box", () => {
    renderUi(
      <Section title="Display" description="Applies to every space.">
        <p>Body</p>
      </Section>,
    );
    const section = screen.getByRole("region", { name: "Display" });
    for (const boxed of ["rounded", "bg-surface", "border-border "]) {
      expect(section.className).not.toContain(boxed);
    }
    expect(screen.getByText("Applies to every space.").className).toContain("text-text-muted");
    const rows = screen.getByText("Body").parentElement;
    expect(rows?.className).toContain("divide-y");
    expect(rows?.className).toContain("divide-border");
  });

  it("let actions move below a long title instead of cutting them", () => {
    renderUi(
      <Section title="Gruppenverwalter" actions={<Button>Gruppenverwalter hinzufügen</Button>}>
        <p>Body</p>
      </Section>,
    );
    const header = screen.getByRole("heading", { name: "Gruppenverwalter" }).parentElement;
    expect(header?.className).toContain("flex-wrap");
  });
});

describe("SettingRow", () => {
  it("shows the label in its own column and the hint and source under the control", () => {
    renderUi(
      <SettingRow
        label="Retention"
        description="Older versions are deleted."
        meta="Instance default: 90 days"
        control={<Button>Change</Button>}
        menu={<Button>More</Button>}
        status={<span>Saved</span>}
      />,
    );
    const row = document.querySelector("[data-setting-row]");
    expect(row?.className).toContain("sm:grid-cols-setting-row");
    expect(row?.className).toContain("grid-cols-1");
    const label = row?.querySelector("[data-setting-label]");
    expect(label?.textContent).toBe("Retention");
    expect(label?.className).toContain("text-text-muted");
    const column = row?.querySelector("[data-setting-line]")?.parentElement;
    const hint = screen.getByText("Older versions are deleted.");
    const source = screen.getByText("Instance default: 90 days");
    expect(hint.parentElement).toBe(column);
    expect(source.parentElement).toBe(column);
    expect(hint.className).toContain("text-sm");
    expect(source.className).toContain("text-xs");
    expect(within(column as HTMLElement).getByText("Saved")).toBeDefined();
    expect(within(column as HTMLElement).getByRole("button", { name: "More" })).toBeDefined();
  });

  it("leaves no room for a missing menu on narrow screens", () => {
    renderUi(<SettingRow label="E-mail" control={<Button>Change e-mail address</Button>} />);
    const menu = document.querySelector("[data-setting-menu]");
    expect(menu?.className).toContain("hidden");
    expect(menu?.className).toContain("sm:flex");
  });
});

describe("DangerZone", () => {
  it("is flat with its heading in the danger color", () => {
    renderUi(
      <DangerZone title="Danger zone">
        <DangerAction
          title="Delete space"
          description="All pages are deleted."
          action={<Button variant="danger">Delete space</Button>}
        />
      </DangerZone>,
    );
    const zone = screen.getByRole("region", { name: "Danger zone" });
    expect(zone.className).not.toContain("border-danger");
    expect(zone.className).not.toContain("rounded");
    expect(screen.getByRole("heading", { name: "Danger zone" }).className).toContain("text-danger");
    expect(screen.getByRole("button", { name: "Delete space" })).toBeDefined();
  });
});

describe("BackLink", () => {
  it("links back to the parent page", () => {
    renderUi(
      <>
        <BackLink label="Groups" href="/settings/groups" />
        <BackLink label="Identity providers" asChild>
          <RouterLink href="/settings/identity" />
        </BackLink>
      </>,
    );
    expect(screen.getByRole("link", { name: "Groups" }).getAttribute("href")).toBe("/settings/groups");
    expect(screen.getByRole("link", { name: "Identity providers" }).getAttribute("href")).toBe(
      "/settings/identity",
    );
  });
});

describe("ListRow", () => {
  it("shows details below the row across its full width", () => {
    renderUi(
      <List>
        <ListRow title="Address" actions={<Badge>Next step</Badge>}>
          <p>LUNEDO_TRUSTED_PROXIES is not set.</p>
        </ListRow>
      </List>,
    );
    expect(screen.getByText("LUNEDO_TRUSTED_PROXIES is not set.").parentElement?.className).toContain(
      "basis-full",
    );
  });
});

describe("feedback components", () => {
  it("derive initials and a stable palette color", () => {
    expect(initialsOf("Lena Hofer")).toBe("LH");
    expect(initialsOf("Marcel")).toBe("M");
    expect(initialsOf("Anna Maria Roth")).toBe("AR");
    expect(avatarColor("Lena Hofer")).toBe(avatarColor("Lena Hofer"));
    expect(avatarColor("Lena Hofer")).toMatch(/^bg-palette-/);
  });

  it("name avatars unless decorative", () => {
    renderUi(
      <>
        <Avatar name="Lena Hofer" />
        <Avatar name="Tomas Kern" decorative />
      </>,
    );
    const avatar = screen.getByRole("img", { name: "Lena Hofer" });
    expect(avatar.textContent).toBe("");
    expect(avatar.querySelector("[data-initials]")?.getAttribute("data-initials")).toBe("LH");
    expect(screen.queryByRole("img", { name: "Tomas Kern" })).toBeNull();
  });

  it("show the picture of a person and fall back to the initials when it does not load", () => {
    renderUi(<Avatar name="Lena Hofer" src="/pictures/lena.png" />);
    const picture = screen.getByRole("img", { name: "Lena Hofer" });
    expect(picture.tagName).toBe("IMG");
    fireEvent.error(picture);
    const fallback = screen.getByRole("img", { name: "Lena Hofer" });
    expect(fallback.tagName).toBe("SPAN");
    expect(fallback.querySelector("[data-initials]")?.getAttribute("data-initials")).toBe("LH");
  });

  it("render badges, notices, empty states and spinners", () => {
    renderUi(
      <>
        <Badge variant="warning">Guest</Badge>
        <Notice variant="danger" title="Sign-in failed">
          Try again.
        </Notice>
        <EmptyState icon={Users} title="No groups yet" description="Groups collect people." />
        <Spinner label="Loading members" />
      </>,
    );
    expect(screen.getByText("Guest").className).toContain("bg-warning-soft");
    expect(screen.getByRole("alert").textContent).toContain("Sign-in failed");
    expect(screen.getByText("No groups yet")).toBeDefined();
    expect(screen.getByRole("status").textContent).toBe("Loading members");
  });
});

function SelectProbe() {
  const [value, setValue] = useState("en");
  return (
    <>
      <Field label="Language">
        <Select
          value={value}
          onValueChange={setValue}
          options={[
            { value: "en", label: "English" },
            { value: "de", label: "Deutsch" },
          ]}
        />
      </Field>
      <RadioGroup
        label="Start"
        value="empty"
        onValueChange={() => {}}
        variant="card"
        options={[
          { value: "empty", label: "Empty", description: "Start with an empty organization." },
          { value: "sample", label: "With sample content" },
        ]}
      />
      <output>{value}</output>
    </>
  );
}

describe("Select and RadioGroup", () => {
  it("choose an option from the keyboard", async () => {
    renderUi(<SelectProbe />);
    const trigger = screen.getByRole("combobox", { name: "Language" });
    expect(trigger.textContent).toContain("English");
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const option = await screen.findByRole("option", { name: "Deutsch" });
    await userEvent.click(option);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("de"));
    expect(screen.getByRole("radiogroup", { name: "Start" })).toBeDefined();
    expect(screen.getByRole("radio", { name: /Empty/ }).getAttribute("aria-checked")).toBe("true");
  });
});
