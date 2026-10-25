import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button.js";
import { ChoiceTable } from "./choice-table.js";
import { Select } from "./controls.js";
import { PageContainer, SettingRow } from "./layout.js";
import { Table, TableToolbar } from "./table.js";
import { renderUi } from "./testing/render.js";
import {
  shortTimeZoneOffset,
  TimeZoneCombobox,
  timeZoneItem,
  timeZoneItems,
  timeZoneOffset,
} from "./time-zone-combobox.js";

const NOW = new Date("2026-01-15T12:00:00Z");

describe("time zones", () => {
  it("describes each zone with region, current offset and local time", () => {
    expect(timeZoneOffset("Asia/Kolkata", NOW)).toBe("UTC+05:30");
    expect(timeZoneOffset("UTC", NOW)).toBe("UTC+00:00");
    const vienna = timeZoneItem("Europe/Vienna", NOW, "en-GB");
    expect(vienna.label).toBe("Vienna");
    expect(vienna.description).toBe("Europe · UTC+01:00 · 13:00");
    expect(vienna.keywords).toEqual(expect.arrayContaining(["Europe/Vienna", "UTC+1", "+1", "GMT+1"]));
    expect(timeZoneItem("America/Argentina/Buenos_Aires", NOW).label).toBe("Buenos Aires");
  });

  it("takes a label from the caller and keeps the zone, city and offset searchable", () => {
    expect(shortTimeZoneOffset("Europe/Vienna", new Date("2026-07-01T12:00:00Z"))).toBe("UTC+2");
    expect(shortTimeZoneOffset("Asia/Kolkata", NOW)).toBe("UTC+5:30");
    expect(shortTimeZoneOffset("America/New_York", NOW)).toBe("UTC-5");
    expect(shortTimeZoneOffset("UTC", NOW)).toBe("UTC+0");
    const vienna = timeZoneItem(
      "Europe/Vienna",
      NOW,
      "de",
      (zone, now) => `Europa/Wien (${shortTimeZoneOffset(zone, now)})`,
    );
    expect(vienna.label).toBe("Europa/Wien (UTC+1)");
    expect(vienna.description).toBe("13:00");
    expect(vienna.keywords).toEqual(expect.arrayContaining(["Europe/Vienna", "Vienna", "UTC+1"]));
  });

  it("lists the inherited and the browser's time zone first", () => {
    const items = timeZoneItems({
      now: NOW,
      browserTimeZone: "Europe/Vienna",
      inheritedTimeZone: "UTC",
      suggestedLabel: "Suggested",
      allLabel: "All time zones",
      browserMarker: "This browser",
      defaultMarker: "Default",
    });
    expect(items.slice(0, 2).map((item) => [item.value, item.marker, item.group])).toEqual([
      ["UTC", "Default", "Suggested"],
      ["Europe/Vienna", "This browser", "Suggested"],
    ]);
    expect(items.filter((item) => item.value === "Europe/Vienna")).toHaveLength(1);
    expect(items[2]?.group).toBe("All time zones");
  });

  it("finds a zone by city, region or offset", async () => {
    function Zone() {
      const [value, setValue] = useState<string | null>(null);
      return (
        <TimeZoneCombobox
          aria-label="Time zone"
          value={value}
          onValueChange={setValue}
          browserTimeZone="Europe/Vienna"
          now={NOW}
          locale="en-GB"
        />
      );
    }
    renderUi(<Zone />);
    const input = screen.getByRole("combobox", { name: "Time zone" });
    await userEvent.type(input, "tokyo");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "TokyoAsia · UTC+09:00 · 21:00",
    ]);
    await userEvent.clear(input);
    await userEvent.type(input, "asia utc+9");
    expect(screen.getAllByRole("option").map((option) => option.textContent?.split("Asia")[0])).toContain(
      "Tokyo",
    );
    await userEvent.clear(input);
    await userEvent.type(input, "tokyo{Enter}");
    expect((input as HTMLInputElement).value).toBe("Tokyo");
  }, 15_000);
});

