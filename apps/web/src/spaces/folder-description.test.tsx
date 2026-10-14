import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../testing/render.js";
import { FolderDescription } from "./folder-description.js";

describe("the folder description", () => {
  it("reads as text with a placeholder and becomes a field on click", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    await renderWithProviders(<FolderDescription value="" onSave={onSave} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Edit the description of the folder" }));
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
    await userEvent.click(screen.getByRole("button", { name: "Edit the description of the folder" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Description" }), " and more");
    await userEvent.keyboard("{Escape}");
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Runbooks")).toBeTruthy();
  });

  it("stays open and says what failed when saving fails", async () => {
    const onSave = vi.fn(() => Promise.reject(new Error("offline")));
    await renderWithProviders(<FolderDescription value="" onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit the description of the folder" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Description" }), "Text");
    await userEvent.tab();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Description" })).toBeTruthy());
    expect(screen.getByRole("textbox", { name: "Description" }).getAttribute("aria-invalid")).toBe("true");
  });
});
