import { describe, expect, it } from "vitest";
import {
  currentPlace,
  descendantsOf,
  flatten,
  indent,
  outdent,
  placementOf,
  project,
  samePlace,
  siblingStep,
} from "./folder-tree.js";

const folders = [
  { id: "it", parentId: null },
  { id: "hr", parentId: null },
  { id: "ms", parentId: "it" },
  { id: "outlook", parentId: "ms" },
  { id: "web", parentId: "outlook" },
  { id: "teams", parentId: "ms" },
  { id: "vpn", parentId: "it" },
];

const ids = (rows: { folder: { id: string }; depth: number }[]) =>
  rows.map((row) => `${row.folder.id}:${row.depth}`);

describe("the folder tree of a knowledge base", () => {
  it("flattens folders of any depth in tree order and hides collapsed branches", () => {
    expect(ids(flatten(folders, new Set()))).toEqual([
      "it:0",
      "ms:1",
      "outlook:2",
      "web:3",
      "teams:2",
      "vpn:1",
      "hr:0",
    ]);
    expect(ids(flatten(folders, new Set(["ms"])))).toEqual(["it:0", "ms:1", "vpn:1", "hr:0"]);
    expect([...descendantsOf(folders, "ms")].sort()).toEqual(["outlook", "teams", "web"]);
  });

  it("shows folders whose parent the person cannot see at the top level", () => {
    expect(
      ids(
        flatten(
          [
            { id: "web", parentId: "hidden" },
            { id: "hr", parentId: null },
          ],
          new Set(),
        ),
      ),
    ).toEqual(["hr:0", "web:0"]);
  });

  it("projects a drop to the depth the pointer moved to, within the neighbors", () => {
    const rows = flatten(folders, new Set());
    const zero = { depth: 0, parentId: null, index: 0 };
    const sibling = project(rows, "vpn", "teams", 0);
    expect(sibling).toEqual({ depth: 2, parentId: "ms", index: 4 });
    expect(placementOf(rows, "vpn", sibling ?? zero)).toEqual({ parentId: "ms", afterId: "outlook" });
    const nested = project(rows, "vpn", "teams", 2);
    expect(nested).toEqual({ depth: 3, parentId: "outlook", index: 4 });
    expect(placementOf(rows, "vpn", nested ?? zero)).toEqual({ parentId: "outlook", afterId: "web" });
    const top = project(rows, "vpn", "it", 0);
    expect(top).toEqual({ depth: 0, parentId: null, index: 0 });
    expect(placementOf(rows, "vpn", top ?? zero)).toEqual({ parentId: null, beforeId: "it" });
    const up = project(rows, "hr", "vpn", 0);
    expect(up).toEqual({ depth: 1, parentId: "it", index: 5 });
    expect(placementOf(rows, "hr", up ?? zero)).toEqual({ parentId: "it", afterId: "ms" });
  });

  it("never projects deeper than one level below the folder above", () => {
    const rows = flatten(folders, new Set());
    expect(project(rows, "hr", "web", 9)?.depth).toBe(3);
    expect(project(rows, "web", "it", 5)).toEqual({ depth: 0, parentId: null, index: 0 });
  });

  it("moves with the keyboard actions among siblings, into the folder above and out of the parent", () => {
    const byId = (id: string) => {
      const found = folders.find((folder) => folder.id === id);
      if (!found) throw new Error(id);
      return found;
    };
    expect(siblingStep(folders, byId("teams"), -1)).toEqual({
      parentId: "ms",
      beforeId: "outlook",
    });
    expect(siblingStep(folders, byId("outlook"), -1)).toBeNull();
    expect(indent(folders, byId("vpn"))).toEqual({ parentId: "ms", afterId: "teams" });
    expect(indent(folders, byId("teams"))).toEqual({ parentId: "outlook", afterId: "web" });
    expect(indent(folders, byId("it"))).toBeNull();
    expect(outdent(folders, byId("web"))).toEqual({ parentId: "ms", afterId: "outlook" });
    expect(outdent(folders, byId("it"))).toBeNull();
  });

  it("recognizes a drop on the place the folder already has", () => {
    const teams = { id: "teams", parentId: "ms" };
    expect(samePlace(folders, teams, { parentId: "ms", afterId: "outlook" })).toBe(true);
    expect(samePlace(folders, teams, { parentId: "ms", beforeId: "outlook" })).toBe(false);
    expect(samePlace(folders, teams, { parentId: "it", afterId: "ms" })).toBe(false);
    expect(samePlace(folders, { id: "web", parentId: "outlook" }, { parentId: "outlook" })).toBe(true);
  });

  it("remembers the place of a folder so that a move can be undone", () => {
    expect(currentPlace(folders, { id: "teams", parentId: "ms" })).toEqual({
      parentId: "ms",
      afterId: "outlook",
    });
    expect(currentPlace(folders, { id: "outlook", parentId: "ms" })).toEqual({
      parentId: "ms",
      beforeId: "teams",
    });
    expect(currentPlace(folders, { id: "web", parentId: "outlook" })).toEqual({ parentId: "outlook" });
  });
});