describe("tables", () => {
  const rows = [
    { id: "a", name: "Platform Team" },
    { id: "b", name: "Design" },
  ];

  it("opens a row by click or keyboard, but not from controls inside it", async () => {
    const onRowClick = vi.fn();
    const onMenu = vi.fn();
    renderUi(
      <Table
        caption="Organizations"
        rows={rows}
        rowKey={(row) => row.id}
        rowLabel={(row) => `Open ${row.name}`}
        onRowClick={onRowClick}
        columns={[
          { key: "name", header: "Name", cell: (row) => row.name },
          {
            key: "actions",
            header: "Actions",
            cell: (row) => <Button onClick={() => onMenu(row.id)}>More</Button>,
          },
        ]}
      />,
    );
    await userEvent.click(screen.getByText("Design"));
    expect(onRowClick).toHaveBeenLastCalledWith(rows[1]);
    await userEvent.click(screen.getAllByRole("button", { name: "More" })[0] as HTMLElement);
    expect(onMenu).toHaveBeenCalledWith("a");
    expect(onRowClick).toHaveBeenCalledTimes(1);
    const first = screen.getByRole("row", { name: "Open Platform Team" });
    first.focus();
    await userEvent.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenLastCalledWith(rows[0]);
    await userEvent.keyboard(" ");
    expect(onRowClick).toHaveBeenCalledTimes(3);
  });

  it("puts search, filters and reset on the left and actions on the right", async () => {
    const onReset = vi.fn();
    function Toolbar() {
      const [query, setQuery] = useState("");
      return (
        <TableToolbar
          search={{ value: query, onChange: setQuery, label: "Search organizations" }}
          filters={<Button>State</Button>}
          filtersActive={query !== ""}
          onResetFilters={() => {
            onReset();
            setQuery("");
          }}
          actions={<Button>Export</Button>}
        />
      );
    }
    renderUi(<Toolbar />);
    expect(screen.queryByRole("button", { name: "Reset filters" })).toBeNull();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search organizations" }), "p");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("p");
    await userEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(onReset).toHaveBeenCalledOnce();
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    await userEvent.type(screen.getByRole("searchbox"), "q");
    const toolbar = document.querySelector("[data-table-toolbar]") as HTMLElement;
    const [left, right] = Array.from(toolbar.children);
    expect(within(left as HTMLElement).getByRole("button", { name: "Reset filters" })).toBeTruthy();
    expect(within(right as HTMLElement).getByRole("button", { name: "Export" })).toBeTruthy();
  });
});

describe("layout patterns", () => {
  it("gives every setting row the same three columns, with or without a menu", () => {
    renderUi(
      <>
        <SettingRow label="Time format" description="How times are shown." control={<span>select</span>} />
        <SettingRow label="Language" control={<span>select</span>} menu={<Button>More</Button>} />
      </>,
    );
    const rows = document.querySelectorAll("[data-setting-row]");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.children).toHaveLength(2);
      const control = row.querySelector("[data-setting-control]");
      const menu = row.querySelector("[data-setting-menu]");
      expect(control?.className).toContain("sm:w-field");
      expect(menu?.className).toContain("w-control-md");
      expect(control?.parentElement).toBe(menu?.parentElement);
      expect(control?.parentElement?.className).toContain("items-center");
    }
  });

  it("uses the full width for table pages and a narrow column for settings", () => {
    renderUi(
      <>
        <PageContainer width="wide">table</PageContainer>
        <PageContainer width="narrow">form</PageContainer>
      </>,
    );
    expect(screen.getByText("table").className).not.toContain("max-w-page");
    expect(screen.getByText("form").className).toContain("max-w-page");
  });

  it("explains why an access level cannot be chosen and ignores it", async () => {
    const onValueChange = vi.fn();
    renderUi(
      <ChoiceTable
        caption="Areas"
        labelHeader="Area"
        choiceHeader="Access"
        rows={[
          {
            key: "members",
            label: "Members and groups",
            description: "Invite people and manage groups.",
            value: "view",
            onValueChange,
            options: [
              { value: "none", label: "No access" },
              { value: "view", label: "View" },
              {
                value: "manage",
                label: "Manage",
                disabled: true,
                disabledReason: "Nobody can grant more than they have.",
              },
            ],
          },
        ]}
      />,
    );
    const manage = screen.getByRole("radio", { name: "Manage" });
    expect(manage.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(manage.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Nobody can grant more than they have.",
    );
    await userEvent.click(manage);
    expect(onValueChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("radio", { name: "No access" }));
    expect(onValueChange).toHaveBeenCalledWith("none");
    expect(screen.getByRole("rowheader", { name: /Members and groups/ })).toBeTruthy();
  });

  it("keeps the list of a select at least as wide as its trigger", async () => {
    renderUi(
      <Select
        aria-label="Language"
        value="en"
        onValueChange={() => {}}
        options={[
          { value: "en", label: "English" },
          { value: "de", label: "Deutsch" },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Language" }));
    expect(
      screen.getByRole("listbox").closest("[data-radix-popper-content-wrapper] > *")?.className,
    ).toContain("min-w-select-trigger");
  });
});
