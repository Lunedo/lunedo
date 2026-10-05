import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeyRound, Shield, Users } from "lucide-react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "./button.js";
import { RadioGroup, Select } from "./controls.js";
import { Avatar, avatarColor, Badge, EmptyState, initialsOf, Notice, Spinner } from "./feedback.js";
import { Field } from "./field.js";
import { List, ListRow, PageHeader, Section, SettingRow } from "./layout.js";
import { renderUi } from "./testing/render.js";

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
  it("are not darker than the card body", () => {
    renderUi(
      <Section title="Display">
        <p>Body</p>
      </Section>,
    );
    const header = screen.getByRole("heading", { name: "Display" }).parentElement;
    expect(header?.className).toContain("bg-surface");
    expect(header?.className).not.toContain("bg-surface-sunken");
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
  it("leaves no room for a missing menu on narrow screens", () => {
    renderUi(<SettingRow label="E-mail" control={<Button>Change e-mail address</Button>} />);
    const menu = document.querySelector("[data-setting-menu]");
    expect(menu?.className).toContain("hidden");
    expect(menu?.className).toContain("sm:flex");
  });
});

describe("ListRow", () => {
  it("shows details below the row across its full width", () => {
    renderUi(
      <List>
        <ListRow title="Address" actions={<Badge>Next step</Badge>}>
          <p>PAGEHALL_TRUSTED_PROXIES is not set.</p>
        </ListRow>
      </List>,
    );
    expect(screen.getByText("PAGEHALL_TRUSTED_PROXIES is not set.").parentElement?.className).toContain(
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
    expect(screen.getByRole("img", { name: "Lena Hofer" }).textContent).toBe("LH");
    expect(screen.queryByRole("img", { name: "Tomas Kern" })).toBeNull();
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
