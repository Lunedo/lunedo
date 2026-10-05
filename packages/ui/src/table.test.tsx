import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MoreHorizontal } from "lucide-react";
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
  it("renders a captioned table with its rows", () => {
    renderTable();
    const table = screen.getByRole("table", { name: "Members" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByRole("columnheader", { name: "Role" }).className).toContain(
      "hidden sm:table-cell",
    );
  });

  it("keeps hidden sort labels inside its scroll area", () => {
    renderTable({ sort: { key: "name", direction: "asc" }, onSortChange: () => {} });
    const scroller = screen.getByRole("table", { name: "Members" }).parentElement as HTMLElement;
    expect(scroller.className).toContain("relative");
    expect(scroller.className).toContain("overflow-x-auto");
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
    renderTable({ pagination: { hasPrevious: false, hasNext: true, onNext, onPrevious } });
    const pages = screen.getByRole("navigation", { name: "Pages" });
    expect(within(pages).queryByRole("button", { name: "Previous page" })).toBeNull();
    await userEvent.click(within(pages).getByRole("button", { name: "Next page" }));
    expect(onNext).toHaveBeenCalledOnce();
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
              items={[{ label: "Remove rule", onSelect }]}
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
});
