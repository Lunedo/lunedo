import { describe, expect, it } from "vitest";
import { lastTerm, MAX_QUERY_ATOMS, parseQuery } from "./query.js";

describe("parseQuery", () => {
  it("reads words, phrases, exclusions and alternatives", () => {
    expect(parseQuery('vpn "remote access" -legacy wireguard OR openvpn')).toEqual({
      clauses: [
        [{ kind: "term", text: "vpn" }],
        [{ kind: "phrase", text: "remote access" }],
        [
          { kind: "term", text: "wireguard" },
          { kind: "term", text: "openvpn" },
        ],
      ],
      excluded: [{ kind: "term", text: "legacy" }],
      operators: { space: [], label: [], author: [], status: [], type: [] },
    });
  });

  it("reads operators with plain and quoted values and keeps unknown ones as words", () => {
    const parsed = parseQuery('space:ITOPS label:runbook author:"Ada Lovelace" type:page status:draft url:x');
    expect(parsed.operators).toEqual({
      space: ["ITOPS"],
      label: ["runbook"],
      author: ["Ada Lovelace"],
      status: ["draft"],
      type: ["page"],
    });
    expect(parsed.clauses).toEqual([[{ kind: "term", text: "url:x" }]]);
  });

  it("excludes phrases and ignores a dangling OR, an unclosed quote and empty phrases", () => {
    expect(parseQuery('OR printer -"old model" ""').clauses).toEqual([[{ kind: "term", text: "printer" }]]);
    expect(parseQuery('OR printer -"old model"').excluded).toEqual([{ kind: "phrase", text: "old model" }]);
    expect(parseQuery('"open phrase').clauses).toEqual([[{ kind: "phrase", text: "open phrase" }]]);
  });

  it("limits the number of words", () => {
    const parsed = parseQuery(Array.from({ length: 40 }, (_, index) => `word${index}`).join(" "));
    expect(parsed.clauses).toHaveLength(MAX_QUERY_ATOMS);
  });

  it("names the last word for matching while typing", () => {
    expect(lastTerm(parseQuery("printer set"))).toEqual({ kind: "term", text: "set" });
    expect(lastTerm(parseQuery('printer "set up"'))).toBeNull();
  });
});
