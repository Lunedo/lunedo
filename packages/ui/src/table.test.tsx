import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MoreHorizontal, Trash } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { IconButton } from "./button.js";
import { Menu } from "./overlays.js";
import { Table, type TableColumn, type TableSort } from "./table.js";
import { renderUi } from "./testing/render.js";

interface Person {
  id: string;
  name: string;
  role: string;
}

const people: Person[] = [
  { id: "1", name: "Lena Hofer", role: "Admin" },
  { id: "2", name: "Tomas Kern", role: "Member" },
];

const columns: TableColumn<Person>[] = [
  { key: "name", header: "Name", cell: (row) => row.name, sortable: true },
  { key: "role", header: "Role", cell: (row) => row.role, hideBelow: "sm" },
];

function renderTable(props: Partial<Parameters<typeof Table<Person>>[0]> = {}) {
  return renderUi(
    <Table columns={columns} rows={people} rowKey={(row) => row.id} caption="Members" {...props} />,
  );
}

describe("Table", () => {
  it("puts a heading row with its count before each group of rows", () => {
    renderTable({
      rows: [...people, { id: "3", name: "Mira Klein", role: "Member" }],
      groupOf: (row) => ({ key: row.role, label: row.role, count: row.role === "Admin" ? 1 : 2 }),
    });
    const table = screen.getByRole("table", { name: "Members" });
    const groups = within(table)
      .getAllByRole("columnheader")
      .filter((cell) => cell.getAttribute("scope") === "colgroup");
    expect(groups.map((cell) => cell.textContent)).toEqual(["Admin1", "Member2"]);
    expect(within(table).getAllByRole("row")).toHaveLength(6);
  });

  it("renders a captioned table with its rows", () => {
    renderTable();
    const table = screen.getByRole("table", { name: "Members" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByRole("columnheader", { name: "Role" }).className).toContain(
      "hidden @card:table-cell",
    );
  });

  it("hides columns by the width it has, not by the width of the window", () => {
    renderTable();
    const table = screen.getByRole("table", { name: "Members" });
    expect(table.closest('[class~="@container"]')).not.toBeNull();
  });

  it("lets a growing column take the free width from card width on, and scrolls narrower tables instead", () => {
    renderTable({
      columns: [{ ...columns[0], grow: true } as TableColumn<Person>, columns[1] as TableColumn<Person>],
    });
    const table = screen.getByRole("table", { name: "Members" });
    const header = within(table).getByRole("columnheader", { name: "Name" });
    expect(header.className).toContain("@card:w-full @card:max-w-0");
    expect(within(table).getByRole("cell", { name: "Lena Hofer" }).className).toContain("@card:max-w-0");
    expect(table.closest("[data-table-frame]")?.className).toContain("overflow-x-auto");
    expect(within(table).getByRole("cell", { name: "Admin" }).className).not.toContain("max-w-0");
  });

  it("keeps the header in view and scrolls sideways only on narrow screens", () => {
    renderTable({ sort: { key: "name", direction: "asc" }, onSortChange: () => {} });
    const frame = screen.getByRole("table", { name: "Members" }).parentElement as HTMLElement;
    expect(frame.className).toContain("max-sm:overflow-x-auto");
    expect(frame.className).toContain("sm:overflow-x-clip");
    expect(screen.getByRole("columnheader", { name: /Name/ }).className).toContain("sticky top-0");
  });

  it("opens a row when it is clicked", async () => {
    const onRowClick = vi.fn<(row: Person) => void>();
    renderTable({ onRowClick });
    await userEvent.click(screen.getByText("Tomas Kern"));
    expect(onRowClick).toHaveBeenCalledWith(people[1]);
  });

  it("states the sort order and asks for the next one", async () => {
    const onSortChange = vi.fn<(sort: TableSort) => void>();
    renderTable({ sort: { key: "name", direction: "asc" }, onSortChange });
    const header = screen.getByRole("columnheader", { name: /Name/ });
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    expect(screen.getByRole("columnheader", { name: "Role" }).hasAttribute("aria-sort")).toBe(false);
    await userEvent.click(within(header).getByRole("button", { name: /Sort descending/ }));
    expect(onSortChange).toHaveBeenCalledWith({ key: "name", direction: "desc" });
  });

  it("pages forward and backward", async () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const onPageSizeChange = vi.fn();
    renderTable({
      pagination: { hasPrevious: false, hasNext: true, onNext, onPrevious, pageSize: 25, onPageSizeChange },
    });
    const pages = screen.getByRole("navigation", { name: "Pages" });
    expect((within(pages).getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await userEvent.click(within(pages).getByRole("button", { name: "Next" }));
    expect(onNext).toHaveBeenCalledOnce();
    await userEvent.click(within(pages).getByRole("combobox", { name: "Rows per page" }));
    await userEvent.click(await screen.findByRole("option", { name: "50" }));
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("selects rows one by one or all at once and shows the bulk bar", async () => {
    const onChange = vi.fn();
    const { unmount } = renderTable({
      selection: {
        selected: new Set(),
        onChange,
        rowLabel: (row) => `Select ${row.name}`,
        bulkBar: (selected) => `${selected.size} selected`,
      },
    });
    expect(screen.queryByText(/selected$/)).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Tomas Kern" }));
    expect([...((onChange.mock.lastCall ?? [])[0] as Set<string>)]).toEqual([people[1]?.id]);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all on this page" }));
    expect(((onChange.mock.lastCall ?? [])[0] as Set<string>).size).toBe(people.length);
    unmount();
    renderTable({
      selection: {
        selected: new Set([people[0]?.id ?? ""]),
        onChange,
        rowLabel: (row) => `Select ${row.name}`,
        bulkBar: (selected) => `${selected.size} selected`,
      },
    });
    expect(screen.getByRole("region", { name: "Selection" }).textContent).toBe("1 selected");
    expect(
      screen.getByRole("checkbox", { name: "Select all on this page" }).getAttribute("aria-checked"),
    ).toBe("mixed");
  });

  it("shows the empty state and the loading state", () => {
    const { unmount } = renderTable({ rows: [], empty: "No members yet." });
    expect(screen.getByText("No members yet.")).toBeDefined();
    unmount();
    renderTable({ loading: true });
    expect(screen.getByRole("table").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Loading")).toBeDefined();
    expect(screen.queryByText("Lena Hofer")).toBeNull();
  });

  it("keeps a sticky row menu column reachable while the table scrolls", () => {
    renderTable({
      columns: [...columns, { key: "actions", header: "Actions", cell: () => "…", sticky: true }],
    });
    const cells = screen.getAllByRole("cell", { name: "…" });
    for (const cell of cells) expect(cell.className).toContain("sticky");
    expect(screen.getByRole("columnheader", { name: "Actions" }).className).toContain("sticky");
  });

  it("does not open a row for clicks inside a menu that it renders elsewhere", async () => {
    const onRowClick = vi.fn();
    const onSelect = vi.fn();
    renderTable({
      onRowClick,
      columns: [
        ...columns,
        {
          key: "actions",
          header: "Actions",
          cell: (row) => (
            <Menu
              trigger={<IconButton label={`More for ${row.name}`} icon={MoreHorizontal} />}
              items={[{ label: "Remove rule", icon: Trash, onSelect }]}
            />
          ),
        },
      ],
    });
    await userEvent.click(screen.getByRole("button", { name: "More for Lena Hofer" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove rule" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("draws a frame with a small header row and lines only between rows", () => {
    renderUi(
      <Table
        caption="Articles"
        columns={[{ key: "title", header: "Title", cell: (row: { id: string }) => row.id }]}
        rows={[{ id: "VPN" }, { id: "Wi-Fi" }]}
        rowKey={(row) => row.id}
      />,
    );
    const table = screen.getByRole("table", { name: "Articles" });
    expect(table.closest("[data-table-frame]")?.className).toContain("rounded-lg border");
    const cells = screen.getAllByRole("cell");
    expect(cells.at(0)?.className).toContain("border-b");
    expect(cells.at(-1)?.className).not.toContain("border-b");
    expect(cells.at(0)?.className).toContain("h-control-lg");
    expect(screen.getByRole("columnheader", { name: "Title" }).className).toContain("text-xs");
  });
});
