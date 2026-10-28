import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type CaptureEntry, parseArguments, parseLog, renderIndex } from "./screen-index.ts";

describe("parseArguments", () => {
  it("takes the output directory and builds by default", () => {
    assert.deepEqual(parseArguments(["../screens/2026-10-22"]), {
      output: "../screens/2026-10-22",
      build: true,
      only: null,
    });
  });

  it("skips the build on request", () => {
    assert.deepEqual(parseArguments(["--skip-build", "out"]), { output: "out", build: false, only: null });
  });

  it("captures only the named part", () => {
    assert.deepEqual(parseArguments(["out", "--only", "website", "--skip-build"]), {
      output: "out",
      build: false,
      only: "website",
    });
    assert.deepEqual(parseArguments(["--only", "screens", "out"]).only, "screens");
  });

  it("rejects an unknown or missing part", () => {
    assert.throws(() => parseArguments(["out", "--only", "hero"]), /--only takes one of screens, website/);
    assert.throws(() => parseArguments(["out", "--only"]), /--only takes one of screens, website/);
  });

  it("requires exactly one output directory", () => {
    assert.throws(() => parseArguments([]), /Name exactly one output directory/);
    assert.throws(() => parseArguments(["a", "b"]), /Name exactly one output directory/);
  });

  it("rejects unknown options", () => {
    assert.throws(() => parseArguments(["out", "--fast"]), /Unknown option --fast/);
  });
});

const captured = (file: string, title: string): CaptureEntry => ({
  kind: "captured",
  file,
  title,
  route: "/spaces/IT/pages/{id}/plan",
  role: "owner",
  state: "published",
  language: "de",
  theme: "light",
  device: "desktop",
});

describe("parseLog", () => {
  it("reads one entry per line and ignores blank lines", () => {
    const entries = [captured("b.png", "B"), { kind: "failed", title: "C", reason: "timeout" } as const];
    assert.deepEqual(parseLog(`${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n\n`), entries);
  });
});

describe("renderIndex", () => {
  it("lists every screenshot sorted by file with route, role and state", () => {
    const index = renderIndex([captured("02-b.png", "Second"), captured("01-a.png", "First")], {
      date: "2026-10-22",
      commit: "abc1234",
    });
    assert.match(index, /Captured on 2026-10-22 from commit abc1234: 2 screenshots\./);
    const rows = index.split("\n").filter((line) => line.startsWith("| ["));
    assert.equal(rows.length, 2);
    assert.match(
      rows[0] ?? "",
      /^\| \[01-a\.png\]\(01-a\.png\) \| First \| `\/spaces\/IT\/pages\/\{id\}\/plan` \| owner \|/,
    );
    assert.doesNotMatch(index, /Not captured/);
  });

  it("names the screens that could not be captured and escapes table cells", () => {
    const index = renderIndex([{ kind: "failed", title: "Whiteboard", reason: "a | b\nc" }], {
      date: "2026-10-22",
      commit: "abc1234",
    });
    assert.match(index, /## Not captured\n\n- Whiteboard: a \\| b c\n$/);
  });
});
