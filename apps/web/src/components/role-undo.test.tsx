import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { mockApi, renderWithProviders } from "../testing/render.js";
import { type RemovableAssignment, useUnassignWithUndo } from "./role-undo.js";

const ORGANIZATION = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f";
const ASSIGNMENT = "01929b1e-0000-7000-8000-0000000000dd";
const GROUP = "01929b1e-0000-7000-8000-0000000000aa";
const ROLE = "01929b1e-0000-7000-8000-0000000000ee";

function Probe({
  assignment,
  onChanged,
}: {
  assignment: RemovableAssignment;
  onChanged: () => Promise<void>;
}) {
  const unassign = useUnassignWithUndo({ organizationId: ORGANIZATION }, onChanged);
  return (
    <button
      type="button"
      onClick={() => void unassign(assignment, "Editors no longer has the role Readers.")}
    >
      Remove role
    </button>
  );
}

describe("useUnassignWithUndo", () => {
  it("removes the assignment at once and gives it back with the same role, holder and end on undo", async () => {
    const { requests } = mockApi({
      [`DELETE /api/v1/organizations/${ORGANIZATION}/role-assignments/${ASSIGNMENT}`]: () => ({
        status: 204,
      }),
      [`POST /api/v1/organizations/${ORGANIZATION}/role-assignments`]: () => ({ status: 201, body: {} }),
    });
    const onChanged = vi.fn(async () => undefined);
    await renderWithProviders(
      <Probe
        onChanged={onChanged}
        assignment={{
          id: ASSIGNMENT,
          builtInRole: null,
          customRoleId: ROLE,
          principalKind: "group",
          principalId: GROUP,
          expiresAt: "2099-01-01T00:00:00.000Z",
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove role" }));
    expect(await screen.findByText("Editors no longer has the role Readers.")).toBeTruthy();
    expect(requests.map((request) => request.method)).toEqual(["DELETE"]);
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(requests.map((request) => request.method)).toEqual(["DELETE", "POST"]));
    expect(requests[1]?.body).toEqual({
      role: { customRoleId: ROLE },
      principal: { kind: "group", id: GROUP },
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("offers no undo for an assignment that cannot be given again", async () => {
    mockApi({
      [`DELETE /api/v1/organizations/${ORGANIZATION}/role-assignments/${ASSIGNMENT}`]: () => ({
        status: 204,
      }),
    });
    await renderWithProviders(
      <Probe
        onChanged={async () => undefined}
        assignment={{
          id: ASSIGNMENT,
          builtInRole: "administrator",
          principalKind: "account",
          principalId: GROUP,
          expiresAt: "2000-01-01T00:00:00.000Z",
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove role" }));
    expect(await screen.findByText("Editors no longer has the role Readers.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});
