import { describe, expect, it } from "vitest";
import { diffSequence } from "./diff.js";
import {
  type BlockDiff,
  type DocumentJson,
  diffDocuments,
  type InlineSegment,
  InvalidDocumentError,
  type MarkJson,
  type NodeJson,
} from "./index.js";

const bold: MarkJson = { type: "bold" };

function text(value: string, marks?: MarkJson[]): NodeJson {
  return { type: "text", text: value, ...(marks ? { marks } : {}) };
}

function inline(content: (string | NodeJson)[]): NodeJson[] {
  return content.map((item) => (typeof item === "string" ? text(item) : item));
}

function p(...content: (string | NodeJson)[]): NodeJson {
  return { type: "paragraph", content: inline(content) };
}

function heading(level: number, value: string): NodeJson {
  return { type: "heading", attrs: { level }, content: [text(value)] };
}

function bulletList(...items: string[]): NodeJson {
  return { type: "bulletList", content: items.map((item) => ({ type: "listItem", content: [p(item)] })) };
}

function taskList(...items: [string, string | null][]): NodeJson {
  return {
    type: "taskList",
    content: items.map(([value, dueDate]) => ({ type: "taskItem", attrs: { dueDate }, content: [p(value)] })),
  };
}

function cell(value: string, attrs?: Record<string, unknown>, type = "tableCell"): NodeJson {
  return { type, ...(attrs ? { attrs } : {}), content: [p(value)] };
}

function row(...cells: (string | NodeJson)[]): NodeJson {
  return { type: "tableRow", content: cells.map((item) => (typeof item === "string" ? cell(item) : item)) };
}

function table(...rows: NodeJson[]): NodeJson {
  return { type: "table", content: rows };
}

function callout(variant: string, ...content: NodeJson[]): NodeJson {
  return { type: "callout", attrs: { variant }, content };
}

function code(value: string, language: string | null = null): NodeJson {
  return { type: "codeBlock", attrs: { language }, content: value ? [text(value)] : [] };
}

function doc(...content: NodeJson[]): DocumentJson {
  return { type: "doc", content };
}

function page(...content: NodeJson[]) {
  return { title: "Page", document: doc(...content) };
}

function compare(before: NodeJson[], after: NodeJson[]) {
  return diffDocuments(page(...before), page(...after));
}

function textOf(nodes: readonly NodeJson[]): string {
  return nodes.map((node) => node.text ?? `[${node.type}]`).join("");
}

function describeSegments(segments: readonly InlineSegment[] | undefined): string[] {
  return (segments ?? []).map((segment) => `${segment.change}:${textOf(segment.nodes)}`);
}

function only(diff: { blocks: BlockDiff[] }, change: string): BlockDiff {
  const matches = diff.blocks.filter((block) => block.change === change);
  expect(matches).toHaveLength(1);
  return matches[0] as BlockDiff;
}

function child(block: BlockDiff | undefined, index: number): BlockDiff {
  const result = block?.children?.[index];
  if (!result) throw new Error(`No child at ${index}`);
  return result;
}

describe("diffSequence", () => {
  function lcsLength(left: string[], right: string[]): number {
    const table = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
    for (let i = left.length - 1; i >= 0; i -= 1) {
      for (let j = right.length - 1; j >= 0; j -= 1) {
        const rowBelow = table[i + 1] as number[];
        const current = table[i] as number[];
        current[j] =
          left[i] === right[j]
            ? (rowBelow[j + 1] as number) + 1
            : Math.max(rowBelow[j] as number, current[j + 1] as number);
      }
    }
    return table[0]?.[0] ?? 0;
  }

  it("finds a longest common subsequence and covers every element once", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let round = 0; round < 300; round += 1) {
      const left = Array.from(
        { length: Math.floor(random() * 14) },
        () => "abcd"[Math.floor(random() * 4)] as string,
      );
      const right = Array.from(
        { length: Math.floor(random() * 14) },
        () => "abcd"[Math.floor(random() * 4)] as string,
      );
      const steps = diffSequence(left, right);
      const equal = steps.filter((step) => step.kind === "equal");
      expect(equal).toHaveLength(lcsLength(left, right));
      const seenBefore: number[] = [];
      const seenAfter: number[] = [];
      for (const step of steps) {
        if (step.kind === "equal") {
          expect(left[step.before]).toBe(right[step.after]);
          seenBefore.push(step.before);
          seenAfter.push(step.after);
        } else {
          seenBefore.push(...step.removed);
          seenAfter.push(...step.added);
        }
      }
      expect(seenBefore).toEqual(left.map((_, index) => index));
      expect(seenAfter).toEqual(right.map((_, index) => index));
    }
  });
});

