import { describe, expect, it, vi } from "vitest";
import { readLinkToken } from "../session/link-token.js";
import { safeRedirect } from "../session/redirect.js";
import { isNavigationVisible, type NavigationItem, type ShellContext } from "./extensions.js";
import { createSequenceMatcher, displayKey, isTypingTarget, keyName } from "./keyboard.js";
import { createRegistry } from "./registry.js";
import { chooseOrganization } from "./shell-context.js";

const press = (
  key: string,
  modifiers: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {},
) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe("keyboard", () => {
  it("names keys with the platform's modifier", () => {
    expect(keyName(press("k", { ctrlKey: true }), false)).toBe("mod+k");
    expect(keyName(press("k", { metaKey: true }), true)).toBe("mod+k");
    expect(keyName(press("k", { ctrlKey: true }), true)).toBe("k");
    expect(keyName(press("?", { shiftKey: true }), false)).toBe("?");
    expect(keyName(press("Escape"), false)).toBe("Escape");
  });

  it("matches single keys and sequences within the timeout", () => {
    const matcher = createSequenceMatcher([["?"], ["g", "p"], ["g", "s"]], 1000);
    expect(matcher.press("g", 0)).toBeNull();
    expect(matcher.press("p", 500)).toEqual(["g", "p"]);
    expect(matcher.press("g", 1000)).toBeNull();
    expect(matcher.press("s", 3000)).toBeNull();
    expect(matcher.press("?", 3100)).toEqual(["?"]);
  });

  it("ignores keys typed into fields", () => {
    const input = document.createElement("input");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const textarea = document.createElement("textarea");
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget(checkbox)).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const paragraph = document.createElement("p");
    editor.append(paragraph);
    const textbox = document.createElement("div");
    textbox.setAttribute("role", "textbox");
    expect(isTypingTarget(editor)).toBe(true);
    expect(isTypingTarget(paragraph)).toBe(true);
    expect(isTypingTarget(textbox)).toBe(true);
  });

  it("shows keys in the platform's notation", () => {
    expect(displayKey("mod+k", false)).toBe("Ctrl+K");
    expect(displayKey("mod+k", true)).toBe("⌘K");
  });
});

describe("registries", () => {
  it("keep entries ordered, refuse duplicates and notify subscribers", () => {
    const registry = createRegistry<{ id: string; order: number }>();
    const listener = vi.fn();
    registry.subscribe(listener);
    const remove = registry.register({ id: "b", order: 20 }, { id: "a", order: 10 });
    expect(registry.list().map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(() => registry.register({ id: "a", order: 5 })).toThrow(/twice/);
    remove();
    expect(registry.list()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("show navigation entries only with their permission and an organization", () => {
    const context = (allowed: string[], organizationId: string | null): ShellContext => ({
      organizationId,
      can: (action) => allowed.includes(action),
      navigate: () => undefined,
      openCommandPalette: () => undefined,
      openShortcuts: () => undefined,
      toggleNotifications: () => undefined,
      toggleSidebar: () => undefined,
      signOut: () => undefined,
    });
    const item: NavigationItem = {
      id: "members",
      order: 1,
      section: "organization",
      icon: (() => null) as unknown as NavigationItem["icon"],
      labelKey: "navigation.members",
      to: "/settings/organizations/$organizationId/members",
      permission: "organization.members.view",
    };
    expect(isNavigationVisible(item, context(["organization.members.view"], "org"))).toBe(true);
    expect(isNavigationVisible(item, context([], "org"))).toBe(false);
    expect(isNavigationVisible(item, context(["organization.members.view"], null))).toBe(false);
  });
});

describe("safeRedirect", () => {
  const origin = "https://wiki.example.org";
  it("keeps paths of this instance", () => {
    expect(safeRedirect("/settings/security?tab=x#top", origin)).toBe("/settings/security?tab=x#top");
    expect(safeRedirect("https://wiki.example.org/settings", origin)).toBe("/settings");
  });

  it("refuses other hosts, protocol-relative paths and the sign-in page", () => {
    expect(safeRedirect("https://evil.example/", origin)).toBe("/");
    expect(safeRedirect("//evil.example/x", origin)).toBe("/");
    expect(safeRedirect("javascript:alert(1)", origin)).toBe("/");
    expect(safeRedirect("/sign-in?redirect=/", origin)).toBe("/");
    expect(safeRedirect(undefined, origin)).toBe("/");
  });
});

describe("readLinkToken", () => {
  it("reads well-formed tokens from the fragment only", () => {
    expect(readLinkToken("#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG")).toBe(
      "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
    );
    expect(readLinkToken("#token=short")).toBeNull();
    expect(readLinkToken("#token=<script>alert(1)</script>xxxxxxxxxxxxxx")).toBeNull();
    expect(readLinkToken("")).toBeNull();
  });
});

describe("chooseOrganization", () => {
  const organizations = [
    { id: "a", name: "A", membershipKind: "collaborator" },
    { id: "b", name: "B", membershipKind: "member" },
  ] as unknown as Parameters<typeof chooseOrganization>[0];

  it("prefers the route, then the remembered one, then the home organization", () => {
    expect(chooseOrganization(organizations, "a", "b")?.id).toBe("a");
    expect(chooseOrganization(organizations, undefined, "a")?.id).toBe("a");
    expect(chooseOrganization(organizations, undefined, "gone")?.id).toBe("b");
    expect(chooseOrganization([], undefined, null)).toBeNull();
  });
});
