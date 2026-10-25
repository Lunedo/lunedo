import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { AuditLog, periodStart } from "./audit-log.js";
import type { AuditItem } from "./audit-presentation.js";

const NIL = "00000000-0000-0000-0000-000000000000";
const OLIVIA = "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c";
const EDITORS = "01929b1f-0a6d-7a51-827e-6f5a4b3c8d9e";
const GONE = "01929b1f-0a6d-7a51-827e-6f5a4b3c8d9f";

function event(patch: Partial<AuditItem>): AuditItem {
  return {
    id: "01929b1f-5fc2-7fa6-97c3-bea0a18bd2e3",
    scopeType: "instance",
    scopeId: NIL,
    sequence: 7,
    name: "settings.changed",
    actorType: "account",
    actorId: OLIVIA,
    targetType: "setting",
    targetId: "branding.accentColor",
    fields: { key: "branding.accentColor", action: "set", value: "blue", previousValue: "violet" },
    occurredAt: "2026-10-01T08:00:00.000Z",
    requestId: "6f1c2b0e-5d4a-4c3b-9a2f-1e0d9c8b7a6f",
    clientIp: "203.0.113.7",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
    labelKey: "audit.events.settings.changed",
    changeKind: "setting",
    actor: { type: "account", id: OLIVIA, name: "Olivia Owner", former: false },
    target: { type: "setting", id: "branding.accentColor", name: null, former: false },
    scope: { type: "instance", id: null, name: null },
    changes: [{ property: "value", old: "violet", new: "blue" }],
    references: {},
    formerAccounts: [],
    peopleHidden: false,
    ...patch,
  } as AuditItem;
}

const ROLE_ASSIGNED = event({
  id: "01929b1f-5fc2-7fa6-97c3-bea0a18bd2e4",
  scopeType: "organization",
  scopeId: "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f",
  name: "role.assigned",
  targetType: "roleAssignment",
  targetId: "01929b1e-9e5c-7f40-b16d-5e4f3a2b7c8d",
  labelKey: "audit.events.role.assigned",
  changeKind: "fields",
  actor: { type: "account", id: GONE, name: null, former: false, serviceAccount: false, token: null },
  target: { type: "roleAssignment", id: "01929b1e-9e5c-7f40-b16d-5e4f3a2b7c8d", name: null, former: false },
  scope: { type: "organization", id: "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f", name: "Platform Team" },
  changes: [
    { property: "role", old: null, new: "Handbook editors" },
    { property: "principalKind", old: null, new: "group" },
    { property: "principalId", old: null, new: EDITORS },
    { property: "accountId", old: null, new: GONE },
  ],
  references: { [EDITORS]: "Editors" },
});

let requests: { path: string }[] = [];

beforeEach(() => {
  ({ requests } = mockApi({
    "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
    "GET /api/v1/instance/audit-events": () => ({
      body: { items: [event({}), ROLE_ASSIGNED], nextCursor: null },
    }),
  }));
});

async function renderLog() {
  await renderWithProviders(
    <PreferencesProvider>
      <AuditLog scope="instance" canExport />
    </PreferencesProvider>,
  );
  return screen.findByRole("table", { name: "Events" });
}

