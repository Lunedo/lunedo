import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../../preferences/preferences-provider.js";
import { mockApi, renderWithProviders } from "../../testing/render.js";
import { ConfidentialSpaces, DeletedConfidentialNotice } from "./confidential-spaces.js";

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

  it("offer no actions to people who may only view", async () => {
    await show([summary()], false);
    expect(await screen.findByText("MSAB")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Appoint space admin" })).toBeNull();
  });
});

describe("personal spaces of deactivated people in the organization settings", () => {
  it("offer an appointment from the remaining members through the personal space routes", async () => {
    const api = mockApi({
      [`GET /api/v1/organizations/${ORGANIZATION}/personal-spaces`]: () => ({
        body: { items: [summary({ key: "P7K2M9QX" })], nextCursor: null },
      }),
      [`GET /api/v1/organizations/${ORGANIZATION}/personal-spaces/${SPACE}/remaining-members`]: () => ({
        body: [{ id: REMAINING, name: "Anna Berger" }],
      }),
      [`POST /api/v1/organizations/${ORGANIZATION}/personal-spaces/${SPACE}/administrator`]: () => ({
        status: 204,
      }),
    });
    await renderWithProviders(
      <PreferencesProvider>
        <ConfidentialSpaces organizationId={ORGANIZATION} canManage kind="personal" />
      </PreferencesProvider>,
    );
    expect(await screen.findByText("Personal spaces of deactivated people")).toBeTruthy();
    await userEvent.click(await screen.findByRole("button", { name: "Appoint space admin" }));
    const dialog = await screen.findByRole("dialog", { name: "Appoint a space admin for P7K2M9QX" });
    await userEvent.click(await within(dialog).findByRole("radio", { name: "Anna Berger" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Appoint as space admin" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "POST")?.path).toBe(
        `/api/v1/organizations/${ORGANIZATION}/personal-spaces/${SPACE}/administrator`,
      ),
    );
  });

  it("stay out of the way while there are none", async () => {
    const api = mockApi({
      [`GET /api/v1/organizations/${ORGANIZATION}/personal-spaces`]: () => ({
        body: { items: [], nextCursor: null },
      }),
    });
    await renderWithProviders(
      <PreferencesProvider>
        <ConfidentialSpaces organizationId={ORGANIZATION} canManage kind="personal" />
      </PreferencesProvider>,
    );
    await waitFor(() =>
      expect(api.requests.some((request) => request.path.includes("/personal-spaces"))).toBe(true),
    );
    expect(screen.queryByText("Personal spaces of deactivated people")).toBeNull();
  });
});

describe("deleted confidential spaces in the organization trash", () => {
  it("are counted only, with who can restore them", async () => {
    mockApi({
      [`GET /api/v1/organizations/${ORGANIZATION}/trash/confidential-spaces`]: () => ({
        body: { deleted: 2 },
      }),
    });
    await renderWithProviders(<DeletedConfidentialNotice organizationId={ORGANIZATION} />);
    expect(await screen.findByText("2 deleted confidential spaces")).toBeTruthy();
    expect(screen.getByText(/Only the people who were their space admins can restore them/)).toBeTruthy();
  });

  it("are not mentioned when there are none", async () => {
    const api = mockApi({
      [`GET /api/v1/organizations/${ORGANIZATION}/trash/confidential-spaces`]: () => ({
        body: { deleted: 0 },
      }),
    });
    await renderWithProviders(<DeletedConfidentialNotice organizationId={ORGANIZATION} />);
    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(screen.queryByText(/deleted confidential/)).toBeNull();
  });
});
