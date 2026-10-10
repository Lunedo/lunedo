import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, type RecordedRequest, renderWithProviders } from "../testing/render.js";
import { ShareDialog } from "./share-dialog.js";

const PAGE = "01929b1e-0000-7000-8000-0000000000b2";
const SPACE = "01929b1e-0000-7000-8000-0000000000a1";
const ORGANIZATION = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f";
const ANNA = "01929b1e-0000-7000-8000-00000000a001";
const LUKAS = "01929b1e-0000-7000-8000-00000000a002";
const SHARE = "01929b1e-0000-7000-8000-00000000c001";
const LINK = "01929b1e-0000-7000-8000-00000000d001";
const TOKEN = `${"a".repeat(16)}${"b".repeat(32)}`;

const emptyImpact = {
  gaining: 0,
  losing: 0,
  raised: 0,
  lowered: 0,
  unlisted: 0,
  truncated: false,
  changes: [],
};

const lukasShare = {
  id: SHARE,
  holder: {
    kind: "account",
    id: LUKAS,
    name: "Lukas Hofer",
    email: "lukas@example.org",
    members: null,
    active: true,
  },
  role: "editor",
  includeDescendants: false,
  spaceRole: null,
  sharedBy: { id: ANNA, name: "Anna Berger" },
  createdAt: "2026-10-01T09:30:00.000Z",
};

function access(extra: Record<string, unknown> = {}) {
  return {
    itemId: PAGE,
    title: "VPN access",
    shares: [lukasShare],
    restrictions: { view: null, edit: null, inherited: [], holders: [] },
    linkVisitors: [],
    canInviteGuests: false,
    ...extra,
  };
}

function link(extra: Record<string, unknown> = {}) {
  return {
    id: LINK,
    token: TOKEN,
    itemId: PAGE,
    scope: "organization",
    expiresAt: null,
    hasPassword: false,
    people: [],
    createdBy: { id: ANNA, name: "Anna Berger" },
    createdAt: "2026-10-01T09:30:00.000Z",
    visitors: 2,
    ...extra,
  };
}

let requests: RecordedRequest[] = [];
let links: ReturnType<typeof link>[] = [];
let options = { enabled: true, anyone: false, anyoneMaxDays: 30 };
let pageAccess = access();

function routes(extra: Parameters<typeof mockApi>[0] = {}) {
  ({ requests } = mockApi({
    [`GET /api/v1/pages/${PAGE}/access`]: () => ({ body: pageAccess }),
    [`POST /api/v1/pages/${PAGE}/access/preview`]: (request) => {
      const [change] = (request.body as { changes: { action: string }[] }).changes;
      if (change?.action === "share") {
        return {
          body: {
            read: {
              ...emptyImpact,
              gaining: 1,
              changes: [{ accountId: ANNA, name: "Anna Berger", before: null, after: "reader" }],
            },
            edit: emptyImpact,
          },
        };
      }
      if (change?.action === "restrict") {
        return {
          body: {
            read: {
              ...emptyImpact,
              losing: 14,
              unlisted: 2,
              changes: [{ accountId: ANNA, name: "Anna Berger", before: "editor", after: null }],
            },
            edit: emptyImpact,
          },
        };
      }
      return { body: { read: emptyImpact, edit: emptyImpact } };
    },
    [`POST /api/v1/pages/${PAGE}/access`]: () => ({ body: pageAccess }),
    [`GET /api/v1/pages/${PAGE}/share-links`]: () => ({ body: { links, options } }),
    [`POST /api/v1/pages/${PAGE}/share-links`]: () => {
      links = [link()];
      return { status: 201, body: { link: links[0], token: TOKEN } };
    },
    [`DELETE /api/v1/pages/${PAGE}/share-links/${LINK}`]: () => {
      links = [];
      return { status: 204 };
    },
    [`GET /api/v1/pages/${PAGE}/access/explain`]: () => ({
      body: {
        accountId: LUKAS,
        name: "Lukas Hofer",
        role: "reader",
        reasons: [
          { type: "spaceRole", role: "reader", via: { type: "group", groupId: SHARE, name: "Support" } },
        ],
        denial: "editRestricted",
        restrictions: [],
        editRestricted: { listed: false },
        published: true,
      },
    }),
    "GET /api/v1/people": () => ({
      body: {
        items: [
          { id: ANNA, name: "Anna Berger", email: "anna@example.org", type: "standard" },
          { id: LUKAS, name: "Lukas Hofer", email: "lukas@example.org", type: "standard" },
        ],
        nextCursor: null,
      },
    }),
    [`GET /api/v1/organizations/${ORGANIZATION}/groups`]: () => ({ body: { items: [], nextCursor: null } }),
    ...extra,
  }));
}

async function openDialog() {
  await renderWithProviders(
    <PreferencesProvider>
      <ShareDialog
        page={{
          id: PAGE,
          title: "VPN access",
          spaceId: SPACE,
          organizationId: ORGANIZATION,
          organizationName: "Platform Team",
        }}
        open
        onOpenChange={() => undefined}
      />
    </PreferencesProvider>,
  );
  return screen.findByRole("dialog", { name: 'Share "VPN access"' });
}