describe("the audit log", () => {
  it("reads like sentences and never shows IDs", async () => {
    const table = await renderLog();
    await within(table).findByText("Violet → Blue");
    const rows = within(table).getAllByRole("row");
    const setting = rows[1] as HTMLElement;
    expect(within(setting).getByText("Olivia Owner")).toBeTruthy();
    expect(within(setting).getByText("Setting changed")).toBeTruthy();
    expect(within(setting).getByText("Accent color")).toBeTruthy();
    expect(within(setting).getByText("Instance")).toBeTruthy();
    expect(within(setting).getByText("Violet → Blue")).toBeTruthy();
    const role = rows[2] as HTMLElement;
    expect(within(role).getByText("Deleted account")).toBeTruthy();
    expect(within(role).getByText("Platform Team")).toBeTruthy();
    expect(
      within(role).getByText(/Role: Handbook editors; Given to kind: Group; 2 more changes/),
    ).toBeTruthy();
    expect(table.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("shows anonymized accounts as former users with a short ID", async () => {
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      "GET /api/v1/instance/audit-events": () => ({
        body: {
          items: [
            {
              ...ROLE_ASSIGNED,
              actor: { type: "account", id: GONE, name: null, former: true },
              formerAccounts: [GONE],
            },
          ],
          nextCursor: null,
        },
      }),
    });
    const table = await renderLog();
    expect(await within(table).findByText(`Former user ${GONE.slice(0, 8)}`)).toBeTruthy();
    expect(within(table).queryByText("Deleted account")).toBeNull();
  });

  it("names the actor as hidden when the event concerns a confidential space", async () => {
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      "GET /api/v1/instance/audit-events": () => ({
        body: {
          items: [
            {
              ...ROLE_ASSIGNED,
              actorId: null,
              actor: { type: "account", id: null, name: null, former: false },
              changes: [{ property: "role", old: null, new: "editor" }],
              references: {},
              peopleHidden: true,
            },
          ],
          nextCursor: null,
        },
      }),
    });
    const table = await renderLog();
    await userEvent.click(await within(table).findByText("Hidden (confidential space)"));
    const panel = await screen.findByRole("dialog", { name: "Role given" });
    expect(
      within(panel).getByText(
        "The people involved are not shown because this event concerns a confidential space you are not a member of.",
      ),
    ).toBeTruthy();
    expect(within(table).queryByText("Deleted account")).toBeNull();
  });

  it("opens every detail of an event in a centered dialog", async () => {
    const table = await renderLog();
    await userEvent.click(await within(table).findByText("Platform Team"));
    const panel = await screen.findByRole("dialog", { name: "Role given" });
    expect(within(panel).getByText("Editors")).toBeTruthy();
    expect(within(panel).getByText("removed")).toBeTruthy();
    expect(within(panel).getByText("203.0.113.7")).toBeTruthy();
    expect(within(panel).getByText("Firefox 131 on Windows")).toBeTruthy();
    expect(within(panel).getByText("6f1c2b0e-5d4a-4c3b-9a2f-1e0d9c8b7a6f")).toBeTruthy();
    const raw = within(panel).getByText("Raw event").closest("details") as HTMLDetailsElement;
    expect(raw.open).toBe(false);
  });

  it("steps through the filtered list in the dialog, across pages", async () => {
    const third = event({
      id: "01929b1f-5fc2-7fa6-97c3-bea0a18bd2f0",
      name: "auth.signedIn",
      labelKey: "audit.events.auth.signedIn",
      changeKind: "fields",
      changes: [],
    });
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      "GET /api/v1/instance/audit-events": (request) => ({
        body: request.path.includes("cursor=page-2")
          ? { items: [third], nextCursor: null }
          : { items: [event({}), ROLE_ASSIGNED], nextCursor: "page-2" },
      }),
    });
    const table = await renderLog();
    await userEvent.click(await within(table).findByText("Violet → Blue"));
    let dialog = await screen.findByRole("dialog", { name: "Setting changed" });
    expect(within(dialog).getByText("This is the first event in the list.")).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    dialog = await screen.findByRole("dialog", { name: "Role given" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    dialog = await screen.findByRole("dialog", { name: "Signed in" });
    expect(within(dialog).getByText("This is the last event in the list.")).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(dialog).getByRole("button", { name: "Previous" }));
    expect(await screen.findByRole("dialog", { name: "Role given" })).toBeTruthy();
  });

  it("labels the date filters and names targets and fields in words", async () => {
    const rule = event({
      id: "01929b1f-5fc2-7fa6-97c3-bea0a18bd2e5",
      name: "mappingRule.removed",
      targetType: "mappingRule",
      targetId: "01929b1e-0000-7000-8000-0000000000aa",
      labelKey: "audit.events.mappingRule.removed",
      changeKind: "fields",
      target: { type: "mappingRule", id: "01929b1e-0000-7000-8000-0000000000aa", name: null, former: false },
      changes: [],
    });
    const signIn = event({
      id: "01929b1f-5fc2-7fa6-97c3-bea0a18bd2e6",
      name: "auth.signedIn",
      targetType: "account",
      targetId: OLIVIA,
      labelKey: "audit.events.auth.signedIn",
      changeKind: "fields",
      target: { type: "account", id: OLIVIA, name: "Olivia Owner", former: false },
      changes: [{ property: "method", old: null, new: "password" }],
    });
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      "GET /api/v1/instance/audit-events": () => ({ body: { items: [rule, signIn], nextCursor: null } }),
    });
    const table = await renderLog();
    expect(screen.queryByRole("button", { name: "From" })).toBeNull();
    await userEvent.click(screen.getByRole("combobox", { name: "Period" }));
    await userEvent.click(await screen.findByRole("option", { name: "Custom period …" }));
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(screen.getByRole("button", { name: "From" }).textContent).toContain("From");
    expect(screen.getByRole("button", { name: "To" })).toBeTruthy();
    expect(await within(table).findByText("Mapping rule")).toBeTruthy();
    expect(within(table).queryByText("mappingRule")).toBeNull();
    await userEvent.click(within(table).getAllByText("Olivia Owner").at(-1) as HTMLElement);
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Sign-in method")).toBeTruthy();
    expect(within(panel).queryByText("Sending method")).toBeNull();
  });

  it("calls the method of the e-mail settings the sending method", async () => {
    const changed = event({
      id: "01929b1f-5fc2-7fa6-97c3-bea0a18bd2e7",
      name: "mail.methodChanged",
      targetType: "instance",
      targetId: null,
      labelKey: "audit.events.mail.methodChanged",
      changeKind: "fields",
      target: { type: "instance", id: null, name: null, former: false },
      changes: [{ property: "method", old: "smtp", new: "graph" }],
    });
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      "GET /api/v1/instance/audit-events": () => ({ body: { items: [changed], nextCursor: null } }),
    });
    const table = await renderLog();
    await userEvent.click((await within(table).findAllByText("Instance"))[0] as HTMLElement);
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Sending method")).toBeTruthy();
  });

  it("filters by action", async () => {
    await renderLog();
    await userEvent.click(screen.getByRole("combobox", { name: "Action" }));
    await userEvent.click(await screen.findByRole("option", { name: "Setting changed" }));
    await waitFor(() =>
      expect(requests.some((request) => request.path.includes("name=settings.changed"))).toBe(true),
    );
  });
});

