import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiToken } from "../api/account-queries.js";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { CreateTokenDialog, expiryChoices, type TokenRequest, TokenRightsDialog } from "./token-dialogs.js";
import { rightLabels, TokenTable, tokenRights } from "./token-table.js";

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

async function openDetails() {
  await userEvent.click(screen.getByRole("button", { name: /^Rights in detail/ }));
}

async function chooseExpiry(label: string) {
  await userEvent.click(screen.getByRole("combobox", { name: "Expires" }));
  await userEvent.click(await screen.findByRole("option", { name: label }));
}

describe("token expiry", () => {
  it("offers only choices within a maximum lifetime", () => {
    expect(expiryChoices(null)).toEqual(["never", "30", "90", "365", "custom"]);
    expect(expiryChoices(90)).toEqual(["30", "90", "custom"]);
    expect(expiryChoices(7)).toEqual(["custom"]);
  });

  it("preselects 90 days and warns when the token never expires", async () => {
    const onCreate = await renderDialog(null);
    expect(screen.getByRole("combobox", { name: "Expires" }).textContent).toContain("90 days");
    const summary = screen.getByRole("complementary", { name: "Summary of the token" });
    expect(within(summary).getByText("Expires in 90 days")).toBeTruthy();
    expect(screen.queryByText(/A token without expiry works until someone revokes it/)).toBeNull();
    await chooseExpiry("Never");
    expect(screen.getByText(/A token without expiry works until someone revokes it/)).toBeTruthy();
    expect(within(summary).getByText("Never expires")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Name"), "Deploy");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0]?.[0].expiresAt).toBeNull();
  });

  it("keeps a custom date within the maximum", async () => {
    await renderDialog(30);
    await userEvent.click(screen.getByRole("combobox", { name: "Expires" }));
    expect(screen.queryByRole("option", { name: "Never" })).toBeNull();
    expect(screen.queryByRole("option", { name: "90 days" })).toBeNull();
    await userEvent.click(await screen.findByRole("option", { name: "Custom date" }));
    expect(screen.getByText("Tokens may live at most 30 days here.")).toBeTruthy();
    const date = screen.getByLabelText("Expires on");
    const latest = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    expect(date.getAttribute("data-max")).toBe(latest);
  });

  it("asks for a name on create instead of disabling the button", async () => {
    const onCreate = await renderDialog(null);
    const create = screen.getByRole("button", { name: "Create token" });
    expect(create.hasAttribute("disabled")).toBe(false);
    await userEvent.click(create);
    await waitFor(() => expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBe("true"));
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe("token templates", () => {
  it("start with read only and set the rights of the chosen template", async () => {
    const onCreate = await renderDialog(null);
    const purpose = screen.getByRole("radiogroup", { name: "What for" });
    expect(within(purpose).getByRole("radio", { name: "Read only" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    const summary = screen.getByRole("complementary", { name: "Summary of the token" });
    expect(within(summary).getByText("Content: Read (everything you may read)")).toBeTruthy();

    await userEvent.click(within(purpose).getByRole("radio", { name: "Automate administration" }));
    expect(within(summary).getByText("Members and groups: manage")).toBeTruthy();
    expect(within(summary).getByText("Settings: read")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "What “Automate administration” allows" }));
    expect(await screen.findByText(/Manages members and groups/)).toBeTruthy();
    await userEvent.keyboard("{Escape}");

    await openDetails();
    await userEvent.click(
      within(screen.getByRole("radiogroup", { name: "Audit log" })).getByRole("radio", { name: "Read" }),
    );
    expect(within(purpose).getByRole("radio", { name: "Custom" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.type(screen.getByLabelText("Name"), "Provisioning");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      scopes: {
        organization: { membersAndGroups: "manage", settings: "view", auditLog: "view", spaces: "view" },
      },
      contentLevel: "read",
    });
  });

  it("asks for at least one right when everything is off", async () => {
    const onCreate = await renderDialog(null);
    await openDetails();
    await userEvent.click(
      within(screen.getByRole("radiogroup", { name: "Content" })).getByRole("radio", { name: "None" }),
    );
    await userEvent.type(screen.getByLabelText("Name"), "Empty");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByText("Choose at least one area.")).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe("content access of a token", () => {
  const organizationId = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f";
  const knowledgeBase = {
    id: "01929b1e-0000-7000-8000-0000000000b1",
    name: "Hilfe",
    displayName: "Hilfe",
    key: "HELP",
  };

  async function open(onCreate = vi.fn(async (_: TokenRequest) => ({ token: "ld_secret" }))) {
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      "GET /api/v1/spaces": () => ({ body: { items: [knowledgeBase], nextCursor: null } }),
    });
    await renderWithProviders(
      <PreferencesProvider>
        <CreateTokenDialog
          open
          onOpenChange={() => {}}
          allowInstance={false}
          allowOrganization
          organizationId={organizationId}
          maxLifetimeDays={null}
          onCreate={onCreate}
        />
      </PreferencesProvider>,
    );
    await userEvent.type(screen.getByLabelText("Name"), "Help assistant");
    await openDetails();
    return onCreate;
  }

  it("turns the write level into the spaces area and the content level", async () => {
    const onCreate = await open();
    const content = screen.getByRole("radiogroup", { name: "Content" });
    await userEvent.click(within(content).getByRole("radio", { name: "Drafts" }));
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
    expect(screen.getByRole("heading", { name: "Which content" })).toBeTruthy();
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

describe("changing the rights of a token", () => {
  const token = {
    id: "01929b1e-0000-7000-8000-0000000000c1",
    accountId: "01929b1e-0000-7000-8000-0000000000c2",
    organizationId: "01929b1e-0000-7000-8000-0000000000c3",
    name: "Importer",
    prefix: "ld_abc",
    scopes: { organization: { spaces: "manage" as const, settings: "view" as const } },
    contentLevel: "publish" as const,
    knowledgeBaseIds: null,
    expiresAt: null,
    lastUsedAt: null,
    createdAt: "2026-10-01T09:00:00.000Z",
  } as unknown as ApiToken;

  it("uses the same rights view and changes only the content access", async () => {
    const onSave = vi.fn(async () => {});
    await renderWithProviders(
      <PreferencesProvider>
        <TokenRightsDialog
          token={token}
          allowInstance={false}
          organizationName="Northwind"
          onOpenChange={() => {}}
          onSave={onSave}
        />
      </PreferencesProvider>,
    );
    expect(screen.getByRole("heading", { name: "Rights of Importer" })).toBeTruthy();
    const summary = screen.getByRole("complementary", { name: "Summary of the token" });
    expect(within(summary).getByText("Settings: read")).toBeTruthy();
    expect(within(summary).getByText(/Never expires · Only Northwind/)).toBeTruthy();
    const settings = within(screen.getByRole("radiogroup", { name: "Settings" })).getAllByRole("radio");
    for (const radio of settings) expect(radio.hasAttribute("disabled")).toBe(true);
    const content = screen.getByRole("radiogroup", { name: "Content" });
    expect(within(content).queryByRole("radio", { name: "None" })).toBeNull();
    await userEvent.click(within(content).getByRole("radio", { name: "Drafts" }));
    await userEvent.click(screen.getByRole("button", { name: "Save content access" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ contentLevel: "draft", knowledgeBaseIds: null }),
    );
  });

  it("keeps a read token from choosing a writing level", async () => {
    await renderWithProviders(
      <PreferencesProvider>
        <TokenRightsDialog
          token={{ ...token, scopes: { organization: { spaces: "view" } }, contentLevel: "read" } as ApiToken}
          allowInstance={false}
          organizationName="Northwind"
          onOpenChange={() => {}}
          onSave={vi.fn(async () => {})}
        />
      </PreferencesProvider>,
    );
    const drafts = within(screen.getByRole("radiogroup", { name: "Content" })).getByRole("radio", {
      name: "Drafts",
    });
    expect(drafts.getAttribute("aria-disabled")).toBe("true");
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
    expect(rightLabels(t, named)).toEqual(["Content: Write drafts in Help Center"]);
    expect(rightLabels(t, tokenRights(t, token))).toEqual(["Content: Write drafts in 1 knowledge base"]);
  });

  it("names every right, the content first", async () => {
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
    expect(rightLabels(t, rights)).toHaveLength(4);
    expect(rightLabels(t, rights)[0]).toMatch(/^Content: /);
  });
});

describe("the rights of a token in the list", () => {
  it("shows the first right and the others in a popover", async () => {
    const token = {
      id: "01929b1e-0000-7000-8000-0000000000c1",
      accountId: "01929b1e-0000-7000-8000-0000000000c2",
      organizationId: "01929b1e-0000-7000-8000-0000000000c3",
      name: "Importer",
      prefix: "ld_abc",
      scopes: { organization: { spaces: "manage", membersAndGroups: "manage", settings: "view" } },
      contentLevel: "publish",
      knowledgeBaseIds: null,
      expiresAt: null,
      lastUsedAt: null,
      createdAt: "2026-10-01T09:00:00.000Z",
    } as unknown as ApiToken;
    const onRevoke = vi.fn();
    await renderWithProviders(
      <PreferencesProvider>
        <TokenTable
          tokens={[token]}
          loading={false}
          caption="Tokens"
          knowledgeBaseNames={new Map()}
          canManage
          onRevoke={onRevoke}
        />
      </PreferencesProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Show 2 more rights" }));
    const popover = await screen.findByRole("dialog", { name: "Rights of Importer" });
    expect(within(popover).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("dialog", { name: "Importer" })).toBeNull();
  });
});

describe("instance rights", () => {
  it("stay disabled while the token is limited to one organization", async () => {
    const onCreate = vi.fn(async (_: TokenRequest) => ({ token: "ld_secret" }));
    await renderWithProviders(
      <PreferencesProvider>
        <CreateTokenDialog
          open
          onOpenChange={() => {}}
          allowInstance
          allowOrganization
          organizationId="0192f0e0-1a2b-7c3d-8e4f-5a6b7c8d9e01"
          organizationName="Northwind"
          maxLifetimeDays={null}
          onCreate={onCreate}
        />
      </PreferencesProvider>,
    );
    expect(screen.getByText("Needed when the token also has instance rights.")).toBeTruthy();
    await openDetails();
    expect(screen.getByText(/Choose “All my organizations” above/)).toBeTruthy();
    expect(screen.getByText("Access to spaces and their pages is set above under Content.")).toBeTruthy();
    const users = screen.getByRole("radiogroup", { name: "Accounts" });
    for (const radio of within(users).getAllByRole("radio"))
      expect(radio.hasAttribute("disabled")).toBe(true);

    await userEvent.click(screen.getByRole("radio", { name: "All my organizations" }));
    expect(screen.queryByText(/Choose “All my organizations” above/)).toBeNull();
    await userEvent.click(within(users).getByRole("radio", { name: "Read" }));
    const summary = screen.getByRole("complementary", { name: "Summary of the token" });
    expect(within(summary).getByText("Instance · Accounts: read")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Name"), "Automation");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      scopes: { instance: { accounts: "view" } },
      limitedToOrganization: false,
    });
  });
});
