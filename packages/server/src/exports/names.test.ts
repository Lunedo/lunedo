import { describe, expect, it } from "vitest";
import { MAX_NAME_LENGTH, NameScope, safeName, splitExtension } from "./names.js";

describe("safe file names", () => {
  it("replace characters that Windows, macOS or Linux do not allow", () => {
    expect(safeName('Q1: plan/review <draft> "final" a\\b|c?d*e', "x")).toBe(
      "Q1- plan-review -draft- -final- a-b-c-d-e",
    );
    expect(safeName("tab\there\u0000and​zero", "x")).toBe("tab here-and-zero");
  });

  it("drop leading and trailing dots and spaces", () => {
    expect(safeName("  ..hidden notes.  ", "x")).toBe("hidden notes");
    expect(safeName("...", "Untitled page")).toBe("Untitled page");
    expect(safeName("", "")).toBe("export");
  });

  it("change names that Windows reserves for devices", () => {
    for (const name of ["CON", "prn", "Aux", "NUL", "COM1", "lpt9", "con.txt", "COM¹"]) {
      expect(safeName(name, "x")).toBe(`${name}_`);
    }
    expect(safeName("Console", "x")).toBe("Console");
  });

  it("keep titles readable, also in other scripts, and limit their length", () => {
    expect(safeName("Übersicht – Café 東京 🚀", "x")).toBe("Übersicht – Café 東京 🚀");
    const long = safeName("😀".repeat(100), "x");
    expect([...long]).toHaveLength(MAX_NAME_LENGTH);
    expect(long.isWellFormed()).toBe(true);
  });

  it("split only real extensions off file names", () => {
    expect(splitExtension("report.PDF")).toEqual({ base: "report", extension: ".PDF" });
    expect(splitExtension(".env")).toEqual({ base: ".env", extension: "" });
    expect(splitExtension("version 1.2 final")).toEqual({ base: "version 1.2 final", extension: "" });
    expect(splitExtension("archive.")).toEqual({ base: "archive.", extension: "" });
  });
});

describe("name scope", () => {
  it("makes names unique within a folder without regard to case", () => {
    const scope = new NameScope();
    expect(scope.take("Setup")).toBe("Setup");
    expect(scope.take("setup")).toBe("setup (2)");
    expect(scope.take("SETUP")).toBe("SETUP (3)");
  });

  it("reserves a name for all extensions of a page at once", () => {
    const scope = new NameScope();
    expect(scope.take("Guide", [".md", ".html"])).toBe("Guide");
    expect(scope.file("guide.html", "file")).toBe("guide (2).html");
    expect(scope.file("Guide.pdf", "file")).toBe("Guide.pdf");
    expect(scope.take("Guide", [".md", ".html"])).toBe("Guide (3)");
  });

  it("treats composed and decomposed characters as the same name", () => {
    const scope = new NameScope();
    expect(scope.take("Café")).toBe("Café");
    expect(scope.take("Café")).toBe("Café (2)");
  });

  it("keeps unique names within the length limit and the extension intact", () => {
    const scope = new NameScope();
    const name = "a".repeat(200);
    const first = scope.file(`${name}.docx`, "file");
    const second = scope.file(`${name}.docx`, "file");
    expect(first.endsWith(".docx")).toBe(true);
    expect(second.endsWith(" (2).docx")).toBe(true);
    expect([...first]).toHaveLength(MAX_NAME_LENGTH);
    expect([...second]).toHaveLength(MAX_NAME_LENGTH);
  });

  it("never hands out a reserved name", () => {
    const scope = new NameScope();
    scope.reserve("index.html");
    expect(scope.file("INDEX.html", "file")).toBe("INDEX (2).html");
  });
});