describe("diffDocuments", () => {
  it("reports no changes for identical documents", () => {
    const blocks = [heading(1, "Title"), p("Hello ", text("world", [bold])), bulletList("a", "b"), code("x")];
    const diff = compare(blocks, blocks);
    expect(diff.changes).toBe(0);
    expect(diff.title).toBeNull();
    expect(diff.blocks.map((block) => block.change)).toEqual([
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
    ]);
  });

  it("treats missing attributes with defaults as unchanged", () => {
    const diff = compare(
      [{ type: "paragraph", content: [text("a")] }],
      [{ type: "paragraph", attrs: { textAlign: "left", indent: 0 }, content: [text("a")] }],
    );
    expect(diff.changes).toBe(0);
  });

  it("rejects invalid documents", () => {
    expect(() => compare([{ type: "script", content: [] }], [p("a")])).toThrow(InvalidDocumentError);
  });

  it("finds text added to a paragraph", () => {
    const diff = compare([p("Hello world")], [p("Hello big world")]);
    const block = only(diff, "changed");
    expect(block.attributes).toEqual([]);
    const added = (block.inline ?? []).filter((segment) => segment.change === "added");
    expect(added.map((segment) => textOf(segment.nodes).trim())).toEqual(["big"]);
    expect(diff.changes).toBe(1);
  });

  it("finds text removed from a paragraph", () => {
    const diff = compare([p("Hello big world")], [p("Hello world")]);
    const removed = (only(diff, "changed").inline ?? []).filter((segment) => segment.change === "removed");
    expect(removed.map((segment) => textOf(segment.nodes).trim())).toEqual(["big"]);
    expect(diff.changes).toBe(1);
  });

  it("shows replaced words as one removed and one added segment", () => {
    const diff = compare([p("a quick brown fox.")], [p("a slow red fox.")]);
    expect(describeSegments(only(diff, "changed").inline)).toEqual([
      "unchanged:a ",
      "removed:quick brown",
      "added:slow red",
      "unchanged: fox.",
    ]);
    expect(diff.changes).toBe(1);
  });

  it("marks text whose formatting changed as formatted", () => {
    const diff = compare([p("Hello world")], [p("Hello ", text("world", [bold]))]);
    const segments = only(diff, "changed").inline ?? [];
    expect(describeSegments(segments)).toEqual(["unchanged:Hello ", "formatted:world"]);
    expect(segments[1]?.nodes).toEqual([text("world", [bold])]);
    expect(segments[1]?.before).toEqual([text("world")]);
    expect(diff.changes).toBe(1);
  });

  it("keeps marks on unchanged and added text", () => {
    const diff = compare([p(text("bold", [bold]))], [p(text("bold more", [bold]))]);
    const segments = only(diff, "changed").inline ?? [];
    expect(segments.flatMap((segment) => segment.nodes.map((node) => node.marks))).toEqual([[bold], [bold]]);
  });

  it("reports a heading level change as an attribute change", () => {
    const diff = compare([heading(1, "Intro")], [heading(2, "Intro")]);
    const block = only(diff, "changed");
    expect(block.attributes).toEqual([{ name: "level", before: 1, after: 2 }]);
    expect(block.inline).toBeUndefined();
    expect(diff.changes).toBe(1);
  });

  it("finds added and removed paragraphs", () => {
    const diff = compare([p("one"), p("two")], [p("one"), p("three is new"), p("two")]);
    expect(only(diff, "added").after).toEqual(expect.objectContaining({ type: "paragraph" }));
    expect(diff.changes).toBe(1);
    const removed = compare([p("one"), p("two")], [p("two")]);
    expect(removed.blocks.map((block) => block.change)).toEqual(["removed", "unchanged"]);
    expect(removed.changes).toBe(1);
  });

  it("keeps unrelated replaced paragraphs as removed and added", () => {
    const diff = compare([p("alpha beta")], [p("gamma delta")]);
    expect(diff.blocks.map((block) => block.change)).toEqual(["removed", "added"]);
    expect(diff.changes).toBe(2);
  });

  it("reports a moved block once at its new position", () => {
    const diff = compare([p("first"), p("second"), p("third")], [p("second"), p("third"), p("first")]);
    expect(diff.blocks.map((block) => block.change)).toEqual(["unchanged", "unchanged", "moved"]);
    const moved = only(diff, "moved");
    expect(textOf(moved.before?.content ?? [])).toBe("first");
    expect(textOf(moved.after?.content ?? [])).toBe("first");
    expect(diff.changes).toBe(1);
  });

  it("finds an added list item", () => {
    const diff = compare([bulletList("a", "b")], [bulletList("a", "b", "c")]);
    const list = only(diff, "changed");
    expect(list.children?.map((item) => item.change)).toEqual(["unchanged", "unchanged", "added"]);
    expect(diff.changes).toBe(1);
  });

  it("reports a new due date as an attribute change and text as inline change", () => {
    const diff = compare(
      [taskList(["Buy milk", null], ["Call", null])],
      [taskList(["Buy milk", "2026-10-12"], ["Call Anna", null])],
    );
    const list = only(diff, "changed");
    const first = child(list, 0);
    expect(first.change).toBe("changed");
    expect(first.attributes).toEqual([{ name: "dueDate", before: null, after: "2026-10-12" }]);
    expect(child(first, 0).change).toBe("unchanged");
    const second = child(list, 1);
    expect(second.attributes).toEqual([]);
    expect(describeSegments(child(second, 0).inline)).toEqual(["unchanged:Call", "added: Anna"]);
    expect(diff.changes).toBe(2);
  });

  it("finds an added table row", () => {
    const diff = compare(
      [table(row("a", "b"), row("c", "d"))],
      [table(row("a", "b"), row("c", "d"), row("e", "f"))],
    );
    const result = only(diff, "changed");
    expect(result.children?.map((item) => item.change)).toEqual(["unchanged", "unchanged", "added"]);
    expect(diff.changes).toBe(1);
  });

  it("finds an added column as an added cell in every row", () => {
    const diff = compare(
      [table(row("Name", "Role"), row("Ann", "Dev"))],
      [table(row("Name", "Team", "Role"), row("Ann", "Core", "Dev"))],
    );
    const result = only(diff, "changed");
    for (const rowDiff of result.children ?? []) {
      expect(rowDiff.change).toBe("changed");
      expect(rowDiff.children?.map((item) => item.change)).toEqual(["unchanged", "added", "unchanged"]);
    }
    expect(diff.changes).toBe(2);
  });

  it("finds a removed column as a removed cell in every row", () => {
    const diff = compare(
      [table(row("Name", "Team", "Role"), row("Ann", "Core", "Dev"))],
      [table(row("Name", "Role"), row("Ann", "Dev"))],
    );
    const result = only(diff, "changed");
    for (const rowDiff of result.children ?? []) {
      expect(rowDiff.children?.map((item) => item.change)).toEqual(["unchanged", "removed", "unchanged"]);
    }
    expect(diff.changes).toBe(2);
  });

  it("reports merged cells as a colspan change and a removed cell", () => {
    const diff = compare(
      [table(row("a", "b"), row("c", "d"))],
      [table(row(cell("a", { colspan: 2, colwidth: null })), row("c", "d"))],
    );
    const first = child(only(diff, "changed"), 0);
    expect(first.children?.map((item) => item.change)).toEqual(["changed", "removed"]);
    expect(child(first, 0).attributes).toEqual([{ name: "colspan", before: 1, after: 2 }]);
    expect(diff.changes).toBe(2);
  });

  it("reports a cell that became a header cell as changed", () => {
    const diff = compare([table(row("a", "b"))], [table(row(cell("a", undefined, "tableHeader"), "b"))]);
    const header = child(child(only(diff, "changed"), 0), 0);
    expect(header.change).toBe("changed");
    expect(header.type).toBe("tableHeader");
    expect(header.attributes).toEqual([{ name: "type", before: "tableCell", after: "tableHeader" }]);
    expect(diff.changes).toBe(1);
  });

  it("reports callout variant and content changes", () => {
    const diff = compare(
      [callout("info", p("Read the guide"))],
      [callout("warning", p("Read the new guide"))],
    );
    const result = only(diff, "changed");
    expect(result.attributes).toEqual([{ name: "variant", before: "info", after: "warning" }]);
    expect(child(result, 0).change).toBe("changed");
    expect(diff.changes).toBe(2);
  });

  it("diffs code blocks by line and reports language changes", () => {
    const diff = compare([code("a\nb\nc", "javascript")], [code("a\nB\nc\nd", "typescript")]);
    const result = only(diff, "changed");
    expect(result.attributes).toEqual([{ name: "language", before: "javascript", after: "typescript" }]);
    expect(result.lines).toEqual([
      { change: "unchanged", text: "a" },
      { change: "removed", text: "b" },
      { change: "added", text: "B" },
      { change: "unchanged", text: "c" },
      { change: "added", text: "d" },
    ]);
    expect(result.inline).toBeUndefined();
    expect(diff.changes).toBe(3);
  });

  it("reports a block formula change as a latex attribute change", () => {
    const diff = compare(
      [{ type: "blockMath", attrs: { latex: "a^2" } }],
      [{ type: "blockMath", attrs: { latex: "b^2" } }],
    );
    const result = only(diff, "changed");
    expect(result.attributes).toEqual([{ name: "latex", before: "a^2", after: "b^2" }]);
    expect(diff.changes).toBe(1);
  });

  it("shows an inline formula change as a replaced atom", () => {
    const math = (latex: string): NodeJson => ({ type: "inlineMath", attrs: { latex } });
    const diff = compare([p("Area ", math("a^2"), " here")], [p("Area ", math("b^2"), " here")]);
    expect(describeSegments(only(diff, "changed").inline)).toEqual([
      "unchanged:Area ",
      "removed:[inlineMath]",
      "added:[inlineMath]",
      "unchanged: here",
    ]);
    expect(diff.changes).toBe(1);
  });

  it("reports a title change", () => {
    const diff = diffDocuments(
      { title: "Old", document: doc(p("a")) },
      { title: "New", document: doc(p("a")) },
    );
    expect(diff.title).toEqual({ before: "Old", after: "New" });
    expect(diff.changes).toBe(1);
  });

  it("counts every leaf change", () => {
    const diff = diffDocuments(
      { title: "Plan", document: doc(heading(1, "Plan"), p("one two three"), p("gone"), bulletList("a")) },
      {
        title: "Plan 2",
        document: doc(heading(2, "Plan"), p("one 2 three four"), bulletList("a", "b"), p("new block")),
      },
    );
    expect(diff.changes).toBe(1 + 1 + 2 + 1 + 1 + 1);
  });

  it("diffs a large document quickly", () => {
    const words = Array.from({ length: 25 }, (_, index) => `word${index}`);
    const before = Array.from({ length: 2_000 }, (_, index) => p(`${index} ${words.join(" ")}`));
    const after = before.map((block, index) =>
      index % 50 === 0 ? p(`${index} changed ${words.slice(1).join(" ")}`) : block,
    );
    after.splice(700, 0, p("inserted paragraph"));
    after.push(after.splice(10, 1)[0] as NodeJson);
    const started = performance.now();
    const diff = compare(before, after);
    const elapsed = performance.now() - started;
    expect(diff.changes).toBe(40 + 1 + 1);
    expect(elapsed).toBeLessThan(1_000);
  });

  it("diffs a completely rewritten large document within limits", () => {
    const before = Array.from({ length: 2_000 }, (_, index) =>
      p(`before ${index} ${"lorem ipsum ".repeat(12)}`),
    );
    const after = Array.from({ length: 2_000 }, (_, index) =>
      p(`after ${index * 7} ${"dolor sit ".repeat(12)}`),
    );
    const started = performance.now();
    const diff = compare(before, after);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(diff.changes).toBe(4_000);
  });
});
