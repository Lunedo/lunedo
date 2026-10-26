import { describe, expect, it } from "vitest";
import { type PresentableAuditEntry, presentAuditEntry } from "./presentation.js";

const INSTANCE = "00000000-0000-0000-0000-000000000000";
const ORGANIZATION = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f";
const ACCOUNT = "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c";

function entry(patch: Partial<PresentableAuditEntry>): PresentableAuditEntry {
  return {
    scopeType: "instance",
    scopeId: INSTANCE,
    name: "settings.changed",
    actorType: "account",
    actorId: ACCOUNT,
    targetType: "setting",
    targetId: "branding.accentColor",
    fields: {},
    labels: { actor: "Olivia Owner" },
    ...patch,
  };
}

describe("presentAuditEntry", () => {
  it("shows a setting change with the previous and the new value, without the nil scope ID", () => {
    const view = presentAuditEntry(
      entry({
        fields: {
          level: "instance",
          scopeId: INSTANCE,
          action: "set",
          value: "blue",
          previousValue: "violet",
        },
      }),
    );
    expect(view).toEqual({
      labelKey: "audit.events.settings.changed",
      changeKind: "setting",
      actor: {
        type: "account",
        id: ACCOUNT,
        name: "Olivia Owner",
        former: false,
        serviceAccount: false,
        token: null,
      },
      target: { type: "setting", id: "branding.accentColor", name: null, former: false },
      scope: { type: "instance", id: null, name: null },
      changes: [{ property: "value", old: "violet", new: "blue" }],
      references: {},
      formerAccounts: [],
      peopleHidden: false,
    });
  });

  it("marks accounts whose personal data is gone as former users", () => {
    const view = presentAuditEntry({
      ...entry({ name: "auth.signedIn", targetType: "account", targetId: ACCOUNT, labels: null }),
      formerSubjects: [ACCOUNT],
    });
    expect(view.actor).toEqual({
      type: "account",
      id: ACCOUNT,
      name: null,
      former: true,
      serviceAccount: false,
      token: null,
    });
    expect(view.target).toEqual({ type: "account", id: ACCOUNT, name: null, former: true });
    expect(view.formerAccounts).toEqual([ACCOUNT]);
  });

  it("shows the account as the scope of personal events instead of the instance", () => {
    const signIn = presentAuditEntry(
      entry({
        name: "auth.signedIn",
        targetType: "account",
        targetId: ACCOUNT,
        fields: { sessionId: ORGANIZATION, methods: ["password"] },
        labels: { actor: "Olivia Owner", target: "Olivia Owner" },
      }),
    );
    expect(signIn.scope).toEqual({ type: "account", id: ACCOUNT, name: "Olivia Owner" });

    const preference = presentAuditEntry(
      entry({
        targetId: "notifications.guestExpiring",
        fields: { level: "user", scopeId: ACCOUNT, action: "set", value: {}, previousValue: null },
      }),
    );
    expect(preference.scope).toEqual({ type: "account", id: ACCOUNT, name: "Olivia Owner" });

    const token = presentAuditEntry(
      entry({
        name: "apiToken.created",
        targetType: "apiToken",
        targetId: ORGANIZATION,
        fields: { accountId: ACCOUNT, name: "Backup script" },
        labels: { actor: "Olivia Owner", references: { [ACCOUNT]: "Olivia Owner" } },
      }),
    );
    expect(token.scope).toEqual({ type: "account", id: ACCOUNT, name: "Olivia Owner" });

    const organization = presentAuditEntry(
      entry({
        scopeType: "organization",
        scopeId: ORGANIZATION,
        name: "account.deactivated",
        targetType: "account",
        targetId: ACCOUNT,
        fields: { endedSessions: 1 },
        labels: { scope: "Platform Team" },
      }),
    );
    expect(organization.scope).toEqual({ type: "organization", id: ORGANIZATION, name: "Platform Team" });
  });

  it("shows clearing, locking and unlocking a setting", () => {
    const changes = (fields: object) => presentAuditEntry(entry({ fields })).changes;
    expect(changes({ action: "clear", previousValue: 30 })).toEqual([
      { property: "value", old: 30, new: null },
    ]);
    expect(changes({ action: "lock", previousLocked: false })).toEqual([
      { property: "locked", old: false, new: true },
    ]);
    expect(changes({ action: "unlock", previousLocked: true })).toEqual([
      { property: "locked", old: true, new: false },
    ]);
  });

  it("lists only changed fields of an update and pairs previous and new names", () => {
    const update = presentAuditEntry(
      entry({
        name: "group.updated",
        scopeType: "organization",
        scopeId: ORGANIZATION,
        targetType: "group",
        targetId: ORGANIZATION,
        fields: { name: "Editors", description: "Same", previous: { name: "Writers", description: "Same" } },
        labels: { actor: "Olivia Owner", target: "Editors", scope: "Platform Team" },
      }),
    );
    expect(update.changes).toEqual([{ property: "name", old: "Writers", new: "Editors" }]);
    expect(update.scope).toEqual({ type: "organization", id: ORGANIZATION, name: "Platform Team" });
    expect(update.target.name).toBe("Editors");

    const email = presentAuditEntry(
      entry({
        name: "account.emailChanged",
        targetType: "account",
        fields: { previousEmail: "old@example.org", newEmail: "new@example.org" },
      }),
    );
    expect(email.changes).toEqual([{ property: "email", old: "old@example.org", new: "new@example.org" }]);
  });

  it("hides technical references and passes on the names of referenced IDs", () => {
    const view = presentAuditEntry(
      entry({
        name: "group.memberAdded",
        targetType: "group",
        fields: { accountId: ACCOUNT, expiresAt: null },
        labels: { references: { [ACCOUNT]: "Gina Guest" } },
      }),
    );
    expect(view.changes).toEqual([
      { property: "accountId", old: null, new: ACCOUNT },
      { property: "expiresAt", old: null, new: null },
    ]);
    expect(view.references).toEqual({ [ACCOUNT]: "Gina Guest" });
    const signedIn = presentAuditEntry(
      entry({
        name: "auth.signedIn",
        targetType: "account",
        fields: { sessionId: ACCOUNT, methods: ["password"] },
      }),
    );
    expect(signedIn.changes).toEqual([{ property: "methods", old: null, new: ["password"] }]);
    expect(signedIn.actor.name).toBe("Olivia Owner");
  });
});

describe("the actor of an event", () => {
  it("names a service account and the API token it acted with", () => {
    const view = presentAuditEntry({
      scopeType: "organization",
      scopeId: ACCOUNT,
      name: "page.published",
      actorType: "account",
      actorId: ACCOUNT,
      targetType: "page",
      targetId: ACCOUNT,
      fields: { spaceId: ACCOUNT, title: "Guide", version: 2, note: "", credentialId: ACCOUNT },
      labels: { actor: "Sync bot", actorKind: "serviceAccount", actorToken: "Publishing" },
    });
    expect(view.actor).toMatchObject({ name: "Sync bot", serviceAccount: true, token: "Publishing" });
    expect(view.changes.map((change) => change.property)).not.toContain("credentialId");
  });
});
