import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { mockApi, renderWithProviders } from "../../testing/render.js";
import { AssignRoleDialog } from "./roles.js";

const ORGANIZATION_ID = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f";
const ANNA = "01929b1e-0000-7000-8000-00000000000a";
const GROUP = "01929b1e-0000-7000-8000-0000000000aa";
const LENA = "01929b1e-0000-7000-8000-00000000000b";

function api() {
  return mockApi({
    "GET /api/v1/organizations/01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f/roles": () => ({
      body: { items: [], nextCursor: null },
    }),
    "GET /api/v1/organizations/01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f/members": () => ({
      body: {
        items: [
          {
            accountId: ANNA,
            name: "Anna Roth",
            email: "anna@example.org",
            accountType: "standard",
            kind: "member",
            expiresAt: null,
            responsibleAccountId: null,
            roles: [],
          },
        ],
        nextCursor: null,
      },
    }),
    "GET /api/v1/organizations/01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f/groups": () => ({
      body: {
        items: [{ id: GROUP, organizationId: ORGANIZATION_ID, name: "Auditors", description: null }],
        nextCursor: null,
      },
    }),
    "GET /api/v1/groups/01929b1e-0000-7000-8000-0000000000aa/members": () => ({
      body: { items: [{ accountId: LENA, name: "Lena Höfer", email: "lena@example.org" }], nextCursor: null },
    }),
    "POST /api/v1/organizations/01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f/role-assignments/batch": () => ({
      status: 201,
      body: { items: [] },
    }),
  });
}

describe("AssignRoleDialog", () => {
  it("gives a role to several people and groups at once", async () => {
    const { requests } = api();
    const onOpenChange = vi.fn();
    await renderWithProviders(
      <AssignRoleDialog
        open
        onOpenChange={onOpenChange}
        organizationId={ORGANIZATION_ID}
        organizationName="Platform Team"
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Give a role" });
    expect(within(dialog).queryByText("All members of the organization")).toBeNull();
    const principals = within(dialog).getByRole("combobox", { name: "People and groups" });
    await userEvent.click(principals);
    await userEvent.click(await screen.findByRole("option", { name: /Anna Roth/ }));
    await userEvent.click(await screen.findByRole("option", { name: /Auditors/ }));
    await waitFor(() =>
      expect(within(dialog).getByRole("list", { name: "People who gain access" }).textContent).toContain(
        "Lena Höfer",
      ),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Give role" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const batch = requests.find((request) => request.path.endsWith("/role-assignments/batch"));
    expect(batch?.body).toEqual({
      role: { builtIn: "administrator" },
      principals: [
        { kind: "account", id: ANNA },
        { kind: "group", id: GROUP },
      ],
    });
  });
});
