import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFrontMatter, splitFrontMatter } from "./convert.js";

type Problem = { code: string; details: Record<string, string> };

function parse(source: string): { result: ReturnType<typeof parseFrontMatter>; problems: Problem[] } {
  const problems: Problem[] = [];
  const { yaml } = splitFrontMatter(source);
  const result = parseFrontMatter(yaml, (code, details) => problems.push({ code, details }));
  return { result, problems };
}

const refused = { code: "unsupportedMarkdown", details: { construct: "frontMatter" } };

describe("Markdown front matter", () => {
  let timeZone: string | undefined;

  beforeEach(() => {
    timeZone = process.env.TZ;
    process.env.TZ = "Europe/Vienna";
  });

  afterEach(() => {
    if (timeZone === undefined) delete process.env.TZ;
    else process.env.TZ = timeZone;
  });

  it("reads title, labels, dates and properties", () => {
    const { result, problems } = parse(
      [
        "---",
        "title: Release notes",
        "tags: [ops, '#release']",
        "date: 2024-03-01",
        "updated: 2024-03-02 23:30:00",
        "reviewed: 2024-03-04 10:00:00",
        "owner: Team Blue",
        "priority: 3",
        "---",
        "Body",
      ].join("\n"),
    );
    expect(problems).toEqual([]);
    expect(result).toEqual({
      title: "Release notes",
      labels: ["ops", "release"],
      created: "2024-03-01T00:00:00.000Z",
      modified: "2024-03-02T23:30:00.000Z",
      properties: [
        ["reviewed", "2024-03-04"],
        ["owner", "Team Blue"],
        ["priority", "3"],
      ],
      lunedo: null,
    });
  });

  it.each([
    ["a JavaScript function", "run: !!js/function 'function () { return 1 }'"],
    ["a JavaScript regular expression", "match: !!js/regexp /x/"],
    ["a verbatim JavaScript tag", "value: !<tag:yaml.org,2002:js/undefined> ''"],
    ["a custom tag", "value: !include other.yaml"],
    ["binary data", "value: !!binary aGVsbG8="],
    ["a set", "value: !!set {a, b}"],
  ])("refuses the whole front matter with %s", (_name, line) => {
    const { result, problems } = parse(`---\ntitle: Kept out\n${line}\n---\nBody`);
    expect(result.title).toBeNull();
    expect(result.properties).toEqual([]);
    expect(problems).toEqual([refused]);
  });

  it("keeps a __proto__ key from reaching the object prototype", () => {
    const { result, problems } = parse("---\n__proto__: { polluted: yes }\ntitle: Safe\n---\n");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(result.title).toBe("Safe");
    expect(problems).toEqual([
      { code: "unsupportedMarkdown", details: { construct: "frontMatterValue", name: "__proto__" } },
    ]);
  });

  it("does not merge keys from anchors", () => {
    const { result, problems } = parse(
      "---\nbase: &base { owner: Team Blue }\n<<: *base\ntitle: Merged\n---\n",
    );
    expect(result.title).toBe("Merged");
    expect(result.properties).toEqual([]);
    expect(problems.map((problem) => problem.details.name)).toEqual(["base", "<<"]);
  });

  it("refuses deeply nested values", () => {
    const { result, problems } = parse(
      `---\ntitle: Deep\nvalue: ${"[".repeat(150)}${"]".repeat(150)}\n---\n`,
    );
    expect(result.title).toBeNull();
    expect(problems).toEqual([refused]);
  });

  it("does not parse front matter larger than 64 KiB", () => {
    const { result, problems } = parse(`---\ntitle: Large\nnote: "${"x".repeat(64 * 1024)}"\n---\n`);
    expect(result.title).toBeNull();
    expect(problems).toEqual([refused]);
  });

  it("reports aliases that expand into nested lists instead of copying them", () => {
    const levels = ["a: &a [x, x, x, x, x, x, x, x, x, x]"];
    for (let level = 1; level < 9; level += 1) {
      const previous = String.fromCharCode(96 + level);
      const name = String.fromCharCode(97 + level);
      levels.push(`${name}: &${name} [${Array(10).fill(`*${previous}`).join(", ")}]`);
    }
    const { result, problems } = parse(`---\ntitle: Laughs\n${levels.join("\n")}\n---\n`);
    expect(result.title).toBe("Laughs");
    expect(result.properties).toEqual([["a", "x, x, x, x, x, x, x, x, x, x"]]);
    expect(problems.map((problem) => problem.details.name)).toEqual(["b", "c", "d", "e", "f", "g", "h", "i"]);
  });
});
