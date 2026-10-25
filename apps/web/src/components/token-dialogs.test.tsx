import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { CreateTokenDialog, expiryChoices, type TokenRequest } from "./token-dialogs.js";
import { shortRights, tokenRights } from "./token-table.js";

beforeEach(() => {
  mockApi({ "GET /api/v1/auth/session": () => problem(401, "notSignedIn") });
});

function renderDialog(
  maxLifetimeDays: number | null,
  onCreate = vi.fn(async (_: TokenRequest) => ({ token: "ld_secret" })),
) {
  return renderWithProviders(
    <PreferencesProvider>
      <CreateTokenDialog
        open
        onOpenChange={() => {}}
        allowInstance={false}
        allowOrganization
        maxLifetimeDays={maxLifetimeDays}
        onCreate={onCreate}
      />
    </PreferencesProvider>,
  ).then(() => onCreate);
}

describe("token expiry", () => {
  it("offers only choices within a maximum lifetime", () => {
    expect(expiryChoices(null)).toEqual(["never", "30", "90", "365", "custom"]);
    expect(expiryChoices(90)).toEqual(["30", "90", "custom"]);
    expect(expiryChoices(7)).toEqual(["custom"]);
  });

  it("preselects 90 days and warns when no expiry is chosen", async () => {
    const onCreate = await renderDialog(null);
    const expiry = screen.getByRole("radiogroup", { name: "Expires" });
    expect(within(expiry).getByRole("radio", { name: "90 days" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText(/A token without expiry works until someone revokes it/)).toBeNull();
    await userEvent.click(within(expiry).getByRole("radio", { name: "No expiry" }));
    expect(screen.getByText(/A token without expiry works until someone revokes it/)).toBeTruthy();
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
    expect(date.getAttribute("data-max")).toBe(latest);
  });
});

describe("content access of a token", () => {
  const organizationId = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f";
  const knowledgeBase = { id: "01929b1e-0000-7000-8000-0000000000b1", name: "Hilfe", key: "HELP" };

  async function open(onCreate = vi.fn(async (_: TokenRequest) => ({ token: "ld_secret" }))) {
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      "GET /api/v1/spaces": () => ({ body: { items: [knowledgeBase], nextCursor: null } }),
    });
    await renderWithProviders(
      <CreateTokenDialog
        open
        onOpenChange={() => {}}
        allowInstance={false}
        allowOrganization
        organizationId={organizationId}
        maxLifetimeDays={null}
        onCreate={onCreate}
      />,
    );
    await userEvent.type(screen.getByLabelText("Name"), "Help assistant");
    return onCreate;
  }

  it("turns the write level into the spaces area and the content level", async () => {
    const onCreate = await open();
    const content = screen.getByRole("radiogroup", { name: "Content" });
    await userEvent.click(within(content).getByRole("radio", { name: /Write drafts/ }));
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      scopes: { organization: { spaces: "manage" } },
      contentLevel: "draft",
    });
    expect(onCreate.mock.calls[0]?.[0].knowledgeBaseIds).toBeUndefined();
  });

  it("limits the token to chosen knowledge bases and asks for at least one", async () => {
    const onCreate = await open();
    const content = screen.getByRole("radiogroup", { name: "Content" });
    await userEvent.click(within(content).getByRole("radio", { name: /^Read/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Only selected knowledge bases" }));
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByText(/Choose at least one knowledge base/)).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("combobox", { name: "Knowledge bases" }));
    await userEvent.click(await screen.findByRole("option", { name: /Hilfe/ }));
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      scopes: { organization: { spaces: "view" } },
      contentLevel: "read",
      knowledgeBaseIds: [knowledgeBase.id],
    });
  });
});

describe("token summary", () => {
  const token = {
    scopes: { organization: { spaces: "view" as const } },
    contentLevel: "draft" as const,
    knowledgeBaseIds: ["01929b1e-0000-7000-8000-0000000000a1"],
  };

  it("names the knowledge bases a token is limited to", async () => {
    const { i18n } = await renderWithProviders(<span />);
    const t = i18n.getFixedT("en");
    const named = tokenRights(t, token, new Map([["01929b1e-0000-7000-8000-0000000000a1", "Help Center"]]));
    expect(shortRights(t, named)).toBe("Content: Write drafts in Help Center");
    expect(shortRights(t, tokenRights(t, token))).toBe("Content: Write drafts in 1 knowledge base");
  });

  it("names two rights and counts the rest", async () => {
    const { i18n } = await renderWithProviders(<span />);
    const t = i18n.getFixedT("en");
    const rights = tokenRights(t, {
      scopes: {
        organization: { spaces: "manage", membersAndGroups: "manage", settings: "view" },
        instance: { accounts: "view" },
      },
      contentLevel: "publish",
      knowledgeBaseIds: null,
    });
    expect(rights).toHaveLength(4);
    expect(shortRights(t, rights)).toMatch(/^Content: .+ · .+ · 2 more rights$/);
    expect(shortRights(t, [])).toBe("No rights");
  });
});

describe("instance rights", () => {
  it("stay disabled while the token is limited to one organization", async () => {
    const onCreate = vi.fn(async (_: TokenRequest) => ({ token: "ld_secret" }));
    await renderWithProviders(
      <CreateTokenDialog
        open
        onOpenChange={() => {}}
        allowInstance
        allowOrganization
        organizationId="0192f0e0-1a2b-7c3d-8e4f-5a6b7c8d9e01"
        organizationName="Northwind"
        maxLifetimeDays={null}
        onCreate={onCreate}
      />,
    );
    expect(screen.getByText(/Choose “All my organizations” above/)).toBeTruthy();
    expect(screen.getByText("Access to spaces and their pages is set above under Content.")).toBeTruthy();
    const users = screen.getByRole("radiogroup", { name: "Accounts" });
    for (const radio of within(users).getAllByRole("radio"))
      expect(radio.hasAttribute("disabled")).toBe(true);

    await userEvent.click(screen.getByRole("radio", { name: "All my organizations" }));
    expect(screen.queryByText(/Choose “All my organizations” above/)).toBeNull();
    await userEvent.click(within(users).getByRole("radio", { name: "View" }));
    await userEvent.type(screen.getByLabelText("Name"), "Automation");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      scopes: { instance: { accounts: "view" } },
      limitedToOrganization: false,
    });
  });
});
