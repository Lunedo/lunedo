import { describe, expect, it } from "vitest";
import {
  contentNotificationParamSchemas,
  digestTimeSchema,
  notificationChannelSettingKey,
  notificationEventOf,
  notificationEvents,
  notificationTypes,
} from "./notifications.js";

describe("notification events", () => {
  it("route every known notification type through exactly one event", () => {
    const types = [...notificationTypes, ...Object.keys(contentNotificationParamSchemas)];
    for (const type of types) {
      expect(
        notificationEvents.filter((event) => event.types.includes(type)),
        type,
      ).toHaveLength(1);
    }
  });

  it("have unique IDs that form valid setting keys", () => {
    const ids = notificationEvents.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(notificationChannelSettingKey(id, "email")).toMatch(/^notifications\.[a-z][a-zA-Z0-9]*\.email$/);
    }
  });

  it("ship the defaults of the prototype table", () => {
    const defaults = Object.fromEntries(
      notificationEvents
        .filter((event) => event.group === "content")
        .map((event) => [event.id, event.defaults]),
    );
    expect(defaults).toEqual({
      mentions: { inApp: true, email: "immediately", push: true },
      tasks: { inApp: true, email: "immediately", push: true },
      shares: { inApp: true, email: "immediately", push: true },
      accessRequests: { inApp: true, email: "immediately", push: true },
      comments: { inApp: true, email: "digest", push: false },
      changes: { inApp: true, email: "off", push: false },
      blogPosts: { inApp: true, email: "digest", push: false },
      meetings: { inApp: true, email: "off", push: false },
      ownershipAndStatus: { inApp: true, email: "off", push: false },
    });
  });

  it("leave browser push off for administration events", () => {
    expect(
      notificationEvents.filter((event) => event.group === "administration" && event.defaults.push),
    ).toEqual([]);
  });

  it("keep mentions, tasks, shares and access requests from muted content", () => {
    expect(notificationEvents.filter((event) => event.keptWhenMuted).map((event) => event.id)).toEqual([
      "mentions",
      "tasks",
      "shares",
      "accessRequests",
    ]);
  });

  it("mark only events about sign-in, credentials and storage as events without an unsubscribe link", () => {
    expect(notificationEvents.filter((event) => event.security).map((event) => event.id)).toEqual([
      "apiTokenExpiring",
      "breakGlassStarted",
      "authEmergencySignIn",
      "mailCredentialExpiring",
      "storageLevelReached",
      "storageLevelCleared",
      "identityProviderCredentialExpiring",
      "signInNewBrowser",
    ]);
  });

  it("find the event of a type", () => {
    expect(notificationEventOf("content.changed")?.id).toBe("changes");
    expect(notificationEventOf("apiToken.expiring")?.id).toBe("apiTokenExpiring");
    expect(notificationEventOf("unknown.type")).toBeUndefined();
  });

  it("accept digest times on the clock only", () => {
    expect(digestTimeSchema.safeParse("08:00").success).toBe(true);
    expect(digestTimeSchema.safeParse("23:59").success).toBe(true);
    expect(digestTimeSchema.safeParse("24:00").success).toBe(false);
    expect(digestTimeSchema.safeParse("8:00").success).toBe(false);
  });
});
