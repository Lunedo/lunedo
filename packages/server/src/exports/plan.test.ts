import { describe, expect, it } from "vitest";
import { MAX_NAME_LENGTH } from "./names.js";
import {
  MAX_PATH_LENGTH,
  MIN_NAME_LENGTH,
  type PlanAttachment,
  type PlanInput,
  pageFile,
  planExport,
} from "./plan.js";

function chain(depth: number, title: (level: number) => string): PlanInput[] {
  const items: PlanInput[] = [];
  const path: string[] = [];
  for (let level = 0; level < depth; level += 1) {
    const id = `page-${level}`;
    path.push(id);
    items.push({
      id,
      parentId: level === 0 ? null : `page-${level - 1}`,
      path: [...path],
      kind: "page",
      title: title(level),
      linkUrl: null,
      linkItemId: null,
    });
  }
  return items;
}

function attachmentsFor(items: readonly PlanInput[]): PlanAttachment[] {
  return items.map((item) => ({
    id: `file-${item.id}`,
    itemId: item.id,
    name: `${"Quarterly figures for the board meeting ".repeat(3)}.xlsx`,
    fileId: `stored-${item.id}`,
    size: 1,
  }));
}

function plan(items: readonly PlanInput[], attachments: readonly PlanAttachment[] = []) {
  return planExport({
    rootId: null,
    items,
    attachments,
    untitledPage: "Untitled page",
    untitledFolder: "Untitled folder",
  });
}

function paths(planned: ReturnType<typeof plan>): string[] {
  return [
    ...planned.pages.flatMap((node) => [pageFile(node, "markdown"), pageFile(node, "html")]),
    ...planned.attachments.map((attachment) => attachment.path),
  ];
}

const longTitle = (level: number) => `Level ${level} ${"operations handbook chapter ".repeat(4)}`;

describe("export paths", () => {
  it("stay below 240 characters and shorten the deepest levels first", () => {
    const items = chain(8, longTitle);
    const planned = plan(items, attachmentsFor(items));
    const all = paths(planned);
    expect(all).toHaveLength(8 * 3);
    for (const path of all) expect([...path].length).toBeLessThanOrEqual(MAX_PATH_LENGTH);

    const deepest = planned.pages.at(-1)?.folder ?? [];
    expect(deepest).toHaveLength(8);
    expect(deepest[0]).toBe(longTitle(0).trim().slice(0, MAX_NAME_LENGTH).trim());
    const lengths = deepest.map((segment) => segment.length);
    expect(lengths.at(-1)).toBeLessThan(lengths[0] ?? 0);
    for (let index = 1; index < lengths.length; index += 1) {
      expect(lengths[index]).toBeLessThanOrEqual(lengths[index - 1] ?? 0);
    }
    for (const segment of deepest) expect(segment.length).toBeGreaterThanOrEqual(MIN_NAME_LENGTH);
  });

  it("keep the names of shallow trees as they are", () => {
    const items = chain(2, (level) => `Team ${level} onboarding`);
    expect(paths(plan(items))).toEqual([
      "Team 0 onboarding/Team 0 onboarding.md",
      "Team 0 onboarding/Team 0 onboarding.html",
      "Team 0 onboarding/Team 1 onboarding/Team 1 onboarding.md",
      "Team 0 onboarding/Team 1 onboarding/Team 1 onboarding.html",
    ]);
  });

  it("put very deep pages next to their parent instead of below it and keep every path unique", () => {
    const items = chain(40, longTitle);
    const planned = plan(items, attachmentsFor(items));
    const all = paths(planned);
    expect(all).toHaveLength(40 * 3);
    for (const path of all) expect([...path].length).toBeLessThanOrEqual(MAX_PATH_LENGTH);
    expect(new Set(all.map((path) => path.toLowerCase())).size).toBe(all.length);
    const deepest = planned.pages.at(-1);
    expect(deepest?.stem?.length).toBeGreaterThanOrEqual(MIN_NAME_LENGTH);
    expect(deepest?.stem?.startsWith("Level 39")).toBe(true);
  });

  it("keep shortened siblings with the same beginning apart", () => {
    const items = chain(9, longTitle);
    const parent = items.at(-1);
    if (!parent) throw new Error("The chain is empty");
    for (const suffix of ["first", "second"]) {
      items.push({
        id: `sibling-${suffix}`,
        parentId: parent.id,
        path: [...parent.path, `sibling-${suffix}`],
        kind: "page",
        title: `${"Incident review for the storage cluster ".repeat(2)}${suffix}`,
        linkUrl: null,
        linkItemId: null,
      });
    }
    const all = paths(plan(items));
    for (const path of all) expect([...path].length).toBeLessThanOrEqual(MAX_PATH_LENGTH);
    expect(new Set(all.map((path) => path.toLowerCase())).size).toBe(all.length);
  });
});
