import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../../api/queries.js";
import { mockApi, renderWithProviders } from "../../testing/render.js";
import { InviteDialog } from "./invite-dialog.js";

const ORGANIZATION_ID = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f";

describe("InviteDialog", () => {
  it("shows missing and invalid addresses at the field, moves focus there and sends nothing", async () => {
    const { requests } = mockApi({
      [`GET /api/v1/organizations/${ORGANIZATION_ID}/roles`]: () => ({
        body: { items: [], nextCursor: null },
      }),
    });
    await renderWithProviders(
      <InviteDialog
        open
        onOpenChange={() => undefined}
        organizationId={ORGANIZATION_ID}
        organizationName="Platform Team"
      />,
      "en",
      (queryClient) =>
        queryClient.setQueryData(queryKeys.session, {
          sessionKind: "full",
          account: {
            id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
            email: "olivia@example.org",
            name: "Olivia",
          },
          methods: ["password"],
          recentlyAuthenticated: true,
        }),
    );
    const dialog = screen.getByRole("dialog", { name: "Invite people" });
    const addresses = within(dialog).getByLabelText("E-mail addresses");
    await userEvent.click(within(dialog).getByRole("button", { name: /Send/ }));
    await waitFor(() => expect(document.activeElement).toBe(addresses));
    expect(addresses.getAttribute("aria-invalid")).toBe("true");
    expect(within(dialog).getByText("Enter at least one e-mail address.")).toBeTruthy();
    expect(within(dialog).queryByText(/Not every invitation was sent/)).toBeNull();
    await userEvent.type(addresses, "lena@example.org, not-an-address");
    await userEvent.click(within(dialog).getByRole("button", { name: /Send/ }));
    expect(within(dialog).getByText(/These addresses are not valid: not-an-address/)).toBeTruthy();
    expect(requests.some((request) => request.method === "POST")).toBe(false);
  });
});
