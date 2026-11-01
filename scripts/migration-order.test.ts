import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type JournalEntry, migrationOrderProblems, parseJournal } from "./migration-order.ts";

function entry(idx: number, tag: string, when: number): JournalEntry {
  return { idx, tag, when };
}

function filesOf(entries: readonly JournalEntry[]): string[] {
  return entries.flatMap((item) => [`${item.tag}.sql`, `meta/${item.tag.slice(0, 4)}_snapshot.json`]);
}

describe("migrationOrderProblems", () => {
  it("accepts numbered migrations with increasing timestamps", () => {
    const entries = [
      entry(0, "0000_baseline", 100),
      entry(1, "0001_pages", 200),
      entry(2, "0002_links", 300),
    ];
    assert.deepEqual(migrationOrderProblems(entries, [...filesOf(entries), "meta/_journal.json"]), []);
  });

  it("rejects a migration whose timestamp is older than the one before it", () => {
    const entries = [
      entry(0, "0000_baseline", 100),
      entry(1, "0001_pages", 300),
      entry(2, "0002_links", 200),
    ];
    const problems = migrationOrderProblems(entries, filesOf(entries));
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /^0002_links: when \(200\) is not newer than that of 0001_pages/);
  });

  it("rejects equal timestamps", () => {
    const entries = [entry(0, "0000_baseline", 100), entry(1, "0001_pages", 100)];
    assert.equal(migrationOrderProblems(entries, filesOf(entries)).length, 1);
  });

  it("rejects gaps and duplicate numbers", () => {
    const gap = [entry(0, "0000_baseline", 100), entry(1, "0002_links", 200)];
    assert.match(migrationOrderProblems(gap, filesOf(gap)).join("\n"), /0002_links: expected number 0001/);
    const twice = [entry(0, "0000_baseline", 100), entry(1, "0001_pages", 200), entry(2, "0001_links", 300)];
    assert.match(
      migrationOrderProblems(twice, filesOf(twice)).join("\n"),
      /0001_links: expected number 0002/,
    );
  });

  it("rejects a tag listed twice and an index that does not match the position", () => {
    const entries = [entry(0, "0000_baseline", 100), entry(0, "0000_baseline", 200)];
    const problems = migrationOrderProblems(entries, filesOf(entries)).join("\n");
    assert.match(problems, /listed twice/);
    assert.match(problems, /idx is 0, expected 1/);
  });

  it("rejects names without a number", () => {
    const entries = [entry(0, "baseline", 100)];
    assert.match(migrationOrderProblems(entries, ["baseline.sql"]).join("\n"), /four-digit number/);
  });

  it("reports missing files and SQL files the journal does not list", () => {
    const entries = [entry(0, "0000_baseline", 100), entry(1, "0001_pages", 200)];
    const problems = migrationOrderProblems(entries, [
      "0000_baseline.sql",
      "meta/0000_snapshot.json",
      "0002_x.sql",
    ]);
    assert.deepEqual(problems, [
      "0001_pages: the file 0001_pages.sql is missing",
      "0001_pages: the snapshot meta/0001_snapshot.json is missing",
      "0002_x.sql: not listed in meta/_journal.json",
    ]);
  });
});

describe("parseJournal", () => {
  it("reads the entries and refuses a journal without them", () => {
    assert.deepEqual(parseJournal('{"entries":[{"idx":0,"when":1,"tag":"0000_baseline"}]}'), [
      { idx: 0, when: 1, tag: "0000_baseline" },
    ]);
    assert.throws(() => parseJournal("{}"), /no list of entries/);
  });
});
