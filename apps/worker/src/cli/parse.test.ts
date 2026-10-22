import { describe, expect, it } from "vitest";
import { parseCommand, UsageError } from "./parse.js";

describe("parseCommand", () => {
  it("parses backup commands", () => {
    expect(parseCommand(["backup", "create", "--output", "/backups/a.ldbak"])).toEqual({
      name: "backup create",
      output: "/backups/a.ldbak",
    });
    expect(parseCommand(["backup", "verify", "--input", "a.ldbak"])).toEqual({
      name: "backup verify",
      input: "a.ldbak",
    });
    expect(
      parseCommand(["backup", "restore", "--input", "a.ldbak", "--force", "--config-dir", "/restored"]),
    ).toEqual({
      name: "backup restore",
      input: "a.ldbak",
      force: true,
      configDir: "/restored",
    });
    expect(parseCommand(["backup", "restore", "--input", "a.ldbak"])).toMatchObject({ force: false });
    expect(parseCommand(["backup", "create", "--before-update"])).toEqual({
      name: "backup create before update",
    });
    expect(parseCommand(["backup", "skip-before-update"])).toEqual({
      name: "backup skip-before-update",
      forVersion: null,
    });
    expect(parseCommand(["backup", "skip-before-update", "--for-version", "1.4.2"])).toEqual({
      name: "backup skip-before-update",
      forVersion: "1.4.2",
    });
    expect(() => parseCommand(["backup", "skip-before-update", "--for-version", "1.4.2; rm"])).toThrow(
      UsageError,
    );
  });

  it("does not combine a backup before an update with an output file", () => {
    expect(() => parseCommand(["backup", "create", "--before-update", "--output", "a.ldbak"])).toThrow(
      UsageError,
    );
  });

  it("parses key commands and help", () => {
    expect(parseCommand(["keys", "rotate"])).toEqual({ name: "keys rotate" });
    expect(parseCommand(["keys", "status"])).toEqual({ name: "keys status" });
    expect(parseCommand(["audit", "verify"])).toEqual({ name: "audit verify" });
    expect(parseCommand(["search", "rebuild"])).toEqual({ name: "search rebuild" });
    expect(parseCommand(["search", "status"])).toEqual({ name: "search status" });
    expect(parseCommand([])).toEqual({ name: "help" });
    expect(parseCommand(["--help"])).toEqual({ name: "help" });
  });

  it("parses maintenance and version commands", () => {
    expect(parseCommand(["maintenance", "on", "--message", "Back at 18:00", "--block-sign-in"])).toEqual({
      name: "maintenance",
      command: { action: "on", message: "Back at 18:00", blockSignIn: true },
    });
    expect(parseCommand(["maintenance", "on"])).toEqual({
      name: "maintenance",
      command: { action: "on", message: "", blockSignIn: false },
    });
    expect(parseCommand(["maintenance", "off"])).toEqual({ name: "maintenance", command: { action: "off" } });
    expect(parseCommand(["maintenance", "status"])).toEqual({
      name: "maintenance",
      command: { action: "status" },
    });
    expect(parseCommand(["version"])).toEqual({ name: "version" });
    expect(() => parseCommand(["maintenance", "pause"])).toThrow(UsageError);
    expect(() => parseCommand(["version", "now"])).toThrow(UsageError);
  });

  it("rejects unknown commands, options and missing arguments", () => {
    expect(() => parseCommand(["backup", "delete"])).toThrow(UsageError);
    expect(() => parseCommand(["backup", "create"])).toThrow("--output is required");
    expect(() => parseCommand(["backup", "verify", "--input", "a", "--unknown"])).toThrow();
    expect(() => parseCommand(["backup", "verify", "a.ldbak"])).toThrow();
  });
});
