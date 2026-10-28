import { describe, expect, it } from "vitest";
import { cliCommands, exitCodes, usageText } from "./commands.js";
import { parseCommand, UsageError, usage } from "./parse.js";

function argumentsOf(synopsis: string): string[] {
  return synopsis
    .replace(/[[\]]/g, "")
    .replace(/<[^>]+>/g, "1.4.2")
    .split(" ")
    .filter(Boolean);
}

describe("cliCommands", () => {
  it.each(cliCommands.map((command) => command.synopsis))(
    "parses %s with every option it lists",
    (synopsis) => {
      expect(() => parseCommand(argumentsOf(synopsis))).not.toThrow();
    },
  );

  it("names every option of a command in its synopsis", () => {
    for (const command of cliCommands) {
      for (const option of command.options) expect(command.synopsis).toContain(option.flag);
    }
  });

  it("covers every command the parser accepts", () => {
    const parsed = new Set(cliCommands.map((command) => parseCommand(argumentsOf(command.synopsis)).name));
    expect([...parsed].sort()).toEqual(
      [
        "audit verify",
        "backup create",
        "backup create before update",
        "backup restore",
        "backup skip-before-update",
        "backup verify",
        "help",
        "keys rotate",
        "keys status",
        "maintenance",
        "release-notes",
        "search rebuild",
        "search status",
        "version",
      ].sort(),
    );
    expect(() => parseCommand(["backup", "unknown"])).toThrow(UsageError);
  });

  it("prints every command, its description and the exit codes in the usage", () => {
    expect(usage).toBe(usageText());
    for (const command of cliCommands) {
      expect(usage).toContain(`  lunedo ${command.synopsis}\n      ${command.description}\n`);
    }
    for (const exit of Object.values(exitCodes))
      expect(usage).toContain(`${exit.code}`.padEnd(4) + exit.description);
  });
});