describe("audit presentation of personal and notification settings", () => {
  it("translates setting keys and values and shows the account as scope", async () => {
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      "GET /api/v1/instance/audit-events": () => ({
        body: {
          items: [
            event({
              id: "01929b1f-5fc2-7fa6-97c3-bea0a18bd2e5",
              target: { type: "setting", id: "appearance.textSize", name: null, former: false },
              scope: { type: "account", id: OLIVIA, name: "Olivia Owner" },
              changes: [{ property: "value", old: 0.9375, new: 1 }],
            }),
            event({
              id: "01929b1f-5fc2-7fa6-97c3-bea0a18bd2e6",
              target: { type: "setting", id: "appearance.colorMode", name: null, former: false },
              scope: { type: "account", id: OLIVIA, name: "Olivia Owner" },
              changes: [{ property: "value", old: "dark", new: "light" }],
            }),
            event({
              id: "01929b1f-5fc2-7fa6-97c3-bea0a18bd2e7",
              target: { type: "setting", id: "notifications.guestExpiring.email", name: null, former: false },
              changes: [{ property: "value", old: "immediately", new: "digest" }],
            }),
          ],
          nextCursor: null,
        },
      }),
    });
    await renderWithProviders(
      <PreferencesProvider>
        <AuditLog scope="instance" canExport={false} />
      </PreferencesProvider>,
    );
    const table = await screen.findByRole("table", { name: "Events" });
    await within(table).findByText("Dark → Light");
    const [, textSize, colorMode, notification] = within(table).getAllByRole("row") as HTMLElement[];
    expect(within(textSize as HTMLElement).getByText("Text size")).toBeTruthy();
    expect(within(textSize as HTMLElement).getByText(/94\s?% → 100\s?%|93\.75\s?% → 100\s?%/)).toBeTruthy();
    expect(within(textSize as HTMLElement).getAllByText("Olivia Owner").length).toBe(2);
    expect(within(colorMode as HTMLElement).getByText("Color mode")).toBeTruthy();
    expect(within(colorMode as HTMLElement).getByText("Dark → Light")).toBeTruthy();
    expect(within(notification as HTMLElement).getByText(/^Notifications · /)).toBeTruthy();
    expect(within(notification as HTMLElement).getByText("Immediately → In the daily digest")).toBeTruthy();
    expect(table.textContent).not.toMatch(/appearance\.|notifications\.guest|\{/);
  });
});

describe("who acted", () => {
  it("names the service account and the token in the actor column", async () => {
    const published = event({
      id: "01929b1f-5fc2-7fa6-97c3-bea0a18bd2e9",
      name: "page.published",
      targetType: "page",
      targetId: OLIVIA,
      labelKey: "audit.events.page.published",
      changeKind: "fields",
      actor: {
        type: "account",
        id: OLIVIA,
        name: "Sync bot",
        former: false,
        serviceAccount: true,
        token: "Publishing",
      },
      target: { type: "page", id: OLIVIA, name: "Guide", former: false },
      changes: [],
    });
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      "GET /api/v1/instance/audit-events": () => ({ body: { items: [published], nextCursor: null } }),
    });
    const table = await renderLog();
    expect(await within(table).findByText("Sync bot (service account) · token “Publishing”")).toBeTruthy();
  });
});

describe("audit periods", () => {
  it("start the period the chosen number of days before now and leave any time and custom open", () => {
    const now = new Date("2026-10-25T12:00:00.000Z");
    expect(periodStart("day", now)).toBe("2026-10-24T12:00:00.000Z");
    expect(periodStart("week", now)).toBe("2026-10-18T12:00:00.000Z");
    expect(periodStart("month", now)).toBe("2026-09-25T12:00:00.000Z");
    expect(periodStart("all", now)).toBeUndefined();
    expect(periodStart("custom", now)).toBeUndefined();
  });
});
