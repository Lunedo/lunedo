import { organizationNameSchema } from "@pagehall/shared";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { AutoSaveTextField } from "./auto-save.js";

beforeEach(() => {
  mockApi({ "GET /api/v1/auth/session": () => problem(401, "notSignedIn") });
});

describe("AutoSaveTextField", () => {
  it("saves on Enter and on blur, and only when the value changed", async () => {
    const onSave = vi.fn(async () => undefined);
    await renderWithProviders(
      <AutoSaveTextField label="Name" value="Platform" schema={organizationNameSchema} onSave={onSave} />,
    );
    const input = screen.getByRole("textbox", { name: "Name" });
    await userEvent.click(input);
    await userEvent.tab();
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.type(input, " Team{Enter}");
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Platform Team"));
    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  it("shows validation errors at the field without saving", async () => {
    const onSave = vi.fn(async () => undefined);
    await renderWithProviders(
      <AutoSaveTextField label="Name" value="Platform" schema={organizationNameSchema} onSave={onSave} />,
    );
    const input = screen.getByRole("textbox", { name: "Name" });
    await userEvent.clear(input);
    await userEvent.tab();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("This field is required.")).toBeTruthy();
  });
});
