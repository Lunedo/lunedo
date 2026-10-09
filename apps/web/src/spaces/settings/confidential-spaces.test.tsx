import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../../preferences/preferences-provider.js";
import { mockApi, renderWithProviders } from "../../testing/render.js";
import { ConfidentialSpaces } from "./confidential-spaces.js";

const ORGANIZATION = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f";
const SPACE = "01929b1e-0000-7000-8000-0000000000a1";
const REMAINING = "01929b1e-0000-7000-8000-0000000000c1";

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: SPACE,
    key: "MSAB",
    createdAt: "2026-10-01T08:00:00.000Z",
    members: 2,
    activeMembers: 1,
    pages: 12,
    lastChangedAt: "2026-10-08T15:00:00.000Z",
    needsAdministrator: true,
    deletable: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function show(items: unknown[], canManage = true) {
  const api = mockApi({
    [`GET /api/v1/organizations/${ORGANIZATION}/confidential-spaces`]: () => ({
      body: { items, nextCursor: null },
    }),
    [`GET /api/v1/organizations/${ORGANIZATION}/confidential-spaces/${SPACE}/remaining-members`]: () => ({
      body: [{ id: REMAINING, name: "Anna Berger" }],
    }),
    [`POST /api/v1/organizations/${ORGANIZATION}/confidential-spaces/${SPACE}/administrator`]: () => ({
      status: 204,
    }),
    [`POST /api/v1/organizations/${ORGANIZATION}/confidential-spaces/${SPACE}/delete`]: () => ({
      status: 204,
    }),
  });
  await renderWithProviders(
    <PreferencesProvider>
      <ConfidentialSpaces organizationId={ORGANIZATION} canManage={canManage} />
    </PreferencesProvider>,
  );
  return api;
}

describe("confidential spaces in the organization settings", () => {
  it("show the key and numbers only, and offer an appointment from the remaining members", async () => {
    const api = await show([summary()]);
    expect(await screen.findByText("MSAB")).toBeTruthy();
    expect(screen.getByText(/2 members · 12 pages/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Appoint space admin" }));
    const dialog = await screen.findByRole("dialog", { name: "Appoint a space admin for MSAB" });
    const options = await within(dialog).findAllByRole("radio");
    expect(options).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole("button", { name: "Appoint as space admin" }));
    expect(await within(dialog).findByText("Choose a member.")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("radio", { name: "Anna Berger" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Appoint as space admin" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "POST")?.body).toEqual({
        accountId: REMAINING,
      }),
    );
  });

  it("delete a space without members only after typing its key and giving a reason", async () => {
    const api = await show([summary({ needsAdministrator: false, deletable: true, activeMembers: 0 })]);
    await userEvent.click(await screen.findByRole("button", { name: "Delete space" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete the confidential space MSAB" });
    await userEvent.type(within(dialog).getByLabelText("Type MSAB to confirm"), "MSAB");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete space permanently" }));
    expect(await within(dialog).findByText(/Name the reason/)).toBeTruthy();
    expect(api.requests.some((request) => request.method === "POST")).toBe(false);
    await userEvent.type(within(dialog).getByLabelText("Reason"), "Both people left");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete space permanently" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "POST")?.body).toEqual({
        confirmation: "MSAB",
        reason: "Both people left",
      }),
    );
  });

  it("offer no actions to people who may only view", async () => {
    await show([summary({ deletable: true })], false);
    expect(await screen.findByText("MSAB")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Appoint space admin" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete space" })).toBeNull();
  });
});
