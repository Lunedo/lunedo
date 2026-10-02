import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { CreateTokenDialog, expiryChoices, type TokenRequest } from "./token-dialogs.js";

beforeEach(() => {
  mockApi({ "GET /api/v1/auth/session": () => problem(401, "notSignedIn") });
});

function renderDialog(
  maxLifetimeDays: number | null,
  onCreate = vi.fn(async (_: TokenRequest) => ({ token: "ph_secret" })),
) {
  return renderWithProviders(
    <CreateTokenDialog
      open
      onOpenChange={() => {}}
      allowInstance={false}
      allowOrganization
      maxLifetimeDays={maxLifetimeDays}
      onCreate={onCreate}
    />,
  ).then(() => onCreate);
}

describe("token expiry", () => {
  it("offers only choices within a maximum lifetime", () => {
    expect(expiryChoices(null)).toEqual(["never", "30", "90", "365", "custom"]);
    expect(expiryChoices(90)).toEqual(["30", "90", "custom"]);
    expect(expiryChoices(7)).toEqual(["custom"]);
  });

  it("preselects no expiry when no maximum applies", async () => {
    const onCreate = await renderDialog(null);
    const expiry = screen.getByRole("radiogroup", { name: "Expires" });
    expect(within(expiry).getByRole("radio", { name: "No expiry" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    await userEvent.type(screen.getByLabelText("Name"), "Deploy");
    await userEvent.click(
      within(screen.getByRole("radiogroup", { name: "Members and groups" })).getByRole("radio", {
        name: "View",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0]?.[0].expiresAt).toBeNull();
  });

  it("keeps a custom date within the maximum", async () => {
    await renderDialog(30);
    const expiry = screen.getByRole("radiogroup", { name: "Expires" });
    expect(within(expiry).queryByRole("radio", { name: "No expiry" })).toBeNull();
    expect(within(expiry).queryByRole("radio", { name: "90 days" })).toBeNull();
    expect(screen.getByText("Tokens may live at most 30 days here.")).toBeTruthy();
    await userEvent.click(within(expiry).getByRole("radio", { name: "Custom date" }));
    const date = screen.getByLabelText("Expires on");
    const latest = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    expect(date.getAttribute("max")).toBe(latest);
  });
});
