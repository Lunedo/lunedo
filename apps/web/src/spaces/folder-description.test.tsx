import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../testing/render.js";
import { FolderDescription, ReadOnlyFolderDescription } from "./folder-description.js";

describe("the folder description", () => {
  it("reads as text with a placeholder and becomes a field on click", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    await renderWithProviders(<FolderDescription value="" onSave={onSave} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Add a description" }));
    const field = screen.getByRole("textbox", { name: "Description" });
    expect(document.activeElement).toBe(field);
    await userEvent.type(field, "Runbooks for the on-call team");
    await userEvent.tab();
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Runbooks for the on-call team"));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });

  it("shows the saved text and leaves it unchanged on Escape", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    await renderWithProviders(<FolderDescription value="Runbooks" onSave={onSave} />);
    expect(screen.getByText("Runbooks")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Edit the description of the folder: Runbooks" }),
    );
    await userEvent.type(screen.getByRole("textbox", { name: "Description" }), " and more");
    await userEvent.keyboard("{Escape}");
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Runbooks")).toBeTruthy();
  });

  it("stays open and says what failed when saving fails", async () => {
    const onSave = vi.fn(() => Promise.reject(new Error("offline")));
    await renderWithProviders(<FolderDescription value="" onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: "Add a description" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Description" }), "Text");
    await userEvent.tab();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Description" })).toBeTruthy());
    expect(screen.getByRole("textbox", { name: "Description" }).getAttribute("aria-invalid")).toBe("true");
  });
});

describe("the introduction of a knowledge base category", () => {
  const intro =
    "Notebooks and software.\n\n> Urgent: call **+43 1 555 0100** or [write](mailto:it@example.org).";

  it("shows the text without markup on the edit button", async () => {
    await renderWithProviders(<FolderDescription value={intro} formatted onSave={vi.fn()} />);
    const button = screen.getByRole("button", {
      name: "Edit the description of the folder: Notebooks and software. Urgent: call +43 1 555 0100 or write.",
    });
    expect(button.textContent).not.toContain("**");
    expect(button.textContent).not.toContain(">");
  });

  it("shows bold text, links and the note to readers", async () => {
    await renderWithProviders(<ReadOnlyFolderDescription value={intro} formatted />);
    expect(screen.getByText("+43 1 555 0100").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "write" }).getAttribute("href")).toBe("mailto:it@example.org");
    expect(document.body.textContent).not.toContain("**");
  });

  it("keeps the text of an ordinary folder as written", async () => {
    await renderWithProviders(<ReadOnlyFolderDescription value="Use **bold** here" formatted={false} />);
    expect(screen.getByText("Use **bold** here")).toBeTruthy();
  });
});
