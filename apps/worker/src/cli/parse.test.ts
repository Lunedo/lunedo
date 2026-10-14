import { describe, expect, it } from "vitest";
import { parseCommand, UsageError } from "./parse.js";

describe("parseCommand", () => {
  it("parses backup commands", () => {
    expect(parseCommand(["backup", "create", "--output", "/backups/a.phbak"])).toEqual({
      name: "backup create",
      output: "/backups/a.phbak",
    });
    expect(parseCommand(["backup", "verify", "--input", "a.phbak"])).toEqual({
      name: "backup verify",
      input: "a.phbak",
    });
    expect(
      parseCommand(["backup", "restore", "--input", "a.phbak", "--force", "--config-dir", "/restored"]),
    ).toEqual({
      name: "backup restore",
      input: "a.phbak",
      force: true,
      configDir: "/restored",
    });
    expect(parseCommand(["backup", "restore", "--input", "a.phbak"])).toMatchObject({ force: false });
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

  it("rejects unknown commands, options and missing arguments", () => {
    expect(() => parseCommand(["backup", "delete"])).toThrow(UsageError);
    expect(() => parseCommand(["backup", "create"])).toThrow("--output is required");
    expect(() => parseCommand(["backup", "verify", "--input", "a", "--unknown"])).toThrow();
    expect(() => parseCommand(["backup", "verify", "a.phbak"])).toThrow();
  });
});