const posted = (path: string) =>
  requests.filter((request) => request.method === "POST" && request.path === path);

beforeEach(() => {
  links = [];
  options = { enabled: true, anyone: false, anyoneMaxDays: 30 };
  pageAccess = access();
  routes();
});

describe("sharing a page with people", () => {
  it("shows who gains access before sharing and shares only after confirmation", async () => {
    const dialog = await openDialog();
    await userEvent.click(await within(dialog).findByRole("combobox", { name: "Add people or groups" }));
    await userEvent.click(await screen.findByRole("option", { name: /Anna Berger/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Share" }));
    const pending = await within(dialog).findByRole("region", { name: "Share with Anna Berger (Can read)?" });
    expect(await within(pending).findByText("1 person can then read this page")).toBeTruthy();
    expect(within(pending).getByText("Anna Berger")).toBeTruthy();
    expect(posted(`/api/v1/pages/${PAGE}/access`)).toHaveLength(0);
    await userEvent.click(within(pending).getByRole("button", { name: "Share page" }));
    await waitFor(() =>
      expect(posted(`/api/v1/pages/${PAGE}/access`)[0]?.body).toEqual({
        changes: [
          {
            action: "share",
            holderKind: "account",
            holderId: ANNA,
            role: "reader",
            includeDescendants: false,
          },
        ],
      }),
    );
    expect(await screen.findByText("Shared with Anna Berger")).toBeTruthy();
  });

  it("asks for a person instead of disabling the button", async () => {
    const dialog = await openDialog();
    await within(dialog).findByText("Lukas Hofer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Share" }));
    expect(await within(dialog).findByText("Choose a person or group from the search results.")).toBeTruthy();
    expect(requests.some((request) => request.path.endsWith("/access/preview"))).toBe(false);
  });

  it("names the effect of removing someone and keeps the entry when cancelled", async () => {
    const dialog = await openDialog();
    await userEvent.click(
      await within(dialog).findByRole("button", { name: "Remove Lukas Hofer from the list" }),
    );
    const pending = await within(dialog).findByRole("region", {
      name: "Remove Lukas Hofer from the access list?",
    });
    await within(pending).findByText("Nobody's access changes");
    await userEvent.click(within(pending).getByRole("button", { name: "Cancel" }));
    expect(within(dialog).getByText("Lukas Hofer")).toBeTruthy();
    expect(posted(`/api/v1/pages/${PAGE}/access`)).toHaveLength(0);
  });

  it("restricts viewing after showing who loses access, including people the caller cannot see", async () => {
    const dialog = await openDialog();
    await userEvent.click(await within(dialog).findByRole("combobox", { name: "Who can view this page" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "Only the people and groups on the list" }),
    );
    const pending = await within(dialog).findByRole("region", {
      name: "Restrict viewing to the access list?",
    });
    expect(await within(pending).findByText("14 people can then no longer read this page")).toBeTruthy();
    expect(within(pending).getByText("and 13 more")).toBeTruthy();
    expect(within(pending).getByText(/2 of them are people you cannot see/)).toBeTruthy();
    await userEvent.click(within(pending).getByRole("button", { name: "Restrict" }));
    await waitFor(() =>
      expect(posted(`/api/v1/pages/${PAGE}/access`)[0]?.body).toEqual({
        changes: [{ action: "restrict", kind: "view" }],
      }),
    );
  });

  it("says when a page above restricts viewing", async () => {
    pageAccess = access({
      restrictions: {
        view: null,
        edit: null,
        inherited: [{ itemId: SHARE, title: "Contracts" }],
        holders: [],
      },
    });
    const dialog = await openDialog();
    expect(await within(dialog).findByText(/Viewing is restricted on Contracts/)).toBeTruthy();
  });

  it("lists people named on a restriction apart from the access list", async () => {
    pageAccess = access({
      shares: [],
      restrictions: {
        view: { setBy: null, setAt: "2026-10-01T09:30:00.000Z" },
        edit: null,
        inherited: [],
        holders: [{ kind: "view", holder: { ...lukasShare.holder } }],
      },
    });
    const dialog = await openDialog();
    expect(await within(dialog).findByText("Also named in the restrictions")).toBeTruthy();
    expect(within(dialog).getByText("Lukas Hofer")).toBeTruthy();
    expect(within(dialog).getByText(/need a role in the space/)).toBeTruthy();
  });

  it("explains why someone has access", async () => {
    const dialog = await openDialog();
    await userEvent.click(
      await within(dialog).findByRole("button", { name: "Why does someone have access?" }),
    );
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Person" }));
    await userEvent.click(await screen.findByRole("option", { name: /Lukas Hofer/ }));
    expect(await within(dialog).findByText("Lukas Hofer: Can read")).toBeTruthy();
    expect(within(dialog).getByText("Can read in the space through the group Support")).toBeTruthy();
    expect(within(dialog).getByText(/Editing is restricted/)).toBeTruthy();
  });

  it("lists people who opened a link as via link", async () => {
    pageAccess = access({
      linkVisitors: [
        { accountId: ANNA, name: "Anna Berger", linkId: LINK, lastOpenedAt: "2026-10-02T10:00:00.000Z" },
      ],
    });
    const dialog = await openDialog();
    const visitors = await within(dialog).findByRole("region", { name: "Opened through a share link" });
    expect(within(visitors).getByText("Anna Berger")).toBeTruthy();
    expect(within(visitors).getByText("Via link")).toBeTruthy();
  });

  it("offers guest invitations only when allowed and validates the address on click", async () => {
    routes({
      [`POST /api/v1/pages/${PAGE}/access/invitations`]: () => ({
        status: 201,
        body: { id: SHARE, email: "contractor@example.net", expiresAt: "2026-10-15T09:30:00.000Z" },
      }),
    });
    pageAccess = access({ canInviteGuests: true });
    const dialog = await openDialog();
    await userEvent.click(await within(dialog).findByRole("button", { name: "Invite a guest by e-mail" }));
    const email = within(dialog).getByRole("textbox", { name: /E-mail address of the guest/ });
    await userEvent.type(email, "contractor");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    expect(await within(dialog).findByText(/Enter a complete e-mail address/)).toBeTruthy();
    expect(document.activeElement).toBe(email);
    await userEvent.type(email, "@example.net");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    await waitFor(() =>
      expect(posted(`/api/v1/pages/${PAGE}/access/invitations`)[0]?.body).toEqual({
        email: "contractor@example.net",
        role: "reader",
        includeDescendants: false,
      }),
    );
  });
});

describe("share links", () => {
  async function openLinks() {
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole("tab", { name: "Share links" }));
    return dialog;
  }

  it("explains why links for anyone are missing and creates a link to copy", async () => {
    const dialog = await openLinks();
    expect(
      await within(dialog).findByText(
        "Links for anyone without signing in are turned off in this organization.",
      ),
    ).toBeTruthy();
    expect(within(dialog).queryByRole("radio", { name: /Anyone with the link/ })).toBeNull();
    await userEvent.click(within(dialog).getByRole("radio", { name: /Signed-in members of Platform Team/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create link" }));
    await waitFor(() =>
      expect(posted(`/api/v1/pages/${PAGE}/share-links`)[0]?.body).toEqual({
        scope: "organization",
        expiresAt: null,
      }),
    );
    expect(await within(dialog).findByText(`${window.location.origin}/s/${TOKEN}`)).toBeTruthy();
  });

  it("requires people for a link to named people", async () => {
    const dialog = await openLinks();
    await userEvent.click(
      await within(dialog).findByRole("radio", { name: /Only the people and groups you choose/ }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Create link" }));
    expect(await within(dialog).findByText("Add at least one person or group.")).toBeTruthy();
    expect(posted(`/api/v1/pages/${PAGE}/share-links`)).toHaveLength(0);
  });

  it("needs an expiry within the maximum for links for anyone", async () => {
    options = { enabled: true, anyone: true, anyoneMaxDays: 7 };
    const dialog = await openLinks();
    await userEvent.click(await within(dialog).findByRole("radio", { name: /Anyone with the link/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create link" }));
    expect(
      await within(dialog).findByText(/Choose an end date. Links for anyone may last at most 7 days/),
    ).toBeTruthy();
    const date = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const input = within(dialog).getByLabelText(/Expires on/);
    await userEvent.clear(input);
    await userEvent.type(input, value);
    await userEvent.click(within(dialog).getByRole("button", { name: "Create link" }));
    expect(await within(dialog).findByText(/may last at most 7 days. Choose an earlier date/)).toBeTruthy();
    expect(posted(`/api/v1/pages/${PAGE}/share-links`)).toHaveLength(0);
  });

  it("offers only links for named people on a restricted page", async () => {
    options = { enabled: true, anyone: true, anyoneMaxDays: 7 };
    pageAccess = access({
      restrictions: {
        view: { setBy: null, setAt: "2026-10-01T09:30:00.000Z" },
        edit: null,
        inherited: [],
        holders: [],
      },
    });
    const dialog = await openLinks();
    expect(await within(dialog).findByText(/This page is restricted/)).toBeTruthy();
    expect(within(dialog).getAllByRole("radio")).toHaveLength(1);
  });

  it("names the effects before revoking a link", async () => {
    links = [link()];
    const dialog = await openLinks();
    expect(await within(dialog).findByRole("button", { name: "Copy link" })).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    expect(
      await within(dialog).findByText(
        "The address stops working at once, and 2 people who opened the page only through this link lose access.",
      ),
    ).toBeTruthy();
    expect(requests.some((request) => request.method === "DELETE")).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Revoke link" }));
    await waitFor(() => expect(requests.some((request) => request.method === "DELETE")).toBe(true));
  });

  it("says when the organization turned share links off", async () => {
    options = { enabled: false, anyone: false, anyoneMaxDays: 30 };
    const dialog = await openLinks();
    expect(await within(dialog).findByText("Share links are turned off")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Create link" })).toBeNull();
  });
});
