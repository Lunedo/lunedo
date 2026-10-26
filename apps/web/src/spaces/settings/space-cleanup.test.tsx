import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../../testing/render.js";
import { BecomeAdministratorDialog } from "./become-administrator-dialog.js";
import { SpaceCleanup } from "./space-cleanup.js";

const ORGANIZATION = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f";
const SPACE = "01929b1e-0000-7000-8000-0000000000a1";

function orphaned(overrides: Record<string, unknown> = {}) {
  return {
    id: SPACE,
    key: "MSAB",
    kind: "confidential",
    storageBytes: 2048,
    pages: 12,
    lastActivityAt: "2026-08-01T15:00:00.000Z",
    orphanedAt: "2026-09-01T08:00:00.000Z",
    formerMembers: [
      { id: "01929b1e-0000-7000-8000-0000000000c1", name: "Anna Berger" },
      { id: "01929b1e-0000-7000-8000-0000000000c2", name: "Ben Koch" },
    ],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function show(items: unknown[], canManage = true) {
  const api = mockApi({
    [`GET /api/v1/organizations/${ORGANIZATION}/space-cleanup`]: () => ({
      body: { items, nextCursor: null, graceDays: 30 },
    }),
    [`POST /api/v1/organizations/${ORGANIZATION}/space-cleanup/${SPACE}/delete`]: () => ({ status: 204 }),
  });
  await renderWithProviders(
    <PreferencesProvider>
      <SpaceCleanup
        organizationId={ORGANIZATION}
        organizationName="Platform Team"
        canManage={canManage}
        canChangeSetting={canManage}
        settings={[]}
        onSettingChange={async () => undefined}
      />
    </PreferencesProvider>,
  );
  return api;
}

describe("cleaning up spaces without active members", () => {
  it("shows key, kind, numbers and former members, never a name", async () => {
    await show([
      orphaned(),
      orphaned({ id: "01929b1e-0000-7000-8000-0000000000a2", key: "P7K2", kind: "personal" }),
    ]);
    const table = await screen.findByRole("table", { name: "Spaces to clean up" });
    expect(within(table).getByText("MSAB")).toBeTruthy();
    expect(within(table).getByText("Confidential space")).toBeTruthy();
    expect(within(table).getByText("Personal space")).toBeTruthy();
    expect(within(table).getAllByText("Anna Berger, Ben Koch")).toHaveLength(2);
    expect(screen.getByText(/nobody active has been in them for 30 days/)).toBeTruthy();
  });

  it("deletes only after typing the key and giving a reason", async () => {
    const api = await show([orphaned()]);
    await userEvent.click(await screen.findByRole("button", { name: "Actions for MSAB" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete …" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete the space MSAB" });
    expect(within(dialog).getByText(/second stage of the trash/)).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText("Type MSAB to confirm"), "MSAB");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete space" }));
    expect(await within(dialog).findByText(/Name the reason/)).toBeTruthy();
    expect(api.requests.some((request) => request.method === "POST")).toBe(false);
    await userEvent.type(within(dialog).getByLabelText("Reason"), "Both people left");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete space" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "POST")?.body).toEqual({
        confirmation: "MSAB",
        reason: "Both people left",
      }),
    );
  });

  it("offers no deletion to people who may only view, and says when nothing is left", async () => {
    await show([orphaned()], false);
    await screen.findByRole("table", { name: "Spaces to clean up" });
    expect(screen.queryByRole("button", { name: "Actions for MSAB" })).toBeNull();
  });

  it("says when there is nothing to clean up", async () => {
    await show([]);
    expect(await screen.findByText("Nothing to clean up")).toBeTruthy();
  });
});

describe("becoming space admin", () => {
  it("asks for a reason before it sends anything and closes after success", async () => {
    const api = mockApi({
      [`POST /api/v1/organizations/${ORGANIZATION}/spaces/${SPACE}/self-appointment`]: () => ({
        status: 204,
      }),
    });
    const onClose = vi.fn();
    await renderWithProviders(
      <BecomeAdministratorDialog
        organizationId={ORGANIZATION}
        space={{ id: SPACE, key: "TH", name: "Team Handbook" }}
        onClose={onClose}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Become space admin of Team Handbook" });
    expect(within(dialog).getByText(/any space admin can remove it/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Become space admin" }));
    expect(await within(dialog).findByText(/Name the reason/)).toBeTruthy();
    expect(api.requests).toHaveLength(0);
    await userEvent.type(within(dialog).getByLabelText("Reason"), "The team asked for help");
    await userEvent.click(within(dialog).getByRole("button", { name: "Become space admin" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.requests[0]?.body).toEqual({ reason: "The team asked for help" });
    expect(await screen.findByText("You are now space admin of Team Handbook.")).toBeTruthy();
  });

  it("shows why it failed and stays open", async () => {
    mockApi({
      [`POST /api/v1/organizations/${ORGANIZATION}/spaces/${SPACE}/self-appointment`]: () =>
        problem(409, "alreadyAdministrator"),
    });
    const onClose = vi.fn();
    await renderWithProviders(
      <BecomeAdministratorDialog
        organizationId={ORGANIZATION}
        space={{ id: SPACE, key: "TH", name: "Team Handbook" }}
        onClose={onClose}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Become space admin of Team Handbook" });
    await userEvent.type(within(dialog).getByLabelText("Reason"), "Help");
    await userEvent.click(within(dialog).getByRole("button", { name: "Become space admin" }));
    expect(await within(dialog).findByText(/You already are space admin of this space/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
