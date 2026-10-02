import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Combobox, type ComboboxItem, type ComboboxLoader, matchesQuery } from "./combobox.js";
import { renderUi } from "./testing/render.js";
import { timeZoneItem } from "./time-zone-combobox.js";

const PEOPLE: ComboboxItem[] = [
  { value: "anna", label: "Anna Roth", description: "anna@example.org" },
  { value: "jonas", label: "Jonas Weber", description: "jonas@example.org" },
  { value: "lena", label: "Lena Höfer", description: "lena@example.org", keywords: ["Admin"] },
  { value: "tomas", label: "Tomas Kern", description: "tomas@example.org" },
];

function Single({ onChange = () => {} }: { onChange?: (value: string | null) => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <Combobox
      aria-label="Person"
      items={PEOPLE}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function Multi({ load }: { load?: ComboboxLoader }) {
  const [value, setValue] = useState<string[]>(["anna"]);
  return (
    <Combobox
      multiple
      aria-label="People"
      {...(load ? { load, debounceMs: 0 } : { items: PEOPLE })}
      selectedItems={PEOPLE.filter((person) => value.includes(person.value))}
      value={value}
      onValueChange={setValue}
    />
  );
}

describe("matchesQuery", () => {
  it("matches every word in label, description and keywords, ignoring case and accents", () => {
    const lena = PEOPLE[2] as ComboboxItem;
    expect(matchesQuery(lena, "hofer")).toBe(true);
    expect(matchesQuery(lena, "lena admin")).toBe(true);
    expect(matchesQuery(lena, "lena owner")).toBe(false);
  });
});

describe("timeZoneItem", () => {
  it("finds renamed time zones by their current and their former names", () => {
    const now = new Date(Date.UTC(2026, 9, 2, 12));
    for (const [zone, query] of [
      ["Asia/Calcutta", "Kolkata"],
      ["Asia/Kolkata", "Calcutta"],
      ["Europe/Kiev", "Kyiv"],
      ["Asia/Saigon", "Ho Chi Minh"],
      ["Asia/Rangoon", "Yangon"],
      ["Asia/Katmandu", "Kathmandu"],
    ] as const) {
      expect(matchesQuery(timeZoneItem(zone, now, "en"), query), zone).toBe(true);
    }
  });
});

describe("Combobox", () => {
  it("filters as you type and chooses with the keyboard", async () => {
    const onChange = vi.fn();
    renderUi(<Single onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Person" });
    await userEvent.type(input, "o");
    const listbox = screen.getByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Anna Rothanna@example.org",
      "Jonas Weberjonas@example.org",
      "Lena Höferlena@example.org",
      "Tomas Kerntomas@example.org",
    ]);
    await userEvent.type(input, "na");
    expect(within(listbox).getAllByRole("option")).toHaveLength(1);
    await userEvent.clear(input);
    await userEvent.keyboard("{End}");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      within(listbox).getAllByRole("option")[3]?.getAttribute("id"),
    );
    await userEvent.keyboard("{Home}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("jonas");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect((input as HTMLInputElement).value).toBe("Jonas Weber");
  });

  it("closes with Escape and shows a clear empty state", async () => {
    renderUi(<Single />);
    const input = screen.getByRole("combobox", { name: "Person" });
    await userEvent.type(input, "nobody here");
    expect(screen.getByRole("status").textContent).toBe("No matches");
    await userEvent.keyboard("{Escape}");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps several values as chips that can be removed with the button or Backspace", async () => {
    renderUi(<Multi />);
    expect(screen.getByRole("button", { name: "Remove Anna Roth" })).toBeTruthy();
    const input = screen.getByRole("combobox", { name: "People" });
    await userEvent.type(input, "lena{Enter}");
    expect(screen.getByRole("button", { name: "Remove Lena Höfer" })).toBeTruthy();
    expect(screen.getByRole("listbox").getAttribute("aria-multiselectable")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Remove Anna Roth" }));
    expect(screen.queryByRole("button", { name: "Remove Anna Roth" })).toBeNull();
    await userEvent.click(input);
    await userEvent.keyboard("{Backspace}");
    expect(screen.queryByRole("button", { name: "Remove Lena Höfer" })).toBeNull();
  });

  it("searches on the server and loads further pages", async () => {
    const load = vi.fn<ComboboxLoader>(async (query, cursor) => {
      const matches = PEOPLE.filter((person) => matchesQuery(person, query));
      return cursor
        ? { items: matches.slice(2), nextCursor: null }
        : { items: matches.slice(0, 2), nextCursor: matches.length > 2 ? "2" : null };
    });
    renderUi(<Multi load={load} />);
    const input = screen.getByRole("combobox", { name: "People" });
    await userEvent.click(input);
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    expect(load).toHaveBeenLastCalledWith("", null);
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(4));
    expect(load).toHaveBeenLastCalledWith("", "2");
    await userEvent.type(input, "tomas");
    await waitFor(() => expect(load).toHaveBeenLastCalledWith("tomas", null));
    await waitFor(() => expect(screen.getAllByRole("option").map((option) => option.id)).toHaveLength(1));
  });

  it("shows only the newest answer when searches overlap", async () => {
    const pending: ((page: { items: ComboboxItem[] }) => void)[] = [];
    const load: ComboboxLoader = () => new Promise((resolve) => pending.push(resolve));
    renderUi(<Multi load={load} />);
    const input = screen.getByRole("combobox", { name: "People" });
    await userEvent.click(input);
    await userEvent.type(input, "t");
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[1]?.({ items: [PEOPLE[3] as ComboboxItem] }));
    await act(async () => pending[0]?.({ items: PEOPLE }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Tomas Kerntomas@example.org",
    ]);
  });

  it("opens a list at least as wide as its field", async () => {
    renderUi(<Single />);
    await userEvent.click(screen.getByRole("combobox", { name: "Person" }));
    const content = document.querySelector("[data-combobox-content]");
    expect(content?.className).toContain("min-w-popover-trigger");
  });
});
