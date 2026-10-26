import { act, fireEvent, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "../i18n/index.js";
import { renderWithProviders } from "../testing/render.js";
import {
  filterSlashCommands,
  recentSlashCommands,
  rememberSlashCommand,
  sizedTable,
  slashCommands,
  slashMenuOpen,
  slashSuggestionItems,
} from "./slash-items.js";
import { moveIndex, SuggestionList, type SuggestionListHandle } from "./suggestion-list.js";

describe("slash commands", () => {
  it("cover every block with an interface in this release", async () => {
    const i18n = await initI18n(["en"]);
    const ids = slashCommands.map((command) => command.id);
    for (const id of [
      "paragraph",
      "heading1",
      "heading6",
      "bulletList",
      "orderedList",
      "taskList",
      "blockquote",
      "codeBlock",
      "callout-info",
      "callout-error",
      "expand",
      "columns2",
      "columns4",
      "horizontalRule",
      "table",
      "tableOfContents",
      "blockMath",
      "inlineMath",
      "status",
      "date",
      "mention",
      "pageLink",
      "emoji",
      "drawing",
      "pageProperties",
      "propertiesReport",
      "contentByLabel",
      "relatedLabels",
      "excerpt",
      "includeExcerpt",
      "includePage",
      "embed",
      "whiteboard",
      "tabs",
    ]) {
      expect(ids).toContain(id);
    }
    expect(filterSlashCommands(slashCommands, "", i18n.t)).toHaveLength(slashCommands.length);
  });

  it("filter by label, description and keywords in the reader's language, best matches first", async () => {
    const english = await initI18n(["en"]);
    expect(filterSlashCommands(slashCommands, "tab", english.t).map((command) => command.id)[0]).toBe(
      "table",
    );
    expect(filterSlashCommands(slashCommands, "todo", english.t).map((command) => command.id)).toEqual([
      "taskList",
    ]);
    expect(filterSlashCommands(slashCommands, "warn", english.t).map((command) => command.id)).toEqual([
      "callout-warning",
    ]);
    expect(filterSlashCommands(slashCommands, "nothing like this", english.t)).toEqual([]);
    const german = await initI18n(["de"]);
    expect(filterSlashCommands(slashCommands, "überschr", german.t)[0]?.id).toBe("heading1");
    expect(slashSuggestionItems("formel", german.t).map((item) => item.id)).toEqual([
      "blockMath",
      "inlineMath",
    ]);
  });

  it("filter by names with spaces and put the whole name first", async () => {
    const { t } = await initI18n(["en"]);
    for (const [query, id] of [
      ["page properties report", "propertiesReport"],
      ["include excerpt", "includeExcerpt"],
      ["content by label", "contentByLabel"],
      ["link to whiteboard", "whiteboard"],
      ["draw.io diagram", "drawio"],
    ] as const) {
      expect(filterSlashCommands(slashCommands, query, t)[0]?.id, query).toBe(id);
      expect(slashMenuOpen(query, t), query).toBe(true);
    }
  });

  it("stay open for one word without a match, close after several or after a space right behind the slash", async () => {
    const { t } = await initI18n(["en"]);
    expect(slashMenuOpen("", t)).toBe(true);
    expect(slashMenuOpen("xyzzy", t)).toBe(true);
    expect(slashMenuOpen("page xyzzy", t)).toBe(true);
    expect(slashMenuOpen("page xyzzy again", t)).toBe(false);
    expect(slashMenuOpen("and then we went home", t)).toBe(false);
    expect(slashMenuOpen(" or", t)).toBe(false);
  });
});

describe("suggestion list", () => {
  it("moves through the entries with the keyboard and selects with Enter", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const ref = createRef<SuggestionListHandle>();
    await renderWithProviders(
      <SuggestionList
        ref={ref}
        label="Blocks"
        emptyText="Nothing"
        items={[
          { id: "a", label: "Alpha", group: "Text", select: first },
          { id: "b", label: "Beta", group: "Lists", select: second },
        ]}
      />,
    );
    const options = screen.getAllByRole("option");
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    act(() => {
      ref.current?.onKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });
    expect(screen.getAllByRole("option")[1]?.getAttribute("aria-selected")).toBe("true");
    act(() => {
      ref.current?.onKeyDown(new KeyboardEvent("keydown", { key: "Enter" }));
    });
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    expect(screen.getByText("Lists")).toBeTruthy();
    fireEvent.mouseDown(screen.getByText("Alpha"));
    expect(first).toHaveBeenCalledOnce();
  });

  it("wraps around at both ends", () => {
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(2, 1, 3)).toBe(0);
    expect(moveIndex(0, 1, 0)).toBe(0);
  });
});

describe("the slash menu extras", () => {
  it("lists recently used blocks first while nothing is typed", async () => {
    const i18n = await initI18n(["en"]);
    localStorage.removeItem("lunedo.recentBlocks");
    rememberSlashCommand("taskList");
    rememberSlashCommand("table");
    expect(recentSlashCommands()).toEqual(["table", "taskList"]);
    const items = slashSuggestionItems("", i18n.t);
    expect(items.slice(0, 2).map((item) => [item.id, item.group])).toEqual([
      ["recent:table", "Recently used"],
      ["recent:taskList", "Recently used"],
    ]);
    expect(slashSuggestionItems("tab", i18n.t).some((item) => item.id.startsWith("recent:"))).toBe(false);
  });

  it("inserts a table of the typed size", async () => {
    const i18n = await initI18n(["de"]);
    expect(sizedTable("tabelle 4x3")).toEqual({ columns: 4, rows: 3 });
    expect(sizedTable("table 2 × 5")).toEqual({ columns: 2, rows: 5 });
    expect(sizedTable("tabelle 40x3")).toBeNull();
    expect(slashMenuOpen("tabelle 4x3", i18n.t)).toBe(true);
    const [item] = slashSuggestionItems("tabelle 4x3", i18n.t);
    expect(item?.label).toBe("Tabelle 4 × 3");
  });

  it("shows keyboard hints under the entries", async () => {
    await renderWithProviders(
      <SuggestionList
        items={[{ id: "a", label: "Table", select: () => undefined }]}
        label="Blocks"
        emptyText="Nothing"
        hints="↑↓ select · ↵ insert · Esc close"
      />,
    );
    expect(screen.getByText("↑↓ select · ↵ insert · Esc close")).toBeTruthy();
  });
});
